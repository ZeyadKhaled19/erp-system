import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { hasPermission, todayISO } from '@erp/shared';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashPassword, loadAuthUser, makeTokens, verifyPassword, type AuthUser } from './auth';
import { backupToFile, listBackups, restoreFromFile } from './backup';
import type { Db } from './db';
import { AppError } from './errors';
import { applyOp } from './ops';
import * as R from './reports';
import { pull } from './sync';

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  backupDir: string;
  webDist?: string;
  logger?: boolean;
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

  // ---------------- عام ----------------
  app.get('/api/health', async () => {
    await db.one('select 1');
    return { ok: true, time: new Date().toISOString(), db: db.kind };
  });

  // ---------------- الدخول ----------------
  app.post('/api/auth/login', async (req) => {
    const body = z
      .object({ username: z.string().min(1), password: z.string().min(1), device_id: z.string().min(8).max(64), device_name: z.string().max(100).optional() })
      .parse(req.body);
    const u = await db.one(`select * from users where lower(username) = lower($1)`, [body.username.trim()]);
    if (!u || !u.active || !(await verifyPassword(body.password, u.password_hash))) {
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
    return pull(db, cursor);
  });

  // ---------------- التقارير ----------------
  app.get('/api/reports/dashboard', { preHandler: auth }, async (req) => {
    const d = await R.dashboard(db, q(req).today || todayISO());
    if (!hasPermission(req.user!.permissions, 'reports.profit')) d.month_gross_profit = null as any;
    return d;
  });
  app.get('/api/reports/trial-balance', { preHandler: perm('reports.financial') }, async (req) => R.trialBalance(db, range(req)));
  app.get('/api/reports/ledger/:id', { preHandler: perm('reports.financial') }, async (req) =>
    R.ledger(db, (req.params as any).id, { ...range(req), party_id: q(req).party_id }),
  );
  app.get('/api/reports/income-statement', { preHandler: perm('reports.profit') }, async (req) => R.incomeStatement(db, range(req)));
  app.get('/api/reports/balance-sheet', { preHandler: perm('reports.financial') }, async (req) => R.balanceSheet(db, q(req).to || todayISO()));
  app.get('/api/reports/party/:id', { preHandler: perm('parties.view') }, async (req) => R.partyStatement(db, (req.params as any).id, range(req)));
  app.get('/api/reports/cashbox/:id', { preHandler: perm('treasury.view') }, async (req) => R.cashboxMovement(db, (req.params as any).id, range(req)));
  app.get('/api/reports/item/:id', { preHandler: perm('inventory.view') }, async (req) => {
    const r = await R.itemMovement(db, (req.params as any).id, { ...range(req), warehouse_id: q(req).warehouse_id, doc_type: q(req).doc_type });
    if (!hasPermission(req.user!.permissions, 'costs.view')) r.moves.forEach((m: any) => (m.value = null));
    return r;
  });
  app.get('/api/reports/warehouse-stock', { preHandler: perm('inventory.view') }, async (req) => {
    const r = await R.warehouseStock(db, q(req).warehouse_id || undefined, { onlyNonZero: q(req).nonzero === '1' });
    if (!hasPermission(req.user!.permissions, 'costs.view')) {
      r.rows.forEach((x: any) => (x.value = null));
      r.total_value = null as any;
    }
    return r;
  });
  app.get('/api/reports/warehouse-movement/:id', { preHandler: perm('inventory.view') }, async (req) =>
    R.warehouseMovement(db, (req.params as any).id, { ...range(req), item_id: q(req).item_id }),
  );
  app.get('/api/reports/reorder', { preHandler: perm('inventory.view') }, async () => R.reorderReport(db));
  app.get('/api/reports/documents', { preHandler: perm('reports.view') }, async (req) => {
    const r = await R.documentsReport(db, {
      ...range(req),
      doc_types: q(req).types?.split(',').filter(Boolean),
      party_id: q(req).party_id,
      user_id: q(req).user_id,
      status: q(req).status,
      warehouse_id: q(req).warehouse_id,
    });
    if (!hasPermission(req.user!.permissions, 'reports.profit')) {
      r.rows.forEach((x: any) => (x.cost = null));
      (r.totals as any).cost = null;
      (r.totals as any).profit = null;
    }
    return r;
  });
  app.get('/api/documents/:id', { preHandler: auth }, async (req) => {
    const r = await R.documentDetail(db, (req.params as any).id);
    if (!hasPermission(req.user!.permissions, 'costs.view')) {
      (r.doc as any).cost = null;
      r.lines.forEach((l: any) => (l.cost = null));
    }
    return r;
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
      })
      .parse(req.body);
    if (b.id === req.user!.id && !b.active) throw new AppError('لا يمكنك إيقاف حسابك الحالي');
    return db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(7331)`);
      if (!(await t.one(`select 1 from roles where id = $1`, [b.role_id]))) throw new AppError('الدور غير موجود');
      let id = b.id;
      if (id) {
        await t.query(`update users set username = $2, full_name = $3, role_id = $4, active = $5 where id = $1`, [id, b.username, b.full_name, b.role_id, b.active]);
        if (b.password) await t.query(`update users set password_hash = $2 where id = $1`, [id, await hashPassword(b.password)]);
      } else {
        if (!b.password) throw new AppError('كلمة المرور مطلوب للمستخدم الجديد');
        id = crypto.randomUUID();
        await t.query(`insert into users (id, username, full_name, password_hash, role_id, active) values ($1,$2,$3,$4,$5,$6)`, [
          id, b.username, b.full_name, await hashPassword(b.password), b.role_id, b.active,
        ]);
      }
      await t.query(`insert into audit_log (user_id, device_id, action, entity, entity_id, details) values ($1,$2,'user.save','user',$3,$4)`, [
        req.user!.id, req.deviceId, id, JSON.stringify({ username: b.username, role_id: b.role_id, active: b.active, password_changed: !!b.password }),
      ]);
      return { id };
    });
  });

  app.post('/api/admin/roles', { preHandler: perm('users.manage') }, async (req) => {
    const b = z.object({ id: z.string().optional(), name: z.string().trim().min(2).max(50), permissions: z.array(z.string()) }).parse(req.body);
    return db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(7331)`);
      if (b.id === 'role-admin') throw new AppError('لا يمكن تعديل دور مدير النظام');
      const id = b.id ?? crypto.randomUUID();
      await t.query(
        `insert into roles (id, name, permissions) values ($1,$2,$3) on conflict (id) do update set name = excluded.name, permissions = excluded.permissions`,
        [id, b.name, JSON.stringify(b.permissions)],
      );
      await t.query(`insert into audit_log (user_id, device_id, action, entity, entity_id, details) values ($1,$2,'role.save','role',$3,$4)`, [
        req.user!.id, req.deviceId, id, JSON.stringify(b),
      ]);
      return { id };
    });
  });

  app.post('/api/admin/settings', { preHandler: perm('settings.manage') }, async (req) => {
    const b = z.record(z.any()).parse(req.body);
    const allowed = ['company_name', 'company_address', 'company_phone', 'company_tax_no', 'default_tax_rate_bp', 'allow_negative_stock', 'enforce_credit_limit', 'invoice_footer'];
    return db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(7331)`);
      for (const [k, v] of Object.entries(b)) {
        if (!allowed.includes(k)) throw new AppError(`إعداد غير معروف: ${k}`);
        await t.query(`insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`, [k, JSON.stringify(v)]);
      }
      await t.query(`insert into audit_log (user_id, device_id, action, entity, details) values ($1,$2,'settings.save','settings',$3)`, [req.user!.id, req.deviceId, JSON.stringify(b)]);
      return { ok: true };
    });
  });

  app.get('/api/admin/backups', { preHandler: perm('backup.manage') }, async () => ({ files: await listBackups(opts.backupDir) }));
  app.post('/api/admin/backups', { preHandler: perm('backup.manage') }, async (req) => {
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
    await app.register(fastifyStatic, { root: path.resolve(opts.webDist), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'غير موجود' });
      return reply.sendFile('index.html');
    });
  } else {
    await app.register(fastifyStatic, { root: path.resolve(opts.backupDir), serve: false });
  }

  return app;
}
