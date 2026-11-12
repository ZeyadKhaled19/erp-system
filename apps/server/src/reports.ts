import type { Db } from './db';
import { AppError } from './errors';

/**
 * التقارير تُحسب من البيانات المُرحّلة فقط (القيود وحركات المخزون)، وليس من المسودات.
 * القيود الملغاة لا تُستبعد؛ يُعكس أثرها بقيد عكسي، فيبقى الأثر الصافي صفرًا مع الاحتفاظ بالأصل.
 */

type Range = { from?: string; to?: string };
const dateCond = (col: string, r: Range, params: unknown[]) => {
  const parts: string[] = [];
  if (r.from) {
    params.push(r.from);
    parts.push(`${col} >= $${params.length}`);
  }
  if (r.to) {
    params.push(r.to);
    parts.push(`${col} <= $${params.length}`);
  }
  return parts.length ? parts.join(' and ') : 'true';
};

/** ميزان المراجعة: رصيد أول المدة + حركة الفترة + الرصيد الختامي لكل حساب، مع تجميع الحسابات الرئيسية */
export async function trialBalance(db: Db, r: Range) {
  const accounts = await db.query(`select id, code, name, parent_id, type, is_group from accounts order by code`);
  const params: unknown[] = [];
  const from = r.from ?? '0001-01-01';
  const to = r.to ?? '9999-12-31';
  params.push(from, to);
  const rows = await db.query(
    `select l.account_id,
        coalesce(sum(case when e.date < $1 then l.debit - l.credit else 0 end), 0)::bigint as opening,
        coalesce(sum(case when e.date >= $1 and e.date <= $2 then l.debit else 0 end), 0)::bigint as debit,
        coalesce(sum(case when e.date >= $1 and e.date <= $2 then l.credit else 0 end), 0)::bigint as credit
       from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.date <= $2
      group by l.account_id`,
    params,
  );
  const byId = new Map(accounts.map((a) => [a.id, { ...a, opening: 0, debit: 0, credit: 0, closing: 0 }]));
  for (const row of rows) {
    let a = byId.get(row.account_id);
    // تجميع الرصيد على الحساب نفسه وكل آبائه
    while (a) {
      a.opening += row.opening;
      a.debit += row.debit;
      a.credit += row.credit;
      a = a.parent_id ? byId.get(a.parent_id) : undefined;
    }
  }
  const list = [...byId.values()].map((a) => ({ ...a, closing: a.opening + a.debit - a.credit }));
  const leaves = list.filter((a) => !a.is_group);
  const totals = {
    debit: leaves.reduce((s, a) => s + a.debit, 0),
    credit: leaves.reduce((s, a) => s + a.credit, 0),
    closing_debit: leaves.reduce((s, a) => s + Math.max(a.closing, 0), 0),
    closing_credit: leaves.reduce((s, a) => s + Math.max(-a.closing, 0), 0),
  };
  return { accounts: list, totals, balanced: totals.debit === totals.credit && totals.closing_debit === totals.closing_credit };
}

/** دفتر الأستاذ لحساب (أو حساب رئيسي بكل فروعه) مع رصيد متحرك */
export async function ledger(db: Db, accountId: string, r: Range & { party_id?: string }) {
  const acc = await db.one(`select * from accounts where id = $1`, [accountId]);
  if (!acc) throw new AppError('الحساب غير موجود', 'not_found');
  const ids = (
    await db.query(
      `with recursive t as (select id from accounts where id = $1 union all select a.id from accounts a join t on a.parent_id = t.id) select id from t`,
      [accountId],
    )
  ).map((x) => x.id);
  const params: unknown[] = [ids];
  let partyCond = 'true';
  if (r.party_id) {
    params.push(r.party_id);
    partyCond = `l.party_id = $${params.length}`;
  }
  let opening = 0;
  if (r.from) {
    const o = await db.one(
      `select coalesce(sum(l.debit - l.credit), 0)::bigint as v from journal_lines l join journal_entries e on e.id = l.entry_id
        where l.account_id = any($1) and ${partyCond} and e.date < $${params.length + 1}`,
      [...params, r.from],
    );
    opening = o?.v ?? 0;
  }
  const cond = dateCond('e.date', r, params);
  const lines = await db.query(
    `select e.date, e.number as entry_no, e.memo as entry_memo, l.memo, l.debit, l.credit, l.party_id, p.name as party_name,
            d.id as document_id, d.number as doc_number, d.doc_type, a.name as account_name
       from journal_lines l join journal_entries e on e.id = l.entry_id
       join accounts a on a.id = l.account_id
       left join documents d on d.id = e.document_id
       left join parties p on p.id = l.party_id
      where l.account_id = any($1) and ${partyCond} and ${cond}
      order by e.date, e.number, l.id`,
    params,
  );
  let bal = opening;
  const out = lines.map((l) => {
    bal += l.debit - l.credit;
    return { ...l, balance: bal };
  });
  return { account: acc, opening, lines: out, closing: bal };
}

/** كشف حساب عميل/مورد: الرصيد موجب = عليه لنا (عميل) أو له عندنا (مورد) */
export async function partyStatement(db: Db, partyId: string, r: Range & { items?: boolean } = {}) {
  const party = await db.one(`select * from parties where id = $1`, [partyId]);
  if (!party) throw new AppError('الطرف غير موجود', 'not_found');
  const sign = party.kind === 'customer' ? 1 : -1;
  const params: unknown[] = [partyId];
  let opening = 0;
  if (r.from) {
    const o = await db.one(
      `select coalesce(sum(l.debit - l.credit), 0)::bigint as v from journal_lines l join journal_entries e on e.id = l.entry_id where l.party_id = $1 and e.date < $2`,
      [partyId, r.from],
    );
    opening = sign * (o?.v ?? 0);
  }
  const cond = dateCond('e.date', r, params);
  const lines = await db.query(
    `select e.date, e.number as entry_no, coalesce(l.memo, e.memo) as memo, l.debit, l.credit, d.id as document_id, d.number as doc_number, d.doc_type
       from journal_lines l join journal_entries e on e.id = l.entry_id left join documents d on d.id = e.document_id
      where l.party_id = $1 and ${cond} order by e.date, e.number, l.id`,
    params,
  );
  let bal = opening;
  const out: any[] = lines.map((l) => {
    bal += sign * (l.debit - l.credit);
    return { ...l, balance: bal };
  });
  // كشف حساب بالأصناف: أصناف كل مستند تُرفق بأول سطر له في الكشف
  if (r.items) {
    const ids = [...new Set(out.map((l) => l.document_id).filter(Boolean))];
    if (ids.length) {
      const dl = await db.query(
        `select dl.document_id, dl.line_no, i.code, i.name, dl.unit_name, dl.qty, dl.price, dl.discount, dl.total
           from document_lines dl join items i on i.id = dl.item_id
          where dl.document_id = any($1) order by dl.document_id, dl.line_no`,
        [ids],
      );
      const by = new Map<string, any[]>();
      for (const x of dl) (by.get(x.document_id) ?? by.set(x.document_id, []).get(x.document_id)!).push(x);
      const seen = new Set<string>();
      for (const l of out) {
        if (!l.document_id || seen.has(l.document_id)) continue;
        seen.add(l.document_id);
        if (by.has(l.document_id)) l.items = by.get(l.document_id);
      }
    }
  }
  return { party, opening, lines: out, closing: bal };
}

export async function cashboxMovement(db: Db, cashboxId: string, r: Range) {
  const cb = await db.one(`select * from cashboxes where id = $1`, [cashboxId]);
  if (!cb) throw new AppError('الخزينة غير موجودة', 'not_found');
  const l = await ledger(db, cb.account_id, r);
  return { cashbox: cb, opening: l.opening, lines: l.lines, closing: l.closing };
}

/** قائمة الدخل: الإيرادات − المصروفات للفترة */
export async function incomeStatement(db: Db, r: Range) {
  const params: unknown[] = [];
  const cond = dateCond('e.date', r, params);
  const rows = await db.query(
    `select a.id, a.code, a.name, a.type, a.system_key, coalesce(sum(l.credit - l.debit), 0)::bigint as net
       from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
       left join documents cd on cd.id = e.document_id
      where a.type in ('revenue','expense') and coalesce(cd.doc_type, '') <> 'year_closing' and ${cond}
      group by a.id order by a.code`,
    params,
  );
  const revenue = rows.filter((x) => x.type === 'revenue');
  const expenses = rows.filter((x) => x.type === 'expense').map((x) => ({ ...x, net: -x.net }));
  const sales = revenue.filter((x) => ['sales', 'sales_returns', 'sales_discount'].includes(x.system_key)).reduce((s, x) => s + x.net, 0);
  const cogs = expenses.filter((x) => x.system_key === 'cogs').reduce((s, x) => s + x.net, 0);
  const totalRevenue = revenue.reduce((s, x) => s + x.net, 0);
  const totalExpenses = expenses.reduce((s, x) => s + x.net, 0);
  return {
    revenue,
    expenses,
    net_sales: sales,
    cogs,
    gross_profit: sales - cogs,
    total_revenue: totalRevenue,
    total_expenses: totalExpenses,
    net_profit: totalRevenue - totalExpenses,
  };
}

/** الميزانية العمومية في تاريخ: الأصول = الخصوم + حقوق الملكية + صافي ربح الفترة غير المقفلة */
export async function balanceSheet(db: Db, asOf: string) {
  const rows = await db.query(
    `select a.id, a.code, a.name, a.type, a.parent_id, coalesce(sum(l.debit - l.credit), 0)::bigint as bal
       from accounts a left join journal_lines l on l.account_id = a.id
       left join journal_entries e on e.id = l.entry_id and e.date <= $1
      where a.is_group = false and (e.id is not null or l.id is null)
      group by a.id order by a.code`,
    [asOf],
  );
  const pick = (type: string, sign: number) => rows.filter((x) => x.type === type && x.bal !== 0).map((x) => ({ ...x, amount: sign * x.bal }));
  const assets = pick('asset', 1);
  const liabilities = pick('liability', -1);
  const equity = pick('equity', -1);
  const profit = -rows.filter((x) => x.type === 'revenue' || x.type === 'expense').reduce((s, x) => s + x.bal, 0);
  const totalAssets = assets.reduce((s, x) => s + x.amount, 0);
  const totalLiabilities = liabilities.reduce((s, x) => s + x.amount, 0);
  const totalEquity = equity.reduce((s, x) => s + x.amount, 0) + profit;
  return {
    as_of: asOf,
    assets,
    liabilities,
    equity,
    current_profit: profit,
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,
    total_equity: totalEquity,
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}

/** تقرير حركة صنف مع الرصيد بعد كل حركة */
export async function itemMovement(db: Db, itemId: string, r: Range & { warehouse_id?: string; doc_type?: string }) {
  const item = await db.one(`select * from items where id = $1`, [itemId]);
  if (!item) throw new AppError('الصنف غير موجود', 'not_found');
  const params: unknown[] = [itemId];
  let extra = '';
  if (r.warehouse_id) {
    params.push(r.warehouse_id);
    extra += ` and m.warehouse_id = $${params.length}`;
  }
  if (r.doc_type) {
    params.push(r.doc_type);
    extra += ` and d.doc_type = $${params.length}`;
  }
  let opening = 0;
  if (r.from) {
    const o = await db.one(
      `select coalesce(sum(m.qty), 0)::bigint as q from stock_moves m where m.item_id = $1 ${r.warehouse_id ? 'and m.warehouse_id = $3' : ''} and m.date < $2`,
      r.warehouse_id ? [itemId, r.from, r.warehouse_id] : [itemId, r.from],
    );
    opening = o?.q ?? 0;
  }
  const cond = dateCond('m.date', r, params);
  const moves = await db.query(
    `select m.id, m.date, m.qty, m.value, m.reversal, m.warehouse_id, w.name as warehouse_name, d.id as document_id, d.number as doc_number, d.doc_type,
            p.name as party_name
       from stock_moves m join documents d on d.id = m.document_id join warehouses w on w.id = m.warehouse_id
       left join parties p on p.id = d.party_id
      where m.item_id = $1 ${extra} and ${cond} order by m.date, m.id`,
    params,
  );
  let bal = opening;
  const out = moves.map((m) => {
    // عند تصفية نوع المستند لا يكون للرصيد المتحرك معنى، فنعرضه فقط بدون فلتر النوع
    bal += m.qty;
    return { ...m, balance: r.doc_type ? null : bal };
  });
  return { item, opening, moves: out, closing: r.doc_type ? null : bal };
}

/** أرصدة وقيمة البضاعة في مخزن (أو كل المخازن) */
export async function warehouseStock(db: Db, warehouseId?: string, opts: { onlyNonZero?: boolean } = {}) {
  const params: unknown[] = [];
  let cond = 'true';
  if (warehouseId) {
    params.push(warehouseId);
    cond = `b.warehouse_id = $1`;
  }
  const rows = await db.query(
    `select i.id as item_id, i.code, i.name, i.base_unit, c.name as category_name, i.reorder_level,
            coalesce(sum(b.qty), 0)::bigint as qty, coalesce(sum(b.value), 0)::bigint as value
       from items i left join stock_balances b on b.item_id = i.id and ${cond}
       left join categories c on c.id = i.category_id
      where i.active group by i.id, c.name order by i.code`,
    params,
  );
  const list = opts.onlyNonZero ? rows.filter((r) => r.qty !== 0) : rows;
  return { rows: list, total_value: list.reduce((s, r) => s + r.value, 0) };
}

export async function warehouseMovement(db: Db, warehouseId: string, r: Range & { item_id?: string }) {
  const params: unknown[] = [warehouseId];
  let extra = '';
  if (r.item_id) {
    params.push(r.item_id);
    extra = ` and m.item_id = $${params.length}`;
  }
  const cond = dateCond('m.date', r, params);
  const moves = await db.query(
    `select m.id, m.date, m.qty, m.value, m.balance_qty, m.reversal, i.code, i.name as item_name, i.base_unit, d.id as document_id, d.number as doc_number, d.doc_type
       from stock_moves m join items i on i.id = m.item_id join documents d on d.id = m.document_id
      where m.warehouse_id = $1 ${extra} and ${cond} order by m.date, m.id`,
    params,
  );
  return { moves };
}

/** الأصناف التي وصلت لحد إعادة الطلب أو أقل منه فقط */
export async function reorderReport(db: Db) {
  const rows = await db.query(
    `select i.id, i.code, i.name, i.base_unit, i.reorder_level, coalesce(sum(b.qty), 0)::bigint as qty
       from items i left join stock_balances b on b.item_id = i.id
      where i.active and i.reorder_level > 0
      group by i.id having coalesce(sum(b.qty), 0) <= i.reorder_level order by i.code`,
  );
  return { rows };
}

/** تقرير المستندات (مبيعات/مشتريات/...) مع الإجماليات، والربح للمبيعات */
export async function documentsReport(db: Db, r: Range & { doc_types?: string[]; party_id?: string; user_id?: string; status?: string; warehouse_id?: string }) {
  const params: unknown[] = [];
  const conds = [dateCond('d.date', r, params)];
  if (r.doc_types?.length) {
    params.push(r.doc_types);
    conds.push(`d.doc_type = any($${params.length})`);
  }
  for (const [col, v] of [
    ['d.party_id', r.party_id],
    ['d.created_by', r.user_id],
    ['d.status', r.status],
    ['d.warehouse_id', r.warehouse_id],
  ] as const) {
    if (v) {
      params.push(v);
      conds.push(`${col} = $${params.length}`);
    }
  }
  const rows = await db.query(
    `select d.id, d.number, d.local_number, d.doc_type, d.status, d.date, d.total, d.paid, d.tax, d.discount, d.cost, d.gross,
            p.name as party_name, u.full_name as user_name, w.name as warehouse_name
       from documents d left join parties p on p.id = d.party_id left join users u on u.id = d.created_by left join warehouses w on w.id = d.warehouse_id
      where ${conds.join(' and ')} order by d.date desc, d.created_at desc limit 2000`,
    params,
  );
  const posted = rows.filter((x) => x.status === 'posted');
  const sign = (t: string) => (t.endsWith('_return') ? -1 : 1);
  const totals = {
    count: posted.length,
    total: posted.reduce((s, x) => s + sign(x.doc_type) * x.total, 0),
    tax: posted.reduce((s, x) => s + sign(x.doc_type) * x.tax, 0),
    paid: posted.reduce((s, x) => s + sign(x.doc_type) * x.paid, 0),
    net: posted.reduce((s, x) => s + sign(x.doc_type) * (x.total - x.tax), 0),
    cost: posted.reduce((s, x) => s + sign(x.doc_type) * x.cost, 0),
  };
  return { rows, totals: { ...totals, profit: totals.net - totals.cost } };
}

export async function documentDetail(db: Db, id: string) {
  const doc = await db.one(
    `select d.*, p.name as party_name, w.name as warehouse_name, w2.name as to_warehouse_name, c.name as cashbox_name,
            a.name as account_name, u.full_name as created_by_name, pu.full_name as posted_by_name, cu.full_name as cancelled_by_name, r.number as ref_number
       from documents d left join parties p on p.id = d.party_id left join warehouses w on w.id = d.warehouse_id
       left join warehouses w2 on w2.id = d.to_warehouse_id left join cashboxes c on c.id = d.cashbox_id
       left join accounts a on a.id = d.account_id left join users u on u.id = d.created_by left join users pu on pu.id = d.posted_by
       left join users cu on cu.id = d.cancelled_by left join documents r on r.id = d.ref_doc_id where d.id = $1`,
    [id],
  );
  if (!doc) throw new AppError('المستند غير موجود', 'not_found');
  const lines = await db.query(
    `select l.*, i.code as item_code, i.name as item_name from document_lines l join items i on i.id = l.item_id where l.document_id = $1 order by l.line_no`,
    [id],
  );
  const entries = await db.query(`select * from journal_entries where document_id = $1 order by number`, [id]);
  const jlines = entries.length
    ? await db.query(
        `select l.*, a.code as account_code, a.name as account_name, p.name as party_name from journal_lines l join accounts a on a.id = l.account_id
          left join parties p on p.id = l.party_id where l.entry_id = any($1) order by l.id`,
        [entries.map((e) => e.id)],
      )
    : [];
  const related = await db.query(`select id, number, doc_type, status, total, date from documents where ref_doc_id = $1 order by created_at`, [id]);
  const auditRows = await db.query(
    `select a.at, a.action, a.sync_status, a.device_id, a.client_created_at, u.full_name as user_name, a.details from audit_log a left join users u on u.id = a.user_id
      where a.entity = 'document' and a.entity_id = $1 order by a.id`,
    [id],
  );
  const deliveries = await db.query(
    `select d.id, d.date, d.notes, d.created_at, u.full_name as user_name,
            coalesce(json_agg(json_build_object('line_id', l.line_id, 'qty', l.qty, 'serials', l.serials)) filter (where l.id is not null), '[]') as lines
       from deliveries d left join delivery_lines l on l.delivery_id = d.id left join users u on u.id = d.created_by
      where d.document_id = $1 group by d.id, u.full_name order by d.created_at`,
    [id],
  );
  return { doc, lines, entries: entries.map((e) => ({ ...e, lines: jlines.filter((l) => l.entry_id === e.id) })), related, audit: auditRows, deliveries };
}

export async function dashboard(db: Db, today: string) {
  const sales = await db.one(
    `select coalesce(sum(case when doc_type = 'sale_invoice' then total else -total end), 0)::bigint as total, count(*)::int as n
       from documents where doc_type in ('sale_invoice','sale_return') and status = 'posted' and date = $1`,
    [today],
  );
  const month = today.slice(0, 7) + '-01';
  const monthSales = await db.one(
    `select coalesce(sum(case when doc_type = 'sale_invoice' then total - tax else -(total - tax) end), 0)::bigint as net,
            coalesce(sum(case when doc_type = 'sale_invoice' then cost else -cost end), 0)::bigint as cost
       from documents where doc_type in ('sale_invoice','sale_return') and status = 'posted' and date >= $1 and date <= $2`,
    [month, today],
  );
  const cash = await db.query(`select id, name, kind, balance from cashboxes where active order by name`);
  const ar = await db.one(`select coalesce(sum(balance), 0)::bigint as v from parties where kind = 'customer'`);
  const ap = await db.one(`select coalesce(sum(balance), 0)::bigint as v from parties where kind = 'supplier'`);
  const stock = await db.one(`select coalesce(sum(value), 0)::bigint as v from stock_balances`);
  const reorder = await reorderReport(db);
  const conflicts = await db.one(`select count(*)::int as n from sync_conflicts where status = 'open'`);
  const review = await db.one(`select count(*)::int as n from documents where status = 'pending_review'`);
  return {
    today_sales: sales?.total ?? 0,
    today_count: sales?.n ?? 0,
    month_net_sales: monthSales?.net ?? 0,
    month_gross_profit: (monthSales?.net ?? 0) - (monthSales?.cost ?? 0),
    cashboxes: cash,
    receivables: ar?.v ?? 0,
    payables: ap?.v ?? 0,
    stock_value: stock?.v ?? 0,
    reorder_count: reorder.rows.length,
    open_conflicts: conflicts?.n ?? 0,
    pending_review: review?.n ?? 0,
  };
}

/** الشركاء: رأس المال والرصيد الجاري والمسحوبات والتوزيعات */
export async function partnersReport(db: Db, r: Range) {
  const partners = await db.query(`select * from partners order by name`);
  const bal = async (accId: string) =>
    (await db.one(`select coalesce(sum(l.credit - l.debit), 0)::bigint as v from journal_lines l join journal_entries e on e.id = l.entry_id where l.account_id = $1 and e.date <= $2`, [accId, r.to ?? '9999-12-31']))?.v ?? 0;
  const rows = [];
  for (const p of partners) {
    const params: unknown[] = [p.id];
    const cond = dateCond('d.date', r, params);
    const sums = await db.one(
      `select coalesce(sum(case when d.doc_type = 'partner_withdrawal' then d.total else 0 end), 0)::bigint as withdrawals,
              coalesce(sum(case when d.doc_type = 'partner_capital' then d.total else 0 end), 0)::bigint as capital_in
         from documents d where d.partner_id = $1 and d.status = 'posted' and ${cond}`,
      params,
    );
    rows.push({ ...p, capital: await bal(p.capital_account_id), current: await bal(p.current_account_id), withdrawals: sums?.withdrawals ?? 0, capital_in: sums?.capital_in ?? 0 });
  }
  const distributions = await db.query(
    `select id, number, date, status, total, data from documents where doc_type = 'profit_distribution' and status <> 'cancelled' order by date desc`,
  );
  return {
    partners: rows,
    totals: { ownership_bp: rows.filter((p) => p.active).reduce((s, p) => s + p.ownership_bp, 0), profit_bp: rows.filter((p) => p.active).reduce((s, p) => s + p.profit_bp, 0) },
    distributions,
  };
}

export async function serialSearch(db: Db, q: string) {
  if (!q.trim()) return { rows: [] };
  const rows = await db.query(
    `select s.serial, s.status, i.name as item_name, i.code, w.name as warehouse_name, m.direction, m.reversal, m.created_at, d.id as document_id, d.number, d.doc_type, d.date, p.name as party_name
       from serials s join items i on i.id = s.item_id left join warehouses w on w.id = s.warehouse_id
       left join serial_moves m on m.serial_id = s.id left join documents d on d.id = m.document_id left join parties p on p.id = d.party_id
      where s.serial ilike $1 order by s.serial, m.id`,
    [`%${q.trim()}%`],
  );
  return { rows };
}

export async function expiryReport(db: Db, f: { warehouse_id?: string; until?: string }) {
  const params: unknown[] = [];
  const conds = ['l.qty > 0'];
  if (f.warehouse_id) {
    params.push(f.warehouse_id);
    conds.push(`l.warehouse_id = $${params.length}`);
  }
  if (f.until) {
    params.push(f.until);
    conds.push(`l.expiry <= $${params.length}`);
  }
  const rows = await db.query(
    `select l.id, l.expiry, l.qty, i.id as item_id, i.code, i.name, i.base_unit, i.avg_cost, i.expiry_alert_days, w.name as warehouse_name,
            (l.expiry - current_date) as days_left
       from stock_lots l join items i on i.id = l.item_id join warehouses w on w.id = l.warehouse_id
      where ${conds.join(' and ')} order by l.expiry, i.code`,
    params,
  );
  return { rows };
}

/** تحليل المبيعات/المشتريات بالتجميع (صنف، عميل، مندوب، مستخدم، مخزن، تصنيف، يوم، شهر، ساعة، يوم الأسبوع) */
export async function salesAnalysis(db: Db, r: Range & { group: string; kind: 'sales' | 'purchases' }) {
  const groups: Record<string, { key: string; label: string; join?: string; line?: boolean }> = {
    item: { key: `i.id`, label: `i.code || ' — ' || i.name`, line: true },
    category: { key: `coalesce(c.id, '-')`, label: `coalesce(c.name, 'بدون تصنيف')`, line: true },
    party: { key: `d.party_id`, label: `p.name` },
    rep: { key: `coalesce(d.sales_rep_id, '-')`, label: `coalesce(sr.name, 'بدون مندوب')` },
    user: { key: `d.created_by`, label: `u.full_name` },
    warehouse: { key: `d.warehouse_id`, label: `w.name` },
    day: { key: `d.date::text`, label: `d.date::text` },
    month: { key: `to_char(d.date, 'YYYY-MM')`, label: `to_char(d.date, 'YYYY-MM')` },
    hour: { key: `extract(hour from d.created_at)::int::text`, label: `lpad(extract(hour from d.created_at)::int::text, 2, '0') || ':00'` },
    weekday: { key: `extract(dow from d.date)::int::text`, label: `(array['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'])[extract(dow from d.date)::int + 1]` },
  };
  const g = groups[r.group] ?? groups.item;
  const types = r.kind === 'sales' ? ['sale_invoice', 'sale_return'] : ['purchase_invoice', 'purchase_return'];
  const params: unknown[] = [types];
  const cond = dateCond('d.date', r, params);
  const sign = `case when d.doc_type like '%_return' then -1 else 1 end`;
  const rows = await db.query(
    `select ${g.key} as key, ${g.label} as label,
            count(distinct d.id)::int as docs,
            coalesce(sum(${sign} * l.base_qty), 0)::bigint as qty,
            coalesce(sum(${sign} * (l.total - l.tax)), 0)::bigint as net,
            coalesce(sum(${sign} * (l.discount + l.doc_discount)), 0)::bigint as discount,
            coalesce(sum(${sign} * l.cost), 0)::bigint as cost
       from documents d join document_lines l on l.document_id = d.id join items i on i.id = l.item_id
       left join categories c on c.id = i.category_id left join parties p on p.id = d.party_id
       left join sales_reps sr on sr.id = d.sales_rep_id left join users u on u.id = d.created_by left join warehouses w on w.id = d.warehouse_id
      where d.doc_type = any($1) and d.status = 'posted' and ${cond}
      group by 1, 2 order by net desc`,
    params,
  );
  const totalNet = rows.reduce((s, x) => s + x.net, 0);
  const out = rows.map((x) => ({ ...x, profit: x.net - x.cost, share_bp: totalNet ? Math.round((x.net * 10000) / totalNet) : 0 }));
  return { rows: out, totals: { net: totalNet, cost: rows.reduce((s, x) => s + x.cost, 0), qty: rows.reduce((s, x) => s + x.qty, 0) } };
}

/** عمولات المندوبين: صافي المبيعات (بدون ضريبة، بعد المرتجعات) × نسبة العمولة، والمصروف منها */
export async function commissionsReport(db: Db, r: Range) {
  const reps = await db.query(`select * from sales_reps order by name`);
  const params: unknown[] = [];
  const cond = dateCond('d.date', r, params);
  const sales = await db.query(
    `select d.sales_rep_id as rep, count(*) filter (where d.doc_type = 'sale_invoice')::int as invoices,
            coalesce(sum(case when d.doc_type = 'sale_invoice' then d.total - d.tax - d.charges_total else 0 end), 0)::bigint as sales,
            coalesce(sum(case when d.doc_type = 'sale_return' then d.total - d.tax else 0 end), 0)::bigint as returns,
            coalesce(sum(case when d.doc_type = 'sale_invoice' then d.cost else -d.cost end), 0)::bigint as cost
       from documents d where d.status = 'posted' and d.doc_type in ('sale_invoice','sale_return') and d.sales_rep_id is not null and ${cond}
      group by d.sales_rep_id`,
    params,
  );
  const paid = await db.query(
    `select d.sales_rep_id as rep, coalesce(sum(d.total), 0)::bigint as paid
       from documents d join accounts a on a.id = d.account_id
      where d.status = 'posted' and d.doc_type = 'expense' and a.system_key = 'commissions' and d.sales_rep_id is not null and ${cond}
      group by d.sales_rep_id`,
    params,
  );
  const sm = new Map(sales.map((x) => [x.rep, x]));
  const pm = new Map(paid.map((x) => [x.rep, x.paid]));
  const rows = reps.map((rep) => {
    const s = sm.get(rep.id) ?? { invoices: 0, sales: 0, returns: 0, cost: 0 };
    const net = s.sales - s.returns;
    const commission = Math.round((net * rep.commission_bp) / 10000);
    const paidAmt = pm.get(rep.id) ?? 0;
    return { id: rep.id, name: rep.name, active: rep.active, commission_bp: rep.commission_bp, invoices: s.invoices, sales: s.sales, returns: s.returns, net, profit: net - s.cost, commission, paid: paidAmt, due: commission - paidAmt };
  });
  return { rows, totals: { net: rows.reduce((a, x) => a + x.net, 0), commission: rows.reduce((a, x) => a + x.commission, 0), paid: rows.reduce((a, x) => a + x.paid, 0), due: rows.reduce((a, x) => a + x.due, 0) } };
}

/** معاينة إقفال السنة: صافي الربح حتى التاريخ منذ آخر إقفال */
export async function closingPreview(db: Db, date: string) {
  const last = await db.one(`select max(date) as d from documents where doc_type = 'year_closing' and status = 'posted'`);
  const from = last?.d ? (() => { const x = new Date(last.d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); })() : undefined;
  const is = await incomeStatement(db, { from, to: date });
  const dist = await db.one(
    `select coalesce(sum(l.debit - l.credit), 0)::bigint as v from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
      left join documents cd on cd.id = e.document_id where a.system_key = 'profit_distribution' and e.date <= $1 and coalesce(cd.doc_type,'') <> 'year_closing'`,
    [date],
  );
  const locked = (await db.one(`select value from settings where key = 'locked_until'`))?.value ?? null;
  return { from: from ?? null, to: date, last_closing: last?.d ?? null, revenue: is.total_revenue, expenses: is.total_expenses, net_profit: is.net_profit, distributions: dist?.v ?? 0, locked_until: locked };
}

// ---------------------------------------------------------------- حركة الخزائن (أساس تحليل المقبوضات والمصروفات والحركة اليومية)
/**
 * سطور القيود على حسابات الخزائن والبنوك. المدين = مقبوض، الدائن = مدفوع.
 * المستندات الملغاة تُستبعد بأصلها وعكسها معًا (أثرها الصافي صفر).
 */
const CASH_LINES = `
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join cashboxes cb on cb.account_id = l.account_id
  left join documents d on d.id = e.document_id
  left join parties p on p.id = coalesce(l.party_id, d.party_id)
  left join accounts da on da.id = d.account_id
  left join users u on u.id = d.created_by`;

/** تحليل المقبوضات أو المصروفات حسب البند/الطرف/الخزينة/المستخدم/النوع/اليوم/الشهر */
export async function treasuryAnalysis(db: Db, r: Range & { dir: 'in' | 'out'; group: string; cashbox_id?: string; user_id?: string; internal?: boolean }) {
  const groups: Record<string, { key: string; label: string }> = {
    // البند: حساب المصروف/الإيراد إن وُجد، وإلا نوع المستند
    item: { key: `coalesce(da.id, d.doc_type, 'jv')`, label: `coalesce(da.name, d.doc_type, 'jv')` },
    type: { key: `coalesce(d.doc_type, 'jv')`, label: `coalesce(d.doc_type, 'jv')` },
    party: { key: `coalesce(p.id, '-')`, label: `coalesce(p.name, 'بدون طرف')` },
    cashbox: { key: `cb.id`, label: `cb.name` },
    user: { key: `coalesce(u.id, '-')`, label: `coalesce(u.full_name, '—')` },
    day: { key: `e.date::text`, label: `e.date::text` },
    month: { key: `to_char(e.date, 'YYYY-MM')`, label: `to_char(e.date, 'YYYY-MM')` },
  };
  const g = groups[r.group] ?? groups.item;
  const amt = r.dir === 'in' ? 'l.debit' : 'l.credit';
  const params: unknown[] = [];
  const conds = [dateCond('e.date', r, params), `${amt} > 0`, `coalesce(d.status, 'posted') <> 'cancelled'`];
  // التحويل بين الخزائن نقل داخلي: لا يُحسب مقبوضًا ولا مصروفًا إلا عند طلبه صراحة
  if (!r.internal) conds.push(`coalesce(d.doc_type, '') <> 'cash_transfer'`);
  if (r.cashbox_id) {
    params.push(r.cashbox_id);
    conds.push(`cb.id = $${params.length}`);
  }
  if (r.user_id) {
    params.push(r.user_id);
    conds.push(`d.created_by = $${params.length}`);
  }
  const rows = await db.query(
    `select ${g.key} as key, ${g.label} as label, count(distinct e.id)::int as count, sum(${amt})::bigint as amount
       ${CASH_LINES}
      where ${conds.join(' and ')}
      group by 1, 2 order by amount desc`,
    params,
  );
  const total = rows.reduce((s, x) => s + Number(x.amount), 0);
  return { rows: rows.map((x) => ({ ...x, amount: Number(x.amount), share_bp: total ? Math.round((Number(x.amount) * 10000) / total) : 0 })), total };
}

/** الحركة اليومية: ملخص المستندات بأنواعها + حركة كل خزينة + قائمة المستندات للفترة (افتراضيًا يوم واحد) */
export async function dailyMovement(db: Db, r: Range & { user_id?: string }) {
  const params: unknown[] = [];
  const conds = [dateCond('d.date', r, params), `d.status in ('posted','pending_review')`, `d.doc_type not in ('quotation','year_closing')`];
  if (r.user_id) {
    params.push(r.user_id);
    conds.push(`d.created_by = $${params.length}`);
  }
  const docs = await db.query(
    `select d.id, d.doc_type, d.number, d.local_number, d.status, d.date, d.created_at, d.total, d.paid, d.discount, d.payment_type,
            p.name as party_name, u.full_name as user_name, w.name as warehouse_name, cb.name as cashbox_name
       from documents d left join parties p on p.id = d.party_id left join users u on u.id = d.created_by
       left join warehouses w on w.id = d.warehouse_id left join cashboxes cb on cb.id = d.cashbox_id
      where ${conds.join(' and ')}
      order by d.created_at`,
    params,
  );
  const byType = new Map<string, { doc_type: string; count: number; total: number; paid: number; remaining: number }>();
  for (const d of docs) {
    const t = byType.get(d.doc_type) ?? { doc_type: d.doc_type, count: 0, total: 0, paid: 0, remaining: 0 };
    t.count++;
    t.total += Number(d.total);
    t.paid += Number(d.paid);
    if (['sale_invoice', 'purchase_invoice'].includes(d.doc_type)) t.remaining += Number(d.total) - Number(d.paid);
    byType.set(d.doc_type, t);
  }
  // حركة الخزائن: رصيد أول الفترة + مقبوضات + مدفوعات + الرصيد آخرها
  const p2: unknown[] = [];
  const inRange = dateCond('e.date', r, p2);
  let before = 'false';
  if (r.from) {
    p2.push(r.from);
    before = `e.date < $${p2.length}`;
  }
  let mine = '';
  if (r.user_id) {
    p2.push(r.user_id);
    mine = ` and d.created_by = $${p2.length}`;
  }
  const live = `coalesce(d.status, 'posted') <> 'cancelled'`;
  const boxes = await db.query(
    `select cb.id, cb.name, cb.kind,
            coalesce(sum(case when ${before} then l.debit - l.credit end), 0)::bigint as opening,
            coalesce(sum(case when ${inRange} and ${live}${mine} then l.debit end), 0)::bigint as cash_in,
            coalesce(sum(case when ${inRange} and ${live}${mine} then l.credit end), 0)::bigint as cash_out,
            coalesce(sum(case when ${inRange} then l.debit - l.credit end), 0)::bigint as net_all
       ${CASH_LINES}
      group by cb.id, cb.name, cb.kind order by cb.kind, cb.name`,
    p2,
  );
  return {
    by_type: [...byType.values()],
    cashboxes: boxes.map((b) => ({ ...b, opening: Number(b.opening), cash_in: Number(b.cash_in), cash_out: Number(b.cash_out), closing: Number(b.opening) + Number(b.net_all) })),
    docs,
  };
}
