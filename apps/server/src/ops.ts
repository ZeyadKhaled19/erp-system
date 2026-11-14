import { DOC_TYPES, hasPermission, MASTER_SCHEMAS, opEnvelopeSchema, type MasterEntity, type Op, type OpEnvelope, type OpResult } from '@erp/shared';
import type { AuthUser } from './auth';
import type { Db } from './db';
import { AppError, pgErrorToApp, ReviewError } from './errors';
import { cancelDocument, createAndPost, postDocument, saveDocument, type Ctx } from './posting/documents';
import { trackOut } from './posting/tracking';

const WRITE_LOCK = 7331;

const MASTER_TABLE: Record<MasterEntity, string> = {
  item: 'items',
  party: 'parties',
  warehouse: 'warehouses',
  category: 'categories',
  cashbox: 'cashboxes',
  account: 'accounts',
  sales_rep: 'sales_reps',
  price_list: 'price_lists',
  partner: 'partners',
  party_group: 'party_groups',
  employee: 'employees',
  attendance: 'attendance',
  department: 'departments',
  job_title: 'job_titles',
};

const MASTER_PERM: Record<MasterEntity, [create: string, edit: string]> = {
  item: ['items.create', 'items.edit'],
  party: ['parties.create', 'parties.edit'],
  warehouse: ['items.create', 'items.edit'],
  category: ['items.create', 'items.edit'],
  cashbox: ['treasury.manage', 'treasury.manage'],
  account: ['accounts.manage', 'accounts.manage'],
  sales_rep: ['parties.create', 'parties.edit'],
  price_list: ['settings.manage', 'settings.manage'],
  partner: ['partners.manage', 'partners.manage'],
  party_group: ['parties.create', 'parties.edit'],
  employee: ['employees.manage', 'employees.manage'],
  attendance: ['employees.attendance', 'employees.attendance'],
  department: ['employees.manage', 'employees.manage'],
  job_title: ['employees.manage', 'employees.manage'],
};

const ENTITY_LABEL: Record<MasterEntity, string> = {
  item: 'الصنف',
  party: 'الطرف',
  warehouse: 'المخزن',
  category: 'التصنيف',
  cashbox: 'الخزينة',
  account: 'الحساب',
  sales_rep: 'المندوب',
  price_list: 'قائمة الأسعار',
  partner: 'الشريك',
  party_group: 'نوع العميل',
  employee: 'الموظف',
  attendance: 'سجل الحضور',
  department: 'الإدارة',
  job_title: 'الوظيفة',
};

/** يمشي لفوق في سلسلة (مدير المدير… أو الإدارة الأم…) ويرفض لو رجع لنفس السجل */
async function assertNoCycle(t: Db, table: 'employees' | 'departments', col: 'manager_id' | 'parent_id', id: string, start: string | null | undefined, message: string) {
  const seen = new Set<string>();
  for (let cur = start ?? null; cur; ) {
    if (cur === id || seen.has(cur)) throw new AppError(message);
    seen.add(cur);
    cur = (await t.one(`select ${col} as p from ${table} where id = $1`, [cur]))?.p ?? null;
  }
}

function need(user: AuthUser, perm: string) {
  if (!hasPermission(user.permissions, perm)) throw new AppError('ليس لديك صلاحية لهذه العملية', 'forbidden');
}

async function audit(t: Db, ctx: Ctx, env: OpEnvelope | undefined, action: string, entity: string | null, entityId: string | null, status: string, details?: unknown) {
  await t.query(
    `insert into audit_log (user_id, device_id, op_id, action, entity, entity_id, sync_status, client_created_at, details) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ctx.user.id, ctx.deviceId, env?.op_id ?? null, action, entity, entityId, status, env?.created_at ?? null, details === undefined ? null : JSON.stringify(details)],
  );
}

async function createConflict(t: Db, ctx: Ctx, c: { kind: string; entity: string; entity_id: string; message: string; server_data?: unknown; client_data?: unknown }) {
  const id = crypto.randomUUID();
  await t.query(
    `insert into sync_conflicts (id, op_id, kind, entity, entity_id, message, server_data, client_data, created_by, device_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, ctx.opId ?? null, c.kind, c.entity, c.entity_id, c.message, JSON.stringify(c.server_data ?? null), JSON.stringify(c.client_data ?? null), ctx.user.id, ctx.deviceId],
  );
  return id;
}

// ---------------- البيانات الأساسية ----------------

async function writeMaster(t: Db, ctx: Ctx, entity: MasterEntity, id: string, data: any, existing: any | undefined) {
  const table = MASTER_TABLE[entity];
  const parsed = MASTER_SCHEMAS[entity].parse(data) as any;
  const fields: Record<string, unknown> = { ...parsed };
  delete fields.units;
  delete fields.prices;

  if (entity === 'partner') {
    if (existing) {
      await t.query(`update accounts set name = $2 where id = $1`, [existing.capital_account_id, `رأس مال ${fields.name}`]);
      await t.query(`update accounts set name = $2 where id = $1`, [existing.current_account_id, `جاري ${fields.name}`]);
    } else {
      // لكل شريك حساب رأس مال وحساب جاري فرعيان في الدليل
      const mk = async (groupKey: string, type: string, name: string) => {
        const g = await t.one(`select * from accounts where system_key = $1`, [groupKey]);
        if (!g) throw new AppError('حسابات الشركاء الرئيسية غير موجودة في الدليل', 'state');
        const last = await t.one(`select max(code) as c from accounts where parent_id = $1`, [g.id]);
        const code = last?.c ? String(BigInt(last.c) + 1n) : `${g.code}01`;
        const accId = crypto.randomUUID();
        await t.query(`insert into accounts (id, code, name, parent_id, type) values ($1,$2,$3,$4,$5)`, [accId, code, name, g.id, type]);
        return accId;
      };
      fields.capital_account_id = await mk('partners_capital_group', 'equity', `رأس مال ${fields.name}`);
      fields.current_account_id = await mk('partners_current_group', 'liability', `جاري ${fields.name}`);
    }
  }

  if (entity === 'employee') {
    // الهيكل التنظيمي (الأجهزة القديمة اللي ما بتبعتش الحقول دي ما بتغيّرهاش)
    if ('department_id' in fields) {
      fields.department_id = fields.department_id || null;
      if (fields.department_id && !(await t.one(`select id from departments where id = $1`, [fields.department_id]))) throw new AppError('الإدارة غير موجودة');
    }
    if ('job_title_id' in fields) {
      fields.job_title_id = fields.job_title_id || null;
      if (fields.job_title_id) {
        const jt = await t.one(`select name from job_titles where id = $1`, [fields.job_title_id]);
        if (!jt) throw new AppError('الوظيفة غير موجودة');
        // اسم الوظيفة يتحفظ نصًا كمان (للتقارير والأجهزة القديمة)
        fields.job_title = jt.name;
      }
    }
    if ('manager_id' in fields) {
      fields.manager_id = fields.manager_id || null;
      if (fields.manager_id) {
        if (fields.manager_id === id) throw new AppError('الموظف لا يكون مديرًا لنفسه');
        if (!(await t.one(`select id from employees where id = $1`, [fields.manager_id]))) throw new AppError('المدير المباشر غير موجود');
        await assertNoCycle(t, 'employees', 'manager_id', id, fields.manager_id as string, 'لا يمكن أن يتبع الموظف أحد الموظفين التابعين له');
      }
    }
    fields.code = fields.code || null;
    fields.hire_date = fields.hire_date || null;
    fields.user_id = fields.user_id || null;
    if (existing) {
      await t.query(`update accounts set name = $2 where id = $1`, [existing.advance_account_id, `سلف ${fields.name}`]);
    } else {
      // لكل موظف حساب سلف فرعي تحت «سلف الموظفين»
      const g = await t.one(`select * from accounts where system_key = 'employee_advances_group'`);
      if (!g) throw new AppError('حساب سلف الموظفين الرئيسي غير موجود في الدليل', 'state');
      const last = await t.one(`select max(code) as c from accounts where parent_id = $1`, [g.id]);
      const code = last?.c ? String(BigInt(last.c) + 1n) : `${g.code}01`;
      const accId = crypto.randomUUID();
      await t.query(`insert into accounts (id, code, name, parent_id, type) values ($1,$2,$3,$4,'asset')`, [accId, code, `سلف ${fields.name}`, g.id]);
      fields.advance_account_id = accId;
    }
  }

  if (entity === 'department') {
    fields.parent_id = fields.parent_id || null;
    fields.manager_id = fields.manager_id || null;
    if (fields.parent_id) {
      if (fields.parent_id === id) throw new AppError('الإدارة لا تكون تابعة لنفسها');
      if (!(await t.one(`select id from departments where id = $1`, [fields.parent_id]))) throw new AppError('الإدارة الأم غير موجودة');
      await assertNoCycle(t, 'departments', 'parent_id', id, fields.parent_id as string, 'لا يمكن أن تتبع الإدارة إحدى الإدارات التابعة لها');
    }
    if (fields.manager_id && !(await t.one(`select id from employees where id = $1`, [fields.manager_id]))) throw new AppError('مدير الإدارة غير موجود');
    if (existing && existing.active && !fields.active) {
      const busy = await t.one(`select (select count(*)::int from employees where department_id = $1 and active) as e, (select count(*)::int from departments where parent_id = $1 and active) as d`, [id]);
      if (busy?.e) throw new AppError(`لا يمكن إيقاف الإدارة وفيها ${busy.e} موظف نشط — انقلهم لإدارة تانية الأول`);
      if (busy?.d) throw new AppError('لا يمكن إيقاف الإدارة وتحتها أقسام نشطة');
    }
  }

  if (entity === 'job_title') {
    const dup = await t.one(`select id from job_titles where lower(btrim(name)) = lower(btrim($1)) and id <> $2`, [fields.name, id]);
    if (dup) throw new AppError('الوظيفة دي موجودة بالفعل في القائمة');
    if (existing && existing.name !== fields.name) {
      // تغيير اسم الوظيفة يتنقل لكل الموظفين المربوطين بيها
      await t.query(`update employees set job_title = $2 where job_title_id = $1`, [id, fields.name]);
    }
  }

  if (entity === 'attendance') {
    const emp = await t.one(`select id, active from employees where id = $1`, [fields.employee_id]);
    if (!emp) throw new AppError('الموظف غير موجود');
    fields.check_in = fields.check_in || null;
    fields.check_out = fields.check_out || null;
    if (fields.check_out && !fields.check_in) throw new AppError('سجّل وقت الحضور قبل الانصراف');
    if (fields.check_in && fields.check_out && fields.check_out < fields.check_in) throw new AppError('وقت الانصراف قبل وقت الحضور');
    if ((fields.status === 'absent' || fields.status === 'leave') && fields.check_in) throw new AppError('الموظف الغائب أو في إجازة لا يكون له وقت حضور');
    // سجل واحد لكل موظف في اليوم (الأجهزة تستخدم معرفًا ثابتًا: الموظف + التاريخ)
    if (!existing) {
      const same = await t.one(`select id from attendance where employee_id = $1 and date = $2`, [fields.employee_id, fields.date]);
      if (same && same.id !== id) throw new AppError('الحضور مسجل لهذا الموظف في نفس اليوم بالفعل');
    } else if (existing.employee_id !== fields.employee_id || String(existing.date).slice(0, 10) !== fields.date) {
      throw new AppError('لا يمكن نقل سجل الحضور لموظف أو يوم آخر');
    }
  }

  if (entity === 'account') {
    if (fields.parent_id) {
      const p = await t.one(`select * from accounts where id = $1`, [fields.parent_id]);
      if (!p) throw new AppError('الحساب الرئيسي غير موجود');
      if (!p.is_group) throw new AppError('الحساب الأب يجب أن يكون حسابًا رئيسيًا');
      if (p.id === id) throw new AppError('لا يمكن أن يكون الحساب أبًا لنفسه');
      if (p.type !== fields.type) throw new AppError('نوع الحساب يجب أن يطابق نوع الحساب الرئيسي');
    }
    if (existing) {
      if (existing.system_key && existing.type !== fields.type) throw new AppError('لا يمكن تغيير نوع حساب نظامي');
      if (existing.system_key && !fields.active) throw new AppError('لا يمكن إيقاف حساب نظامي');
      if (fields.is_group !== existing.is_group) {
        const used = await t.one(`select count(*)::int as n from journal_lines where account_id = $1`, [id]);
        if (used?.n) throw new AppError('لا يمكن تغيير الحساب إلى رئيسي/فرعي بعد استخدامه في قيود');
      }
    }
  }

  if (entity === 'cashbox') {
    if (existing) {
      delete fields.kind; // نوع الخزينة لا يتغير بعد الإنشاء
      await t.query(`update accounts set name = $2 where id = $1`, [existing.account_id, fields.name]);
    } else {
      const parentKey = fields.kind === 'bank' ? 'bank_group' : 'cash_group';
      const parent = await t.one(`select * from accounts where system_key = $1`, [parentKey]);
      const last = await t.one(`select max(code) as c from accounts where parent_id = $1`, [parent.id]);
      const code = last?.c ? String(BigInt(last.c) + 1n) : `${parent.code}01`;
      const accId = crypto.randomUUID();
      await t.query(`insert into accounts (id, code, name, parent_id, type) values ($1,$2,$3,$4,'asset')`, [accId, code, fields.name, parent.id]);
      fields.account_id = accId;
    }
  }

  if (entity === 'item') {
    fields.barcode = fields.barcode || null;
    fields.updated_by = ctx.user.id;
  }

  const cols = Object.keys(fields);
  if (existing) {
    const extra = entity === 'item' ? ', updated_at = now()' : '';
    await t.query(
      `update ${table} set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, version = version + 1${extra} where id = $1`,
      [id, ...cols.map((c) => fields[c])],
    );
  } else {
    await t.query(`insert into ${table} (id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`, [id, ...cols.map((c) => fields[c])]);
  }

  if (entity === 'item') {
    const units: any[] = parsed.units ?? [];
    for (const u of units) {
      if (u.name === parsed.base_unit) throw new AppError('اسم الوحدة الفرعية يجب أن يختلف عن الوحدة الأساسية');
      await t.query(
        `insert into item_units (id, item_id, name, factor, barcode, sale_price, wholesale_price, active) values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do update set name = excluded.name, factor = excluded.factor, barcode = excluded.barcode,
           sale_price = excluded.sale_price, wholesale_price = excluded.wholesale_price, active = excluded.active`,
        [u.id, id, u.name, u.factor, u.barcode || null, u.sale_price, u.wholesale_price, u.active],
      );
    }
    // الوحدات المحذوفة من النموذج تُوقف ولا تُحذف (قد تكون مستخدمة في مستندات)
    const keep = units.map((u) => u.id);
    await t.query(`update item_units set active = false where item_id = $1 and active and not (id = any($2))`, [id, keep]);
    if (parsed.barcode) {
      const dup = await t.one(`select 1 from item_units where barcode = $1`, [parsed.barcode]);
      if (dup) throw new AppError('الباركود مستخدم لوحدة صنف آخر');
    }
    // أسعار قوائم الأسعار: القيمة 0 تحذف السعر الخاص (يرجع للسعر الافتراضي)
    for (const p of parsed.prices ?? []) {
      if (p.price > 0) {
        await t.query(
          `insert into item_prices (id, item_id, unit_name, price_list_id, price) values ($1,$2,$3,$4,$5)
           on conflict (item_id, unit_name, price_list_id) do update set price = excluded.price`,
          [crypto.randomUUID(), id, p.unit_name, p.price_list_id, p.price],
        );
      } else {
        await t.query(`delete from item_prices where item_id = $1 and unit_name = $2 and price_list_id = $3`, [id, p.unit_name, p.price_list_id]);
      }
    }
  }
  return t.one(`select * from ${table} where id = $1`, [id]);
}

async function handleMaster(t: Db, ctx: Ctx, op: Extract<Op, { type: 'master.upsert' }>): Promise<OpResult> {
  const table = MASTER_TABLE[op.entity];
  const existing = await t.one(`select * from ${table} where id = $1 for update`, [op.id]);
  need(ctx.user, MASTER_PERM[op.entity][existing ? 1 : 0]);
  if (existing && op.base_version !== existing.version) {
    // تعديل على نسخة قديمة: لا نكتب فوق تعديل جهاز آخر بصمت
    const label = ENTITY_LABEL[op.entity];
    const conflictId = await createConflict(t, ctx, {
      kind: 'edit_conflict',
      entity: op.entity,
      entity_id: op.id,
      message: `${label} «${existing.name ?? existing.code}» عُدّل من جهاز آخر قبل وصول تعديلك`,
      server_data: existing,
      client_data: op.data,
    });
    return { op_id: '', status: 'conflict', message: `تعارض: ${label} عُدّل من جهاز آخر. يحتاج مراجعة`, result: { conflict_id: conflictId } };
  }
  const row = await writeMaster(t, ctx, op.entity, op.id, op.data, existing);
  return { op_id: '', status: 'accepted', result: { id: op.id, version: row.version } };
}

// ---------------- المستندات ----------------

function docPerm(docType: string, action: 'create' | 'post' | 'cancel' | 'edit') {
  const info = DOC_TYPES[docType as keyof typeof DOC_TYPES];
  if (!info) throw new AppError('نوع مستند غير معروف');
  if (docType === 'quotation') return action === 'cancel' ? 'sales.cancel' : 'sales.quotation';
  if (docType === 'profit_distribution') return action === 'post' ? 'partners.distribute' : action === 'cancel' ? 'partners.distribute' : 'partners.create';
  if (info.module === 'accounts') return action === 'create' || action === 'edit' ? 'accounts.journal' : action === 'post' ? 'accounts.post' : 'accounts.cancel';
  if (action === 'edit' && (info.module === 'sales' || info.module === 'purchases')) return `${info.module}.edit`;
  if (action === 'edit') return `${info.module}.create`;
  return `${info.module}.${action}`;
}

/** محاولة الترحيل داخل savepoint: إذا احتاج المستند مراجعة نتراجع عن آثار الترحيل فقط ونحتفظ بالمستند */
async function tryPost(t: Db, ctx: Ctx, docId: string, override = false): Promise<OpResult> {
  await t.exec('SAVEPOINT post_doc');
  try {
    const doc = await postDocument(t, ctx, docId, { override });
    await t.exec('RELEASE SAVEPOINT post_doc');
    return { op_id: '', status: 'accepted', result: { id: docId, number: doc.number, status: 'posted', version: doc.version } };
  } catch (e) {
    await t.exec('ROLLBACK TO SAVEPOINT post_doc');
    if (!(e instanceof ReviewError)) throw e;
    await t.query(`update documents set status = 'pending_review', review_reason = $2 where id = $1`, [docId, e.message]);
    const doc = await t.one(`select * from documents where id = $1`, [docId]);
    const conflictId = await createConflict(t, ctx, {
      kind: e.kind,
      entity: 'document',
      entity_id: docId,
      message: `${DOC_TYPES[doc.doc_type as keyof typeof DOC_TYPES].label} ${doc.number}: ${e.message}`,
      server_data: e.details,
    });
    return {
      op_id: '',
      status: 'conflict',
      message: `${e.message}. حُفظ المستند ${doc.number} بحالة «يحتاج مراجعة» ولم يُرحّل`,
      result: { id: docId, number: doc.number, status: 'pending_review', conflict_id: conflictId, version: doc.version },
    };
  }
}

async function handleDocSave(t: Db, ctx: Ctx, op: Extract<Op, { type: 'doc.save' }>): Promise<OpResult> {
  const existing = await t.one(`select * from documents where id = $1 for update`, [op.doc.id]);
  if (existing) {
    if (existing.doc_type !== op.doc.doc_type) throw new AppError('لا يمكن تغيير نوع المستند');
    if (existing.status === 'posted' || existing.status === 'cancelled') {
      throw new AppError(`المستند ${existing.number} ${existing.status === 'posted' ? 'مُرحّل' : 'ملغي'} ولا يمكن تعديله؛ استخدم الإلغاء أو مستندًا عكسيًا`, 'state');
    }
    need(ctx.user, docPerm(op.doc.doc_type, 'edit'));
    if (op.base_version !== existing.version) {
      const conflictId = await createConflict(t, ctx, {
        kind: 'edit_conflict',
        entity: 'document',
        entity_id: existing.id,
        message: `المستند ${existing.number} عُدّل من جهاز آخر قبل وصول تعديلك`,
        server_data: existing,
        client_data: op.doc,
      });
      return { op_id: '', status: 'conflict', message: 'تعارض: المسودة عُدّلت من جهاز آخر', result: { conflict_id: conflictId } };
    }
  } else {
    need(ctx.user, docPerm(op.doc.doc_type, 'create'));
  }
  if (op.action === 'post') need(ctx.user, docPerm(op.doc.doc_type, 'post'));
  const saved = await saveDocument(t, ctx, op.doc, existing);
  if (op.action === 'post') return tryPost(t, ctx, saved.id);
  return { op_id: '', status: 'accepted', result: { id: saved.id, number: saved.number, status: 'draft', version: saved.version } };
}

async function handleDocPost(t: Db, ctx: Ctx, op: Extract<Op, { type: 'doc.post' }>): Promise<OpResult> {
  const doc = await t.one(`select * from documents where id = $1 for update`, [op.id]);
  if (!doc) throw new AppError('المستند غير موجود', 'not_found');
  need(ctx.user, docPerm(doc.doc_type, 'post'));
  if (op.base_version !== null && op.base_version !== doc.version) throw new AppError('المستند تغير منذ آخر مزامنة؛ راجعه ثم رحّله', 'state');
  return tryPost(t, ctx, op.id);
}

async function handleDocCancel(t: Db, ctx: Ctx, op: Extract<Op, { type: 'doc.cancel' }>): Promise<OpResult> {
  const doc = await t.one(`select doc_type from documents where id = $1`, [op.id]);
  if (!doc) throw new AppError('المستند غير موجود', 'not_found');
  need(ctx.user, docPerm(doc.doc_type, 'cancel'));
  const r = await cancelDocument(t, ctx, op.id, op.reason);
  // أي تعارض مفتوح على المستند يُغلق
  await t.query(
    `update sync_conflicts set status = 'resolved', resolution = 'discard', resolved_by = $2, resolved_at = now() where entity = 'document' and entity_id = $1 and status = 'open'`,
    [op.id, ctx.user.id],
  );
  return { op_id: '', status: 'accepted', result: { id: op.id, status: r.status } };
}

async function handleResolve(t: Db, ctx: Ctx, op: Extract<Op, { type: 'conflict.resolve' }>): Promise<OpResult> {
  need(ctx.user, 'conflicts.resolve');
  const c = await t.one(`select * from sync_conflicts where id = $1 for update`, [op.id]);
  if (!c) throw new AppError('التعارض غير موجود', 'not_found');
  if (c.status !== 'open') throw new AppError('تم حل هذا التعارض من قبل', 'state');
  let result: OpResult = { op_id: '', status: 'accepted' };

  if (c.kind === 'edit_conflict' && c.entity !== 'document') {
    if (op.resolution === 'apply_client') {
      const entity = c.entity as MasterEntity;
      const existing = await t.one(`select * from ${MASTER_TABLE[entity]} where id = $1 for update`, [c.entity_id]);
      need(ctx.user, MASTER_PERM[entity][1]);
      await writeMaster(t, ctx, entity, c.entity_id, c.client_data, existing);
    } else if (op.resolution !== 'keep_server') throw new AppError('اختيار غير مناسب لهذا التعارض');
  } else if (c.kind === 'edit_conflict' && c.entity === 'document') {
    if (op.resolution === 'apply_client') {
      const existing = await t.one(`select * from documents where id = $1 for update`, [c.entity_id]);
      if (existing.status !== 'draft' && existing.status !== 'pending_review') throw new AppError('المستند لم يعد مسودة', 'state');
            need(ctx.user, docPerm(existing.doc_type, 'edit'));
      await saveDocument(t, ctx, c.client_data, existing);
    } else if (op.resolution !== 'keep_server') throw new AppError('اختيار غير مناسب لهذا التعارض');
  } else if (c.kind === 'stock_shortage' || c.kind === 'credit_limit') {
    const doc = await t.one(`select * from documents where id = $1`, [c.entity_id]);
    if (op.resolution === 'post_anyway') {
      need(ctx.user, docPerm(doc.doc_type, 'post'));
      if (doc.status !== 'pending_review' && doc.status !== 'draft') throw new AppError('المستند لم يعد بانتظار المراجعة', 'state');
      const doc2 = await postDocument(t, ctx, doc.id, { override: true });
      result = { op_id: '', status: 'accepted', result: { id: doc.id, number: doc2.number, status: 'posted' } };
    } else if (op.resolution === 'discard') {
      need(ctx.user, docPerm(doc.doc_type, 'cancel'));
      await cancelDocument(t, ctx, doc.id, `رفض بعد مراجعة تعارض: ${op.note ?? c.message}`);
    } else if (op.resolution !== 'keep_server') throw new AppError('اختيار غير مناسب لهذا التعارض');
    // keep_server = إبقاء المستند مسودة للتعديل لاحقًا
    if (op.resolution === 'keep_server') await t.query(`update documents set status = 'draft' where id = $1 and status = 'pending_review'`, [doc.id]);
  }
  await t.query(
    `update sync_conflicts set status = 'resolved', resolution = $2, resolution_note = $3, resolved_by = $4, resolved_at = now() where id = $1`,
    [op.id, op.resolution, op.note ?? null, ctx.user.id],
  );
  // أي تعارضات أخرى مفتوحة على نفس الكيان تُغلق إذا انتهت حالة المستند
  return result;
}

function entityOf(op: Op): [string | null, string | null] {
  switch (op.type) {
    case 'master.upsert':
      return [op.entity, op.id];
    case 'doc.save':
      return ['document', op.doc.id];
    case 'doc.post':
    case 'doc.cancel':
      return ['document', op.id];
    case 'conflict.resolve':
      return ['conflict', op.id];
    case 'doc.close':
      return ['document', op.id];
    case 'year.close':
      return ['document', op.id];
    case 'delivery.record':
      return ['document', op.document_id];
    case 'doc.meta':
      return ['document', op.id];
    case 'instrument.settle':
      return ['instrument', op.id];
    case 'shift.open':
    case 'shift.close':
      return ['shift', op.id];
  }
}

// ---------------- إغلاق متابعة فاتورة آجلة ----------------
async function handleDocClose(t: Db, ctx: Ctx, op: Extract<Op, { type: 'doc.close' }>): Promise<OpResult> {
  const doc = await t.one(`select * from documents where id = $1 for update`, [op.id]);
  if (!doc) throw new AppError('المستند غير موجود', 'not_found');
  if (doc.doc_type !== 'sale_invoice' && doc.doc_type !== 'purchase_invoice') throw new AppError('الإغلاق للفواتير الآجلة فقط');
  need(ctx.user, doc.doc_type === 'sale_invoice' ? 'sales.close_credit' : 'purchases.close_credit');
  await t.query(`update documents set closed = $2 where id = $1`, [op.id, op.closed]);
  return { op_id: '', status: 'accepted', result: { id: op.id, closed: op.closed } };
}

// ---------------- إقفال السنة المالية ----------------
async function handleYearClose(t: Db, ctx: Ctx, op: Extract<Op, { type: 'year.close' }>): Promise<OpResult> {
  need(ctx.user, 'period.lock');
  const last = await t.one(`select max(date) as d from documents where doc_type = 'year_closing' and status = 'posted'`);
  if (last?.d && op.date <= last.d) throw new AppError(`يوجد إقفال سابق بتاريخ ${last.d}؛ اختر تاريخًا بعده`, 'state');
  const locked = (await t.one(`select value from settings where key = 'locked_until'`))?.value;
  if (locked && op.date <= locked) throw new AppError(`الفترة حتى ${locked} مقفلة بالفعل`, 'state');
  const pending = await t.one(`select count(*)::int as n from documents where status in ('draft','pending_review') and date <= $1 and doc_type <> 'quotation'`, [op.date]);
  if (pending?.n) throw new AppError(`يوجد ${pending.n} مستند غير مرحّل (مسودة أو مراجعة) بتاريخ قبل الإقفال؛ رحّلها أو ألغها أولًا`, 'state');
  const doc = await createAndPost(t, ctx, { id: op.id, doc_type: 'year_closing', date: op.date, notes: `إقفال الفترة حتى ${op.date}` } as any);
  await t.query(`insert into settings (key, value) values ('locked_until', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(op.date)]);
  return { op_id: '', status: 'accepted', result: { id: doc.id, number: doc.number, net: doc.data?.net_result ?? 0 } };
}

// ---------------- التسليم المؤجل ----------------
async function handleDelivery(t: Db, ctx: Ctx, op: Extract<Op, { type: 'delivery.record' }>): Promise<OpResult> {
  need(ctx.user, 'sales.deliver');
  const doc = await t.one(`select * from documents where id = $1 for update`, [op.document_id]);
  if (!doc) throw new AppError('الفاتورة غير موجودة', 'not_found');
  if (doc.doc_type !== 'sale_invoice' || !doc.deliver_later) throw new AppError('هذه الفاتورة ليست تسليمًا مؤجلًا');
  if (doc.status !== 'posted') throw new AppError('الفاتورة غير مرحّلة', 'state');
  if (ctx.user.warehouse_ids && !ctx.user.warehouse_ids.includes(doc.warehouse_id)) throw new AppError('غير مسموح لك بالعمل على هذا المخزن', 'forbidden');
  if (await t.one(`select 1 from deliveries where id = $1`, [op.id])) throw new AppError('عملية التسليم مسجلة بالفعل', 'state');
  await t.query(`insert into deliveries (id, document_id, date, notes, created_by, device_id) values ($1,$2,$3,$4,$5,$6)`, [
    op.id, doc.id, op.date, op.notes ?? null, ctx.user.id, ctx.deviceId,
  ]);
  for (const dl of op.lines) {
    const line = await t.one(`select * from document_lines where id = $1 and document_id = $2 for update`, [dl.line_id, doc.id]);
    if (!line) throw new AppError('سطر غير موجود في الفاتورة');
    const item = await t.one(`select * from items where id = $1`, [line.item_id]);
    const remaining = line.base_qty - line.delivered_qty;
    if (dl.qty > remaining) throw new AppError(`الكمية المسلّمة من «${item.name}» أكبر من المتبقي (${remaining / 1000})`);
    if (item.track_serial && !item.is_service) {
      await trackOut(t, { date: op.date, doc, line, item, warehouse_id: doc.warehouse_id, qty: dl.qty }, 'sell', { skipLots: true, serials: dl.serials });
    }
    await t.query(`update document_lines set delivered_qty = delivered_qty + $2 where id = $1`, [line.id, dl.qty]);
    await t.query(`insert into delivery_lines (delivery_id, line_id, qty, serials) values ($1,$2,$3,$4)`, [op.id, line.id, dl.qty, JSON.stringify(dl.serials ?? [])]);
  }
  const left = await t.one(`select coalesce(sum(base_qty - delivered_qty), 0)::bigint as q from document_lines where document_id = $1`, [doc.id]);
  if (left?.q === 0) await t.query(`update documents set order_status = coalesce(nullif(order_status, ''), 'تم التسليم') where id = $1`, [doc.id]);
  // تحديث row_version للفاتورة حتى تسحب الأجهزة الكميات المسلّمة
  await t.query(`update documents set version = version where id = $1`, [doc.id]);
  return { op_id: '', status: 'accepted', result: { id: op.id, remaining: left?.q ?? 0 } };
}

async function handleDocMeta(t: Db, ctx: Ctx, op: Extract<Op, { type: 'doc.meta' }>): Promise<OpResult> {
  if (!hasPermission(ctx.user.permissions, 'sales.deliver') && !hasPermission(ctx.user.permissions, 'sales.edit')) throw new AppError('ليس لديك صلاحية', 'forbidden');
  const doc = await t.one(`select doc_type from documents where id = $1`, [op.id]);
  if (!doc || doc.doc_type !== 'sale_invoice') throw new AppError('الفاتورة غير موجودة', 'not_found');
  await t.query(`update documents set order_status = $2, shipping_company = $3 where id = $1`, [op.id, op.order_status ?? null, op.shipping_company ?? null]);
  return { op_id: '', status: 'accepted', result: { id: op.id } };
}

// ---------------- الشيكات والأقساط ----------------
async function handleInstrument(t: Db, ctx: Ctx, op: Extract<Op, { type: 'instrument.settle' }>): Promise<OpResult> {
  need(ctx.user, 'treasury.instruments');
  const x = await t.one(`select * from instruments where id = $1 for update`, [op.id]);
  if (!x) throw new AppError('الشيك/القسط غير موجود', 'not_found');
  if (x.status !== 'open') throw new AppError('هذا الشيك/القسط ليس مفتوحًا', 'state');
  const party = await t.one(`select * from parties where id = $1`, [x.party_id]);
  const label = x.kind === 'cheque' ? `شيك ${x.cheque_no ?? ''}`.trim() : 'قسط';
  let settled: any = null;
  let status = 'collected';
  if (op.action === 'collect') {
    if (!op.cashbox_id) throw new AppError('اختر الخزينة');
    if (x.kind === 'cheque') {
      // الشيك خُصم من حساب الطرف عند استلامه؛ التحصيل ينقله من أوراق القبض/الدفع للخزينة
      const accKey = x.direction === 'in' ? 'notes_receivable' : 'notes_payable';
      const accId = (await t.one(`select id from accounts where system_key = $1`, [accKey])).id;
      settled = await createAndPost(t, ctx, {
        doc_type: x.direction === 'in' ? 'receipt' : 'payment',
        date: op.date,
        cashbox_id: op.cashbox_id,
        account_id: accId,
        amount: x.amount,
        notes: `تحصيل ${label} — ${party.name}${op.note ? ' — ' + op.note : ''}`,
      });
    } else {
      settled = await createAndPost(t, ctx, {
        doc_type: x.direction === 'in' ? 'receipt' : 'payment',
        date: op.date,
        cashbox_id: op.cashbox_id,
        party_id: x.party_id,
        amount: x.amount,
        ref_doc_id: x.document_id,
        notes: `سداد ${label} مستحق ${x.due_date} — ${party.name}${op.note ? ' — ' + op.note : ''}`,
      });
    }
  } else if (op.action === 'bounce') {
    if (x.kind !== 'cheque') throw new AppError('الارتداد للشيكات فقط');
    const ar = (await t.one(`select id from accounts where system_key = $1`, [x.direction === 'in' ? 'ar' : 'ap'])).id;
    const notes = (await t.one(`select id from accounts where system_key = $1`, [x.direction === 'in' ? 'notes_receivable' : 'notes_payable'])).id;
    settled = await createAndPost(t, ctx, {
      doc_type: 'journal_voucher',
      date: op.date,
      notes: `ارتداد ${label} — ${party.name}${op.note ? ' — ' + op.note : ''}`,
      journal_lines:
        x.direction === 'in'
          ? [{ account_id: ar, party_id: x.party_id, debit: x.amount, credit: 0 }, { account_id: notes, debit: 0, credit: x.amount }]
          : [{ account_id: notes, debit: x.amount, credit: 0 }, { account_id: ar, party_id: x.party_id, debit: 0, credit: x.amount }],
    } as any);
    if (x.document_id) await t.query(`update documents set paid = paid - $2 where id = $1`, [x.document_id, x.amount]);
    status = 'bounced';
  } else {
    status = 'closed';
  }
  await t.query(`update instruments set status = $2, settled_doc_id = $3, settled_at = now(), settled_by = $4, notes = coalesce($5, notes) where id = $1`, [
    op.id, status, settled?.id ?? null, ctx.user.id, op.note ?? null,
  ]);
  return { op_id: '', status: 'accepted', result: { id: op.id, status, document_id: settled?.id ?? null, number: settled?.number ?? null } };
}

// ---------------- ورديات الكاشير ----------------
async function handleShiftOpen(t: Db, ctx: Ctx, op: Extract<Op, { type: 'shift.open' }>): Promise<OpResult> {
  need(ctx.user, 'treasury.shift');
  const open = await t.one(`select id from cashier_shifts where user_id = $1 and status = 'open'`, [ctx.user.id]);
  if (open) throw new AppError('لديك وردية مفتوحة بالفعل؛ أقفلها أولًا', 'state');
  const cb = await t.one(`select * from cashboxes where id = $1`, [op.cashbox_id]);
  if (!cb || !cb.active) throw new AppError('الخزينة غير موجودة');
  if (ctx.user.cashbox_ids && !ctx.user.cashbox_ids.includes(op.cashbox_id)) throw new AppError('غير مسموح لك بهذه الخزينة', 'forbidden');
  await t.query(`insert into cashier_shifts (id, user_id, cashbox_id, device_id, opening_float) values ($1,$2,$3,$4,$5)`, [
    op.id, ctx.user.id, op.cashbox_id, ctx.deviceId, op.opening_float,
  ]);
  return { op_id: '', status: 'accepted', result: { id: op.id } };
}

/** المتوقع في الدرج = عهدة البداية + صافي حركة الخزينة من مستندات الوردية */
export async function shiftExpected(t: Db, shiftId: string) {
  const sh = await t.one(`select s.*, c.account_id from cashier_shifts s join cashboxes c on c.id = s.cashbox_id where s.id = $1`, [shiftId]);
  if (!sh) throw new AppError('الوردية غير موجودة', 'not_found');
  const mv = await t.one(
    `select coalesce(sum(l.debit - l.credit), 0)::bigint as v from journal_lines l join journal_entries e on e.id = l.entry_id
       join documents d on d.id = e.document_id where d.shift_id = $1 and l.account_id = $2`,
    [shiftId, sh.account_id],
  );
  return { shift: sh, movement: mv?.v ?? 0, expected: sh.opening_float + (mv?.v ?? 0) };
}

async function handleShiftClose(t: Db, ctx: Ctx, op: Extract<Op, { type: 'shift.close' }>): Promise<OpResult> {
  need(ctx.user, 'treasury.shift');
  const { shift, expected } = await shiftExpected(t, op.id);
  if (shift.status !== 'open') throw new AppError('الوردية مقفلة بالفعل', 'state');
  if (shift.user_id !== ctx.user.id && !ctx.user.permissions.includes('*')) throw new AppError('لا يمكنك إقفال وردية مستخدم آخر', 'forbidden');
  const diff = op.counted_cash - expected;
  let closeDoc: any = null;
  if (diff !== 0) {
    const overShort = (await t.one(`select id from accounts where system_key = 'cash_over_short'`)).id;
    closeDoc = await createAndPost(t, ctx, {
      doc_type: 'journal_voucher',
      date: op.date,
      notes: `${diff < 0 ? 'عجز' : 'زيادة'} وردية ${shift.id.slice(0, 8)}${op.notes ? ' — ' + op.notes : ''}`,
      journal_lines:
        diff < 0
          ? [{ account_id: overShort, debit: -diff, credit: 0 }, { account_id: shift.account_id, debit: 0, credit: -diff }]
          : [{ account_id: shift.account_id, debit: diff, credit: 0 }, { account_id: overShort, debit: 0, credit: diff }],
    } as any);
  }
  await t.query(
    `update cashier_shifts set status = 'closed', closed_at = now(), expected_cash = $2, counted_cash = $3, difference = $4, close_doc_id = $5, notes = $6 where id = $1`,
    [op.id, expected, op.counted_cash, diff, closeDoc?.id ?? null, op.notes ?? null],
  );
  return { op_id: '', status: 'accepted', result: { id: op.id, expected, counted: op.counted_cash, difference: diff } };
}

/**
 * تنفيذ عملية واحدة بشكل idempotent:
 * - إذا وصلت نفس العملية (نفس op_id) مرة أخرى بعد انقطاع الاتصال تُعاد النتيجة المحفوظة دون تنفيذ جديد
 * - كل العملية داخل معاملة واحدة مع قفل كتابة عام يضمن ترتيب row_version للمزامنة
 */
export async function applyOp(db: Db, user: AuthUser, deviceId: string, rawEnv: unknown): Promise<OpResult> {
  const parsedEnv = opEnvelopeSchema.safeParse(rawEnv);
  const opId = (rawEnv as any)?.op_id ?? 'unknown';
  if (!parsedEnv.success) {
    return { op_id: opId, status: 'rejected', message: 'بيانات العملية غير صالحة: ' + parsedEnv.error.issues.map((i) => i.message).join('، ') };
  }
  const env = parsedEnv.data;
  const ctx: Ctx = { user, deviceId, opId: env.op_id };

  const prior = await db.one(`select * from processed_ops where op_id = $1`, [env.op_id]);
  if (prior) return { op_id: env.op_id, status: prior.status, message: prior.message ?? undefined, result: prior.result ?? undefined };

  const [entity, entityId] = entityOf(env.op);
  try {
    return await db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(${WRITE_LOCK})`);
      const again = await t.one(`select * from processed_ops where op_id = $1`, [env.op_id]);
      if (again) return { op_id: env.op_id, status: again.status, message: again.message ?? undefined, result: again.result ?? undefined };
      let r: OpResult;
      switch (env.op.type) {
        case 'master.upsert':
          r = await handleMaster(t, ctx, env.op);
          break;
        case 'doc.save':
          r = await handleDocSave(t, ctx, env.op);
          break;
        case 'doc.post':
          r = await handleDocPost(t, ctx, env.op);
          break;
        case 'doc.cancel':
          r = await handleDocCancel(t, ctx, env.op);
          break;
        case 'conflict.resolve':
          r = await handleResolve(t, ctx, env.op);
          break;
        case 'doc.close':
          r = await handleDocClose(t, ctx, env.op);
          break;
        case 'delivery.record':
          r = await handleDelivery(t, ctx, env.op);
          break;
        case 'year.close':
          r = await handleYearClose(t, ctx, env.op);
          break;
        case 'doc.meta':
          r = await handleDocMeta(t, ctx, env.op);
          break;
        case 'instrument.settle':
          r = await handleInstrument(t, ctx, env.op);
          break;
        case 'shift.open':
          r = await handleShiftOpen(t, ctx, env.op);
          break;
        case 'shift.close':
          r = await handleShiftClose(t, ctx, env.op);
          break;
      }
      r.op_id = env.op_id;
      await t.query(
        `insert into processed_ops (op_id, device_id, user_id, op_type, seq, status, message, result, client_created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [env.op_id, deviceId, user.id, env.op.type, env.seq, r.status, r.message ?? null, JSON.stringify(r.result ?? null), env.created_at],
      );
      await audit(t, ctx, env, env.op.type, entity, entityId, r.status, { result: r.result, message: r.message, action: (env.op as any).action });
      return r;
    });
  } catch (e: any) {
    const appErr = e instanceof AppError ? e : e?.name === 'ZodError' ? new AppError(e.issues.map((i: any) => i.message).join('، ')) : pgErrorToApp(e);
    if (!appErr) {
      console.error('op failed', env.op_id, e);
      return { op_id: env.op_id, status: 'rejected', retry: true, message: 'خطأ مؤقت في الخادم، ستُعاد المحاولة' };
    }
    // الرفض نهائي ويُسجّل حتى لا تُنفذ نفس العملية لاحقًا بشكل مختلف
    await db.tx(async (t) => {
      await t.query(
        `insert into processed_ops (op_id, device_id, user_id, op_type, seq, status, message, client_created_at) values ($1,$2,$3,$4,$5,'rejected',$6,$7) on conflict do nothing`,
        [env.op_id, deviceId, user.id, env.op.type, env.seq, appErr.message, env.created_at],
      );
      await audit(t, ctx, env, env.op.type, entity, entityId, 'rejected', { message: appErr.message });
    });
    return { op_id: env.op_id, status: 'rejected', message: appErr.message };
  }
}
