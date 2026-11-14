import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { ALL_PERMISSIONS, DOC_TYPES, hasPermission, todayISO, WORKSPACE_IDS } from '@erp/shared';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashPassword, loadAuthUser, makeTokens, verifyPassword, type AuthUser } from './auth';
import { backupToFile, exportData, listBackups, restoreFromFile } from './backup';
import type { Db } from './db';
import { AppError } from './errors';
import { integrityCheck } from './integrity';
import { applyOp, shiftExpected } from './ops';
import * as R from './reports';
import { pull } from './sync';

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  backupDir: string;
  webDist?: string;
  logger?: boolean;
  /** خادم بلا قرص دائم (Vercel): لا تُحفظ نسخ على الخادم، والنسخة تُنزَّل مباشرة على جهاز المستخدم */
  ephemeralBackups?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    deviceId?: string;
  }
}

export async function buildApp(opts: AppOptions) {
  const { db } = opts;
  const tokens = makeTokens(opts.jwtSecret);
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  await app.register(cors, { origin: true });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof AppError) {
      const status = { validation: 400, forbidden: 403, not_found: 404, state: 409, auth: 401 }[err.code];
      return reply.status(status).send({ error: err.message, code: err.code });
    }
    if (err?.name === 'ZodError') return reply.status(400).send({ error: err.issues.map((i: any) => i.message).join('، ') });
    if (err?.validation) return reply.status(400).send({ error: 'طلب غير صالح' });
    app.log.error(err);
    return reply.status(500).send({ error: 'خطأ في الخادم' });
  });

  const auth = async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new AppError('سجّل الدخول أولًا', 'auth');
    let payload;
    try {
      payload = await tokens.verify(h.slice(7));
    } catch {
      throw new AppError('انتهت الجلسة؛ سجّل الدخول مرة أخرى', 'auth');
    }
    const user = await loadAuthUser(db, payload.userId);
    if (!user) throw new AppError('المستخدم موقوف أو غير موجود', 'auth');
    req.user = user;
    req.deviceId = String(req.headers['x-device-id'] ?? payload.deviceId ?? '');
  };
  const perm = (key: string) => async (req: FastifyRequest) => {
    await auth(req);
    if (!hasPermission(req.user!.permissions, key)) throw new AppError('ليس لديك صلاحية', 'forbidden');
  };
  const q = (req: FastifyRequest) => req.query as Record<string, string | undefined>;
  const range = (req: FastifyRequest) => ({ from: q(req).from || undefined, to: q(req).to || undefined });
  const assertWarehouseScope = (req: FastifyRequest, id: string | null | undefined) => {
    if (id && req.user!.warehouse_ids && !req.user!.warehouse_ids.includes(id)) throw new AppError('غير مسموح لك بالعمل على هذا المخزن', 'forbidden');
  };
  const assertCashboxScope = (req: FastifyRequest, id: string | null | undefined) => {
    if (id && req.user!.cashbox_ids && !req.user!.cashbox_ids.includes(id)) throw new AppError('غير مسموح لك بالعمل على هذه الخزينة', 'forbidden');
  };

  // ---------------- عام ----------------
  app.get('/api/health', async () => {
    await db.one('select 1');
    return { ok: true, time: new Date().toISOString(), db: db.kind };
  });

  // ---------------- الدخول ----------------
  // حماية من تخمين كلمات المرور (مهم عند فتح النظام على الإنترنت): 10 محاولات خاطئة لنفس الاسم = إيقاف 15 دقيقة
  const LOGIN_MAX = 10;
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const failures = new Map<string, { n: number; first: number }>();
  const lockedFor = (key: string) => {
    const f = failures.get(key);
    if (!f) return 0;
    const left = f.first + LOGIN_WINDOW_MS - Date.now();
    if (left <= 0) {
      failures.delete(key);
      return 0;
    }
    return f.n >= LOGIN_MAX ? left : 0;
  };
  // هوية الشركة لصفحة الدخول (قبل تسجيل الدخول): الاسم واسم النظام واللوجو بس
  app.get('/api/brand', async () => {
    const rows = await db.query<{ key: string; value: any }>(`select key, value from settings where key in ('company_name', 'system_name', 'print_logo')`);
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { company_name: typeof v.company_name === 'string' ? v.company_name : '', system_name: typeof v.system_name === 'string' ? v.system_name : '', logo: typeof v.print_logo === 'string' ? v.print_logo : null };
  });

  app.post('/api/auth/login', async (req) => {
    const body = z
      .object({ username: z.string().min(1), password: z.string().min(1), device_id: z.string().min(8).max(64), device_name: z.string().max(100).optional() })
      .parse(req.body);
    const key = body.username.trim().toLowerCase();
    const wait = lockedFor(key);
    if (wait > 0) throw new AppError(`محاولات دخول خاطئة كثيرة لهذا المستخدم. حاول بعد ${Math.ceil(wait / 60000)} دقيقة`, 'auth');
    const u = await db.one(`select * from users where lower(username) = lower($1)`, [body.username.trim()]);
    if (!u || !u.active || !(await verifyPassword(body.password, u.password_hash))) {
      const f = failures.get(key);
      if (f && Date.now() - f.first < LOGIN_WINDOW_MS) f.n++;
      else failures.set(key, { n: 1, first: Date.now() });
      await db.query(`insert into audit_log (action, entity, details, device_id) values ('login_failed', 'user', $1, $2)`, [
        JSON.stringify({ username: body.username }),
        body.device_id,
      ]);
      throw new AppError('اسم المستخدم أو كلمة المرور غير صحيحة', 'auth');
    }
    await db.query(
      `insert into devices (id, name, user_id) values ($1, $2, $3) on conflict (id) do update set name = coalesce(excluded.name, devices.name), user_id = excluded.user_id, last_seen = now()`,
      [body.device_id, body.device_name ?? null, u.id],
    );
    failures.delete(key);
    await db.query(`insert into audit_log (user_id, device_id, action, entity, entity_id) values ($1, $2, 'login', 'user', $1)`, [u.id, body.device_id]);
    const user = (await loadAuthUser(db, u.id))!;
    return { token: await tokens.sign(u.id, body.device_id), user };
  });

  app.get('/api/auth/me', { preHandler: auth }, async (req) => ({ user: req.user }));

  app.post('/api/auth/change-password', { preHandler: auth }, async (req) => {
    const b = z.object({ current: z.string(), next: z.string().min(6, 'كلمة المرور الجديدة 6 أحرف على الأقل') }).parse(req.body);
    const u = await db.one(`select password_hash from users where id = $1`, [req.user!.id]);
    if (!(await verifyPassword(b.current, u.password_hash))) throw new AppError('كلمة المرور الحالية غير صحيحة');
    await db.query(`update users set password_hash = $2 where id = $1`, [req.user!.id, await hashPassword(b.next)]);
    await db.query(`insert into audit_log (user_id, device_id, action, entity, entity_id) values ($1, $2, 'change_password', 'user', $1)`, [req.user!.id, req.deviceId]);
    return { ok: true };
  });

  // ---------------- المزامنة ----------------
  app.post('/api/sync/push', { preHandler: auth }, async (req) => {
    const b = z.object({ ops: z.array(z.any()).max(500) }).parse(req.body);
    await db.query(`update devices set last_seen = now() where id = $1`, [req.deviceId]);
    const results = [];
    // التنفيذ بالترتيب: عميل/صنف أُنشئ دون اتصال يُرفع قبل الفاتورة التي تستخدمه
    for (const env of b.ops) results.push(await applyOp(db, req.user!, req.deviceId!, env));
    return { results };
  });

  app.get('/api/sync/pull', { preHandler: auth }, async (req) => {
    const cursor = Number(q(req).cursor ?? 0) || 0;
    return pull(db, cursor, req.user!);
  });

  // ---------------- التقارير ----------------
  app.get('/api/reports/dashboard', { preHandler: auth }, async (req) => {
    const d = await R.dashboard(db, q(req).today || todayISO());
    // لا تُعرض أرقام لا يملك المستخدم صلاحية رؤيتها (الشكل نفسه، والقيمة null)
    const can = (k: string) => hasPermission(req.user!.permissions, k);
    if (!can('reports.profit')) d.month_gross_profit = null as any;
    if (!can('sales.view')) Object.assign(d, { today_sales: null, today_count: null, month_net_sales: null });
    if (!can('treasury.view')) d.cashboxes = [] as any;
    if (!can('parties.view')) Object.assign(d, { receivables: null, payables: null });
    if (!can('costs.view')) d.stock_value = null as any;
    if (!can('inventory.view')) d.reorder_count = null as any;
    return d;
  });
  app.get('/api/reports/trial-balance', { preHandler: perm('reports.financial') }, async (req) => R.trialBalance(db, range(req)));
  app.get('/api/reports/ledger/:id', { preHandler: perm('reports.financial') }, async (req) =>
    R.ledger(db, (req.params as any).id, { ...range(req), party_id: q(req).party_id }),
  );
  app.get('/api/reports/income-statement', { preHandler: perm('reports.profit') }, async (req) => R.incomeStatement(db, range(req)));
  app.get('/api/reports/cash-result', { preHandler: perm('reports.profit') }, async (req) => R.cashResult(db, range(req)));
  app.get('/api/reports/balance-sheet', { preHandler: perm('reports.financial') }, async (req) => R.balanceSheet(db, q(req).to || todayISO()));
  app.get('/api/reports/party/:id', { preHandler: perm('parties.view') }, async (req) => R.partyStatement(db, (req.params as any).id, { ...range(req), items: q(req).items === '1' }));
  app.get('/api/reports/cashbox/:id', { preHandler: perm('treasury.view') }, async (req) => {
    const id = (req.params as any).id;
    assertCashboxScope(req, id);
    return R.cashboxMovement(db, id, range(req));
  });
  app.get('/api/reports/item/:id', { preHandler: perm('inventory.view') }, async (req) => {
    assertWarehouseScope(req, q(req).warehouse_id);
    if (!q(req).warehouse_id && req.user!.warehouse_ids !== null) throw new AppError('حدد مخزنًا من المخازن المسموح بها', 'forbidden');
    const r = await R.itemMovement(db, (req.params as any).id, { ...range(req), warehouse_id: q(req).warehouse_id, doc_type: q(req).doc_type });
    if (!hasPermission(req.user!.permissions, 'costs.view')) r.moves.forEach((m: any) => (m.value = null));
    return r;
  });
  app.get('/api/reports/warehouse-stock', { preHandler: perm('inventory.view') }, async (req) => {
    assertWarehouseScope(req, q(req).warehouse_id);
    if (!q(req).warehouse_id && req.user!.warehouse_ids !== null) throw new AppError('حدد مخزنًا من المخازن المسموح بها', 'forbidden');
    const r = await R.warehouseStock(db, q(req).warehouse_id || undefined, { onlyNonZero: q(req).nonzero === '1' });
    if (!hasPermission(req.user!.permissions, 'costs.view')) {
      r.rows.forEach((x: any) => (x.value = null));
      r.total_value = null as any;
    }
    return r;
  });
  app.get('/api/reports/warehouse-movement/:id', { preHandler: perm('inventory.view') }, async (req) => {
    assertWarehouseScope(req, (req.params as any).id);
    const result = await R.warehouseMovement(db, (req.params as any).id, { ...range(req), item_id: q(req).item_id });
    if (!hasPermission(req.user!.permissions, 'costs.view')) result.moves.forEach((m: any) => (m.value = null));
    return result;
  });
  app.get('/api/reports/reorder', { preHandler: perm('inventory.view') }, async (req) => R.reorderReport(db, req.user!.warehouse_ids));
  app.get('/api/reports/documents', { preHandler: perm('reports.view') }, async (req) => {
    const accessibleTypes = Object.entries(DOC_TYPES)
      .filter(([, info]) => hasPermission(req.user!.permissions, info.module === 'accounts' ? 'accounts.view' : `${info.module}.view`))
      .map(([type]) => type);
    const requestedTypes = q(req).types?.split(',').filter(Boolean);
    const docTypes = requestedTypes ? requestedTypes.filter((type) => accessibleTypes.includes(type)) : accessibleTypes;
    assertWarehouseScope(req, q(req).warehouse_id);
    const r = await R.documentsReport(db, {
      ...range(req),
      doc_types: docTypes,
      party_id: q(req).party_id,
      user_id: q(req).user_id,
      status: q(req).status,
      warehouse_id: q(req).warehouse_id,
      warehouse_ids: req.user!.warehouse_ids,
      cashbox_ids: req.user!.cashbox_ids,
    });
    if (!hasPermission(req.user!.permissions, 'reports.profit')) {
      r.rows.forEach((x: any) => (x.cost = null));
      (r.totals as any).cost = null;
      (r.totals as any).profit = null;
    }
    return r;
  });
  app.get('/api/documents/:id', { preHandler: auth }, async (req) => {
    const id = (req.params as any).id;
    const target = await db.one(`select id, doc_type, warehouse_id, to_warehouse_id, cashbox_id, data from documents where id = $1`, [id]);
    if (!target) throw new AppError('المستند غير موجود', 'not_found');
    const module = DOC_TYPES[target.doc_type as keyof typeof DOC_TYPES]?.module;
    const permission = module === 'accounts' ? 'accounts.view' : module ? `${module}.view` : '';
    if (!permission || !hasPermission(req.user!.permissions, permission)) throw new AppError('ليس لديك صلاحية عرض هذا المستند', 'forbidden');
    assertWarehouseScope(req, target.warehouse_id);
    assertWarehouseScope(req, target.to_warehouse_id);
    assertCashboxScope(req, target.cashbox_id);
    const data = typeof target.data === 'string' ? JSON.parse(target.data || '{}') : target.data ?? {};
    for (const payment of data.payments ?? []) assertCashboxScope(req, payment.cashbox_id);
    const r = await R.documentDetail(db, id);
    if (!hasPermission(req.user!.permissions, 'costs.view')) {
      (r.doc as any).cost = null;
      r.lines.forEach((l: any) => (l.cost = null));
    }
    if (!hasPermission(req.user!.permissions, 'accounts.view')) r.entries = [];
    if (!hasPermission(req.user!.permissions, 'audit.view')) r.audit = [];
    const relatedRows = await db.query(`select id, doc_type, warehouse_id, to_warehouse_id, cashbox_id, data from documents where ref_doc_id = $1`, [id]);
    const allowedRelated = new Set(relatedRows.filter((row: any) => {
      const relatedModule = DOC_TYPES[row.doc_type as keyof typeof DOC_TYPES]?.module;
      const relatedPermission = relatedModule === 'accounts' ? 'accounts.view' : relatedModule ? `${relatedModule}.view` : '';
      if (!relatedPermission || !hasPermission(req.user!.permissions, relatedPermission)) return false;
      if ((row.warehouse_id && req.user!.warehouse_ids && !req.user!.warehouse_ids.includes(row.warehouse_id)) || (row.to_warehouse_id && req.user!.warehouse_ids && !req.user!.warehouse_ids.includes(row.to_warehouse_id))) return false;
      if (row.cashbox_id && req.user!.cashbox_ids && !req.user!.cashbox_ids.includes(row.cashbox_id)) return false;
      const relatedData = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : row.data ?? {};
      return (relatedData.payments ?? []).every((payment: any) => !req.user!.cashbox_ids || req.user!.cashbox_ids.includes(payment.cashbox_id));
    }).map((row: any) => row.id));
    r.related = r.related.filter((row: any) => allowedRelated.has(row.id));
    return r;
  });

  app.get('/api/reports/commissions', { preHandler: perm('reports.view') }, async (req) => R.commissionsReport(db, range(req)));
  app.get('/api/admin/integrity', { preHandler: perm('reports.financial') }, async () => integrityCheck(db));
  app.get('/api/reports/closing-preview', { preHandler: perm('reports.financial') }, async (req) => R.closingPreview(db, q(req).to || todayISO()));
  app.get('/api/reports/partners', { preHandler: perm('partners.view') }, async (req) => R.partnersReport(db, range(req)));
  app.get('/api/reports/serial', { preHandler: perm('inventory.view') }, async (req) => R.serialSearch(db, q(req).q ?? '', req.user!.warehouse_ids));
  app.get('/api/reports/expiry', { preHandler: perm('inventory.view') }, async (req) => {
    assertWarehouseScope(req, q(req).warehouse_id);
    const r = await R.expiryReport(db, { warehouse_id: q(req).warehouse_id, warehouse_ids: req.user!.warehouse_ids, until: q(req).until });
    if (!hasPermission(req.user!.permissions, 'costs.view')) r.rows.forEach((x: any) => (x.avg_cost = null));
    return r;
  });
  app.get('/api/reports/sales-analysis', { preHandler: perm('reports.view') }, async (req) => {
    const kind = q(req).kind === 'purchases' ? 'purchases' : 'sales';
    if (!hasPermission(req.user!.permissions, `${kind}.view`)) throw new AppError('ليس لديك صلاحية عرض هذا التقرير', 'forbidden');
    const r = await R.salesAnalysis(db, { ...range(req), group: q(req).group ?? 'item', kind, warehouse_ids: req.user!.warehouse_ids });
    if (!hasPermission(req.user!.permissions, 'reports.profit')) r.rows.forEach((x: any) => ((x.cost = null), (x.profit = null)));
    return r;
  });
  app.get('/api/reports/treasury-analysis', { preHandler: perm('treasury.view') }, async (req) => {
    assertCashboxScope(req, q(req).cashbox_id);
    return R.treasuryAnalysis(db, { ...range(req), dir: q(req).dir === 'out' ? 'out' : 'in', group: q(req).group ?? 'item', cashbox_id: q(req).cashbox_id || undefined, cashbox_ids: req.user!.cashbox_ids, user_id: q(req).user_id || undefined, internal: q(req).internal === '1' });
  });
  app.get('/api/reports/daily', { preHandler: perm('reports.view') }, async (req) => {
    const doc_types = Object.entries(DOC_TYPES)
      .filter(([, info]) => hasPermission(req.user!.permissions, info.module === 'accounts' ? 'accounts.view' : `${info.module}.view`))
      .map(([type]) => type);
    const r = await R.dailyMovement(db, { ...range(req), doc_types, warehouse_ids: req.user!.warehouse_ids, cashbox_ids: req.user!.cashbox_ids, user_id: q(req).user_id || undefined });
    if (!hasPermission(req.user!.permissions, 'treasury.view')) r.cashboxes = [];
    return r;
  });
  app.get('/api/shifts/:id/expected', { preHandler: perm('treasury.shift') }, async (req) => {
    const r = await shiftExpected(db, (req.params as any).id);
    return { expected: r.expected, movement: r.movement, opening_float: r.shift.opening_float };
  });

  // ---------------- الإدارة ----------------
  app.get('/api/admin/audit', { preHandler: perm('audit.view') }, async (req) => {
    const params: unknown[] = [];
    const conds = ['true'];
    if (q(req).user_id) {
      params.push(q(req).user_id);
      conds.push(`a.user_id = $${params.length}`);
    }
    if (q(req).device_id) {
      params.push(q(req).device_id);
      conds.push(`a.device_id = $${params.length}`);
    }
    return {
      rows: await db.query(
        `select a.*, u.full_name as user_name, d.name as device_name from audit_log a left join users u on u.id = a.user_id left join devices d on d.id = a.device_id
          where ${conds.join(' and ')} order by a.id desc limit 500`,
        params,
      ),
    };
  });
  app.get('/api/admin/devices', { preHandler: perm('audit.view') }, async () => ({
    rows: await db.query(`select d.*, u.full_name as user_name from devices d left join users u on u.id = d.user_id order by last_seen desc`),
  }));

  app.post('/api/admin/users', { preHandler: perm('users.manage') }, async (req) => {
    const b = z
      .object({
        id: z.string().optional(),
        username: z.string().trim().min(2, 'اسم المستخدم حرفان على الأقل').max(50),
        full_name: z.string().trim().min(2).max(100),
        role_id: z.string(),
        active: z.boolean().default(true),
        password: z.string().min(6, 'كلمة المرور 6 أحرف على الأقل').optional(),
        warehouse_ids: z.array(z.string()).nullable().optional(),
        cashbox_ids: z.array(z.string()).nullable().optional(),
        extra_permissions: z.array(z.string()).optional(),
        denied_permissions: z.array(z.string()).optional(),
      })
      .parse(req.body);
    const known = new Set(ALL_PERMISSIONS);
    const extra = [...new Set((b.extra_permissions ?? []).filter((p) => known.has(p)))];
    const denied = [...new Set((b.denied_permissions ?? []).filter((p) => known.has(p) && !extra.includes(p)))];
    if (b.id === req.user!.id && !b.active) throw new AppError('لا يمكنك إيقاف حسابك الحالي');
    return db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(7331)`);
      if (!(await t.one(`select 1 from roles where id = $1`, [b.role_id]))) throw new AppError('الدور غير موجود');
      let id = b.id;
      if (id) {
        await t.query(`update users set username = $2, full_name = $3, role_id = $4, active = $5, warehouse_ids = $6, cashbox_ids = $7, extra_permissions = $8, denied_permissions = $9 where id = $1`, [
          id, b.username, b.full_name, b.role_id, b.active, b.warehouse_ids ? JSON.stringify(b.warehouse_ids) : null, b.cashbox_ids ? JSON.stringify(b.cashbox_ids) : null,
          JSON.stringify(extra), JSON.stringify(denied),
        ]);
        if (b.password) await t.query(`update users set password_hash = $2 where id = $1`, [id, await hashPassword(b.password)]);
      } else {
        if (!b.password) throw new AppError('كلمة المرور مطلوب للمستخدم الجديد');
        id = crypto.randomUUID();
        await t.query(`insert into users (id, username, full_name, password_hash, role_id, active, warehouse_ids, cashbox_ids, extra_permissions, denied_permissions) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
          id, b.username, b.full_name, await hashPassword(b.password), b.role_id, b.active,
          b.warehouse_ids ? JSON.stringify(b.warehouse_ids) : null, b.cashbox_ids ? JSON.stringify(b.cashbox_ids) : null,
          JSON.stringify(extra), JSON.stringify(denied),
        ]);
      }
      await t.query(`insert into audit_log (user_id, device_id, action, entity, entity_id, details) values ($1,$2,'user.save','user',$3,$4)`, [
        req.user!.id, req.deviceId, id, JSON.stringify({ username: b.username, role_id: b.role_id, active: b.active, password_changed: !!b.password, extra_permissions: extra, denied_permissions: denied }),
      ]);
      return { id };
    });
  });

  // صفحة البداية الافتراضية لكل دور (تُحفظ في الإعدادات وتصل للأجهزة بالمزامنة)
  app.post('/api/admin/role-home', { preHandler: perm('users.manage') }, async (req) => {
    const b = z.object({ role_id: z.string().min(1).max(100), workspace: z.enum(WORKSPACE_IDS as [string, ...string[]]).nullable() }).parse(req.body);
    return db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(7331)`);
      const role = await t.one(`select id from roles where id = $1`, [b.role_id]);
      if (!role) throw new AppError('الدور غير موجود');
      const cur = (await t.one(`select value from settings where key = 'role_home_pages'`))?.value;
      const map: Record<string, string> = { ...(typeof cur === 'string' ? JSON.parse(cur) : cur ?? {}) };
      if (b.workspace) map[b.role_id] = b.workspace;
      else delete map[b.role_id];
      await t.query(`insert into settings (key, value) values ('role_home_pages', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(map)]);
      await t.query(`insert into audit_log (user_id, device_id, action, entity, entity_id, details) values ($1,$2,'role.home','role',$3,$4)`, [req.user!.id, req.deviceId, b.role_id, JSON.stringify(b)]);
      return { ok: true, role_home_pages: map };
    });
  });
  app.post('/api/admin/roles', { preHandler: perm('users.manage') }, async (req) => {
    const b = z
      .object({
        id: z.string().optional(),
        name: z.string().trim().min(2).max(50),
        permissions: z.array(z.string()),
        limits: z.object({ max_discount_bp: z.number().int().min(0).max(10000).optional(), max_discount_amount: z.number().int().min(0).optional() }).default({}),
      })
      .parse(req.body);
    return db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(7331)`);
      if (b.id === 'role-admin') throw new AppError('لا يمكن تعديل دور مدير النظام');
      const id = b.id ?? crypto.randomUUID();
      await t.query(
        `insert into roles (id, name, permissions, limits) values ($1,$2,$3,$4) on conflict (id) do update set name = excluded.name, permissions = excluded.permissions, limits = excluded.limits`,
        [id, b.name, JSON.stringify(b.permissions), JSON.stringify(b.limits)],
      );
      await t.query(`insert into audit_log (user_id, device_id, action, entity, entity_id, details) values ($1,$2,'role.save','role',$3,$4)`, [
        req.user!.id, req.deviceId, id, JSON.stringify(b),
      ]);
      return { id };
    });
  });

  app.post('/api/admin/settings', { preHandler: perm('settings.manage') }, async (req) => {
    const b = z.record(z.any()).parse(req.body);
    const allowed = ['company_name', 'system_name', 'company_address', 'company_phone', 'company_tax_no', 'default_tax_rate_bp', 'allow_negative_stock', 'enforce_credit_limit', 'invoice_footer', 'default_due_days', 'locked_until',
      'print_logo', 'print_template_invoice', 'print_template_voucher', 'print_show_balance', 'print_contract_terms',
      'work_start_time', 'work_end_time', 'late_grace_minutes', 'weekly_off_days', 'monthly_leave_days'];
    return db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(7331)`);
      for (const [k, v] of Object.entries(b)) {
        if (!allowed.includes(k)) throw new AppError(`إعداد غير معروف: ${k}`);
        if (k === 'print_logo' && v !== null && (typeof v !== 'string' || !v.startsWith('data:image/') || v.length > 300_000)) {
          throw new AppError('الشعار يجب أن يكون صورة أصغر من 200 كيلوبايت');
        }
        if (k === 'system_name' && (typeof v !== 'string' || v.length > 60)) throw new AppError('اسم النظام لازم يكون نص أقصاه 60 حرف');
        if (k === 'work_start_time' && (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))) throw new AppError('ميعاد بداية الشغل غير صالح');
        if (k === 'work_end_time' && (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))) throw new AppError('ميعاد الانصراف غير صالح');
        if (k === 'monthly_leave_days' && (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 31)) throw new AppError('عدد أيام الأجازة الشهرية يجب أن يكون بين 0 و31');
        if (k === 'late_grace_minutes' && (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 240)) throw new AppError('فترة السماح يجب أن تكون بين 0 و240 دقيقة');
        if (k === 'weekly_off_days' && (!Array.isArray(v) || v.length > 6 || v.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(v).size !== v.length)) throw new AppError('أيام الأجازة الأسبوعية غير صالحة');
        if (k === 'locked_until') {
          if (!hasPermission(req.user!.permissions, 'period.lock')) throw new AppError('قفل الفترات يحتاج صلاحية خاصة', 'forbidden');
          if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new AppError('تاريخ القفل غير صالح');
        }
        await t.query(`insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`, [k, JSON.stringify(v)]);
      }
      await t.query(`insert into audit_log (user_id, device_id, action, entity, details) values ($1,$2,'settings.save','settings',$3)`, [req.user!.id, req.deviceId, JSON.stringify(b)]);
      return { ok: true };
    });
  });

  app.get('/api/admin/backups', { preHandler: perm('backup.manage') }, async () => ({ files: opts.ephemeralBackups ? [] : await listBackups(opts.backupDir), ephemeral: !!opts.ephemeralBackups }));
  // نسخة كاملة تُنزَّل مباشرة على جهاز المستخدم (تعمل على أي خادم، والوحيدة المتاحة على Vercel)؛ مضغوطة لتقليل الحجم
  app.get('/api/admin/backup-download', { preHandler: perm('backup.manage') }, async (req, reply: FastifyReply) => {
    const data = await exportData(db, 'download');
    const name = `erp-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-download.json`;
    await db.query(`insert into audit_log (user_id, device_id, action, details) values ($1,$2,'backup.download',$3)`, [req.user!.id, req.deviceId, JSON.stringify({ file: name })]);
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-encoding', 'gzip');
    reply.header('content-disposition', `attachment; filename="${name}"`);
    return reply.send(gzipSync(Buffer.from(JSON.stringify(data))));
  });
  app.post('/api/admin/backups', { preHandler: perm('backup.manage') }, async (req) => {
    if (opts.ephemeralBackups) throw new AppError('هذا الخادم لا يحفظ نسخًا عليه؛ استخدم «تنزيل نسخة على جهازي»', 'state');
    const file = await backupToFile(db, opts.backupDir, 'manual');
    await db.query(`insert into audit_log (user_id, device_id, action, details) values ($1,$2,'backup.create',$3)`, [req.user!.id, req.deviceId, JSON.stringify({ file: path.basename(file) })]);
    return { file: path.basename(file) };
  });
  app.post('/api/admin/backups/restore', { preHandler: perm('backup.manage') }, async (req) => {
    const b = z.object({ file: z.string().regex(/^erp-backup-[\w.-]+\.json$/, 'اسم ملف غير صالح') }).parse(req.body);
    const full = path.join(opts.backupDir, b.file);
    if (!existsSync(full)) throw new AppError('الملف غير موجود', 'not_found');
    // نسخة من الوضع الحالي قبل الاستعادة حتى يمكن التراجع
    const safety = await backupToFile(db, opts.backupDir, 'pre-restore');
    const r = await restoreFromFile(db, full);
    await db.query(`insert into audit_log (user_id, device_id, action, details) values ($1,$2,'backup.restore',$3)`, [
      req.user!.id, req.deviceId, JSON.stringify({ file: b.file, safety: path.basename(safety), rows: r.rows }),
    ]);
    return { ok: true, rows: r.rows, safety_backup: path.basename(safety) };
  });
  app.get('/api/admin/backups/:file', { preHandler: perm('backup.manage') }, async (req, reply: FastifyReply) => {
    const file = (req.params as any).file as string;
    if (!/^erp-backup-[\w.-]+\.json$/.test(file)) throw new AppError('اسم ملف غير صالح');
    reply.header('content-disposition', `attachment; filename="${file}"`);
    return reply.sendFile(file, path.resolve(opts.backupDir));
  });

  // ---------------- الواجهة (PWA) ----------------
  if (opts.webDist && existsSync(opts.webDist)) {
    await app.register(fastifyStatic, {
      root: path.resolve(opts.webDist),
      // wildcard: يخدم الملفات من القرص مباشرة، فلا يحتاج الخادم إعادة تشغيل بعد إعادة بناء الواجهة
      wildcard: true,
      // ملفات assets تحمل بصمة في اسمها فتُخزّن طويلًا؛ index.html و sw.js يجب أن يُتحقق منهما دائمًا
      setHeaders(res, filePath) {
        if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        else res.setHeader('cache-control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      // طلب ملف غير موجود (مثل نسخة قديمة من سكربت) يجب أن يعيد 404 وليس صفحة التطبيق
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/') || /\.[a-z0-9]{2,5}(\?|$)/i.test(req.url)) {
        return reply.status(404).send({ error: 'غير موجود' });
      }
      reply.header('cache-control', 'no-cache');
      return reply.sendFile('index.html');
    });
  } else {
    await app.register(fastifyStatic, { root: path.resolve(opts.backupDir), serve: false });
  }

  return app;
}
