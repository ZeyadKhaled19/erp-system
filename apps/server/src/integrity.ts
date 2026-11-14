import type { Db } from './db';

/**
 * فحص سلامة البيانات (قراءة فقط، ما بيعدّلش أي حاجة):
 * الأرصدة المحفوظة الجاهزة (للسرعة) لازم تساوي اللي محسوب من القيود وحركات المخزن.
 * كل المبالغ بالقرش، والكميات بالوحدة الأساسية (milli).
 */
export interface IntegrityIssue {
  /** الاسم اللي يفهمه المستخدم (العميل، الخزينة، الصنف...) */
  name: string;
  /** الرصيد المحفوظ */
  stored: number;
  /** الرصيد المحسوب من القيود أو الحركات */
  computed: number;
  id?: string;
}

export interface IntegrityCheck {
  key: string;
  label: string;
  /** money = مبلغ بالقرش، qty = كمية بالوحدة الأساسية، count = عدد */
  unit: 'money' | 'qty' | 'count';
  checked: number;
  issues: IntegrityIssue[];
}

export interface IntegrityReport {
  ok: boolean;
  at: string;
  checks: IntegrityCheck[];
}

const LIMIT = 50;
const n = (v: unknown) => Number(v ?? 0);

export async function integrityCheck(db: Db): Promise<IntegrityReport> {
  const checks: IntegrityCheck[] = [];

  // 1) كل قيد متوازن
  {
    const total = await db.one(`select count(*)::bigint as c from journal_entries`);
    const rows = await db.query(
      `select e.id, e.number, coalesce(sum(l.debit), 0)::bigint as dr, coalesce(sum(l.credit), 0)::bigint as cr
         from journal_entries e left join journal_lines l on l.entry_id = e.id
        group by e.id, e.number
       having coalesce(sum(l.debit), 0) <> coalesce(sum(l.credit), 0)
        order by e.number limit ${LIMIT}`,
    );
    checks.push({
      key: 'balanced', label: 'كل القيود متوازنة (المدين = الدائن)', unit: 'money', checked: n(total?.c),
      issues: rows.map((r) => ({ id: r.id, name: `قيد رقم ${r.number}`, stored: n(r.dr), computed: n(r.cr) })),
    });
  }

  // 2) أرصدة العملاء والموردين = مجموع سطور القيود المربوطة بيهم
  {
    const rows = await db.query(
      `select p.id, p.name, p.kind, p.balance::bigint as stored,
              coalesce(sum(case when p.kind = 'customer' then l.debit - l.credit else l.credit - l.debit end), 0)::bigint as computed
         from parties p left join journal_lines l on l.party_id = p.id
        group by p.id, p.name, p.kind, p.balance`,
    );
    const bad = rows.filter((r) => n(r.stored) !== n(r.computed));
    checks.push({
      key: 'parties', label: 'أرصدة العملاء والموردين', unit: 'money', checked: rows.length,
      issues: bad.slice(0, LIMIT).map((r) => ({ id: r.id, name: `${r.kind === 'customer' ? 'عميل' : 'مورد'}: ${r.name}`, stored: n(r.stored), computed: n(r.computed) })),
    });
  }

  // 3) أرصدة الخزائن والبنوك = حركة حساباتها في القيود
  {
    const rows = await db.query(
      `select c.id, c.name, c.balance::bigint as stored, coalesce(sum(l.debit - l.credit), 0)::bigint as computed
         from cashboxes c left join journal_lines l on l.account_id = c.account_id
        group by c.id, c.name, c.balance`,
    );
    const bad = rows.filter((r) => n(r.stored) !== n(r.computed));
    checks.push({
      key: 'cashboxes', label: 'أرصدة الخزائن والبنوك', unit: 'money', checked: rows.length,
      issues: bad.slice(0, LIMIT).map((r) => ({ id: r.id, name: r.name, stored: n(r.stored), computed: n(r.computed) })),
    });
  }

  // 4) سلف الموظفين = حركة حساب السلف في القيود
  {
    const rows = await db.query(
      `select e.id, e.name, e.advance_balance::bigint as stored, coalesce(sum(l.debit - l.credit), 0)::bigint as computed
         from employees e left join journal_lines l on l.account_id = e.advance_account_id
        where e.advance_account_id is not null
        group by e.id, e.name, e.advance_balance`,
    );
    const bad = rows.filter((r) => n(r.stored) !== n(r.computed));
    checks.push({
      key: 'advances', label: 'أرصدة سلف الموظفين', unit: 'money', checked: rows.length,
      issues: bad.slice(0, LIMIT).map((r) => ({ id: r.id, name: r.name, stored: n(r.stored), computed: n(r.computed) })),
    });
  }

  // 5) كميات المخزون = مجموع حركات المخزن لكل صنف في كل مخزن
  {
    const rows = await db.query(
      `with m as (select item_id, warehouse_id, sum(qty)::bigint as q from stock_moves group by item_id, warehouse_id),
            k as (select item_id, warehouse_id from stock_balances union select item_id, warehouse_id from m)
       select k.item_id, k.warehouse_id, i.name as item, w.name as wh,
              coalesce(b.qty, 0)::bigint as stored, coalesce(m.q, 0)::bigint as computed
         from k
         left join stock_balances b on b.item_id = k.item_id and b.warehouse_id = k.warehouse_id
         left join m on m.item_id = k.item_id and m.warehouse_id = k.warehouse_id
         left join items i on i.id = k.item_id
         left join warehouses w on w.id = k.warehouse_id`,
    );
    const bad = rows.filter((r) => n(r.stored) !== n(r.computed));
    checks.push({
      key: 'stock', label: 'كميات المخزون في كل مخزن', unit: 'qty', checked: rows.length,
      issues: bad.slice(0, LIMIT).map((r) => ({ id: r.item_id, name: `${r.item ?? r.item_id} — ${r.wh ?? r.warehouse_id}`, stored: n(r.stored), computed: n(r.computed) })),
    });
  }

  // 6) مفيش مستند مرحّل اتلغى وقيده لسه شغال (القيد الأصلي لازم يكون معكوس)
  {
    const total = await db.one(`select count(*)::bigint as c from documents where status = 'cancelled'`);
    const rows = await db.query(
      `select d.id, coalesce(d.number, d.local_number, d.id) as no, count(*)::bigint as open_entries
         from documents d join journal_entries e on e.document_id = d.id
        where d.status = 'cancelled' and e.reverses_id is null and e.reversed_by_id is null
        group by d.id, d.number, d.local_number
        limit ${LIMIT}`,
    );
    checks.push({
      key: 'cancelled', label: 'المستندات الملغاة قيودها معكوسة', unit: 'count', checked: n(total?.c),
      issues: rows.map((r) => ({ id: r.id, name: `مستند ${r.no}`, stored: n(r.open_entries), computed: 0 })),
    });
  }

  return { ok: checks.every((c) => c.issues.length === 0), at: new Date().toISOString(), checks };
}
