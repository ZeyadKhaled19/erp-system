import { DOC_TYPES, hasPermission, MASTER_SCHEMAS, opEnvelopeSchema, type MasterEntity, type Op, type OpEnvelope, type OpResult } from '@erp/shared';
import type { AuthUser } from './auth';
import type { Db } from './db';
import { AppError, pgErrorToApp, ReviewError } from './errors';
import { cancelDocument, postDocument, saveDocument, type Ctx } from './posting/documents';

const WRITE_LOCK = 7331;

const MASTER_TABLE: Record<MasterEntity, string> = {
  item: 'items',
  party: 'parties',
  warehouse: 'warehouses',
  category: 'categories',
  cashbox: 'cashboxes',
  account: 'accounts',
};

const MASTER_PERM: Record<MasterEntity, [create: string, edit: string]> = {
  item: ['items.create', 'items.edit'],
  party: ['parties.create', 'parties.edit'],
  warehouse: ['items.create', 'items.edit'],
  category: ['items.create', 'items.edit'],
  cashbox: ['treasury.manage', 'treasury.manage'],
  account: ['accounts.manage', 'accounts.manage'],
};

const ENTITY_LABEL: Record<MasterEntity, string> = {
  item: 'الصنف',
  party: 'الطرف',
  warehouse: 'المخزن',
  category: 'التصنيف',
  cashbox: 'الخزينة',
  account: 'الحساب',
};

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
  }
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
