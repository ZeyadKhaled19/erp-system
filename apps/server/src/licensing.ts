import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from './db';
import { AppError } from './errors';
import { DEFAULT_CONTACT, expiryFor, licenseStatus, normalizeMachineId, signLicense, validMachineId, verifyLicense, type LicenseInput, type LicenseStatus, type VendorContact } from './license';

/** القفل في برنامج الويندوز: البرنامج بيدّي الخادم بيانات الجهاز، والخادم بيقرر مفتوح ولا مقفول */
export interface LicenseGate {
  get(): LicenseInput;
  /** اتحط كود صحيح: البرنامج بيحفظه */
  activate(code: string): void;
}

export interface LicensingOptions {
  db: Db;
  /** موجود في برنامج الويندوز بس */
  gate?: LicenseGate;
  /** موقع صاحب السيستم: صفحة التسجيل وصفحة التراخيص شغالين */
  vendor?: boolean;
  /** المفتاح السري لتوقيع أكواد التفعيل (LICENSE_PRIVATE_KEY) */
  privateKey?: string;
  /** لينك تحميل برنامج الويندوز (لو مش موجود بنجيبه من آخر نسخة على GitHub) */
  downloadUrl?: string;
  perm: (key: string) => (req: FastifyRequest) => Promise<void>;
}

const RELEASES = 'https://github.com/ZeyadKhaled19/erp-releases/releases';
// الطلبات المسموحة والبرنامج مقفول: معرفة الحالة والتفعيل، وشكل صفحة الدخول
const OPEN_WHEN_LOCKED = ['/api/license', '/api/brand', '/api/health'];

export function registerLicensing(app: FastifyInstance, o: LicensingOptions) {
  const status = (): LicenseStatus | null => (o.gate ? licenseStatus(o.gate.get()) : null);

  // ---------------- القفل ----------------
  if (o.gate) {
    app.addHook('onRequest', async (req, reply) => {
      const url = req.url.split('?')[0];
      if (!url.startsWith('/api/') || OPEN_WHEN_LOCKED.some((p) => url === p || url.startsWith(p + '/'))) return;
      const s = status();
      if (s?.status === 'expired') return reply.status(402).send({ error: s.message, code: 'license' });
    });
  }

  // بيانات التواصل: على موقع صاحب السيستم من الإعدادات، وفي برنامج الويندوز آخر نسخة جت من الموقع
  const vendorContact = async (): Promise<VendorContact> => {
    const row = await o.db.one<{ value: any }>(`select value from settings where key = 'vendor_contact'`);
    const v = typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value;
    return { ...DEFAULT_CONTACT, ...(v && typeof v === 'object' ? v : {}) };
  };
  const contact = async (): Promise<VendorContact> => (o.vendor ? vendorContact() : { ...DEFAULT_CONTACT, ...(o.gate?.get().contact ?? {}) });

  app.get('/api/license', async () => {
    const s = status();
    return { gated: !!o.gate, vendor: !!o.vendor, canIssue: !!(o.vendor && o.privateKey), license: s, contact: await contact() };
  });

  app.post('/api/license/activate', async (req) => {
    if (!o.gate) throw new AppError('التفعيل بيتعمل من برنامج الويندوز', 'state');
    const { code } = z.object({ code: z.string().min(10).max(2000) }).parse(req.body);
    const input = o.gate.get();
    const v = verifyLicense(code, input.machineId);
    if (!v.ok) throw new AppError(v.error);
    const s = licenseStatus({ ...input, code: code.replace(/\s+/g, '') });
    if (s.status !== 'active') throw new AppError(s.status === 'expired' ? s.message : 'الكود ده مش شغال');
    o.gate.activate(code.replace(/\s+/g, ''));
    return { license: s };
  });

  if (!o.vendor) return;

  // ---------------- التسجيل في التجربة (من غير دخول) ----------------
  // حماية بسيطة من الإزعاج: 5 تسجيلات بالكتير من نفس العنوان في الساعة
  const hits = new Map<string, number[]>();
  let cachedUrl: { url: string; at: number } | null = null;
  const downloadUrl = async () => {
    if (o.downloadUrl) return o.downloadUrl;
    if (cachedUrl && Date.now() - cachedUrl.at < 10 * 60 * 1000) return cachedUrl.url;
    try {
      const yml = await (await fetch(`${RELEASES}/latest/download/latest.yml`, { signal: AbortSignal.timeout(8000) })).text();
      const file = /^path:\s*(.+)$/m.exec(yml)?.[1]?.trim();
      if (file) {
        const url = `${RELEASES}/latest/download/${encodeURIComponent(file)}`;
        cachedUrl = { url, at: Date.now() };
        return url;
      }
    } catch { /* نرجع لصفحة آخر نسخة، ونجرب تاني المرة الجاية */ }
    return `${RELEASES}/latest`;
  };

  app.post('/api/public/trial-signup', async (req) => {
    const b = z
      .object({
        name: z.string().trim().min(2, 'اكتب اسمك').max(100),
        phone: z.string().trim().regex(/^[0-9+\s-]{8,20}$/, 'رقم الموبايل مش مظبوط'),
        business: z.string().trim().min(2, 'اكتب اسم النشاط أو المحل').max(120),
        activity: z.string().trim().max(80).optional().nullable(),
        city: z.string().trim().max(60).optional().nullable(),
        website: z.string().max(0).optional(), // خانة مخفية: لو اتملت يبقى برنامج آلي
      })
      .parse(req.body);
    const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0].trim();
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600000);
    if (recent.length >= 5) throw new AppError('سجلت كذا مرة. استنى شوية وجرب تاني، أو كلمنا على طول.');
    hits.set(ip, [...recent, now]);
    const id = crypto.randomUUID();
    await o.db.query(`insert into trial_signups (id, name, phone, business, activity, city, ip) values ($1,$2,$3,$4,$5,$6,$7)`, [
      id, b.name, b.phone.replace(/\s+/g, ''), b.business, b.activity || null, b.city || null, ip || null,
    ]);
    return { ok: true, download_url: await downloadUrl() };
  });

  app.get('/api/public/download', async () => ({ download_url: await downloadUrl() }));

  // ---------------- إشارة من برنامج الويندوز (لما يكون على النت) ----------------
  // بتوصل: رقم الجهاز واسم المحل ورقم النسخة وحالة الترخيص بس. والرد فيه بيانات التواصل علشان شاشة التفعيل.
  const pings = new Map<string, number>();
  app.post('/api/public/ping', async (req) => {
    const b = z
      .object({
        machine_id: z.string().refine(validMachineId),
        company_name: z.string().trim().max(120).optional().nullable(),
        version: z.string().trim().max(20).optional().nullable(),
        status: z.enum(['trial', 'active', 'expired']).optional().nullable(),
        days_left: z.number().int().min(0).max(36500).optional().nullable(),
        expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        legacy: z.boolean().optional(),
      })
      .parse(req.body);
    const machine = normalizeMachineId(b.machine_id);
    const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0].trim();
    // جهاز واحد مرة كل دقيقة بالكتير (حماية من الإزعاج)
    if (Date.now() - (pings.get(machine) ?? 0) > 60000) {
      pings.set(machine, Date.now());
      await o.db.query(
        `insert into installations (machine_id, company_name, version, status, days_left, expires_at, legacy, ip) values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (machine_id) do update set company_name = coalesce(excluded.company_name, installations.company_name), version = excluded.version,
           status = excluded.status, days_left = excluded.days_left, expires_at = excluded.expires_at, legacy = excluded.legacy, ip = excluded.ip,
           last_seen = now(), pings = installations.pings + 1`,
        [machine, b.company_name || null, b.version || null, b.status || null, b.days_left ?? null, b.expires_at || null, !!b.legacy, ip || null],
      );
    }
    return { contact: await vendorContact() };
  });

  app.get('/api/public/contact', async () => ({ contact: await vendorContact() }));

  app.post('/api/admin/vendor-contact', { preHandler: o.perm('settings.manage') }, async (req) => {
    const link = z.string().trim().max(300).refine((v) => !v || /^https?:\/\//i.test(v), 'اللينك لازم يبدأ بـ https://');
    const phone = z.string().trim().max(30).refine((v) => !v || /^[0-9+\s-]{8,20}$/.test(v), 'الرقم مش مظبوط');
    const b = z.object({ phone, whatsapp: phone, facebook: link, youtube: link }).parse(req.body);
    await o.db.query(`insert into settings (key, value) values ('vendor_contact', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(b)]);
    return { contact: await vendorContact() };
  });

  // ---------------- لوحة صاحب السيستم ----------------
  app.get('/api/admin/owner-dashboard', { preHandler: o.perm('settings.manage') }, async () => {
    const one = async (sql: string) => Number((await o.db.one<{ n: any }>(sql))?.n ?? 0);
    const signups = {
      today: await one(`select count(*) as n from trial_signups where created_at >= current_date`),
      week: await one(`select count(*) as n from trial_signups where created_at >= now() - interval '7 days'`),
      month: await one(`select count(*) as n from trial_signups where created_at >= date_trunc('month', now())`),
      total: await one(`select count(*) as n from trial_signups`),
      activated: await one(`select count(*) as n from trial_signups where status = 'activated'`),
    };
    const licenses = {
      total: await one(`select count(distinct machine_id) as n from licenses`),
      active: await one(`select count(distinct machine_id) as n from licenses where expires_at is null or expires_at >= current_date`),
      expiring: await one(`select count(distinct machine_id) as n from licenses where expires_at between current_date and current_date + 30`),
    };
    const revenue = {
      month: await one(`select coalesce(sum(amount), 0) as n from licenses where created_at >= date_trunc('month', now())`),
      lastMonth: await one(`select coalesce(sum(amount), 0) as n from licenses where created_at >= date_trunc('month', now()) - interval '1 month' and created_at < date_trunc('month', now())`),
      total: await one(`select coalesce(sum(amount), 0) as n from licenses`),
    };
    const devices = {
      total: await one(`select count(*) as n from installations`),
      trial: await one(`select count(*) as n from installations where status = 'trial'`),
      seenWeek: await one(`select count(*) as n from installations where last_seen >= now() - interval '7 days'`),
    };
    // تكلم مين النهارده
    const newSignups = await o.db.query(`select id, name, phone, business, created_at from trial_signups where status = 'new' order by created_at desc limit 30`);
    const endingTrials = await o.db.query(`select machine_id, company_name, days_left, last_seen from installations where status = 'trial' and days_left <= 2 order by days_left, last_seen desc limit 30`);
    const expiringLicenses = await o.db.query(
      `select distinct on (machine_id) machine_id, customer, phone, expires_at from licenses where expires_at between current_date and current_date + 30 order by machine_id, expires_at desc limit 30`,
    );
    const installations = await o.db.query(
      `select i.*, l.customer, l.phone from installations i
       left join lateral (select customer, phone from licenses where machine_id = i.machine_id order by created_at desc limit 1) l on true
       order by i.last_seen desc limit 300`,
    );
    // التسجيلات والتفعيلات أسبوع بأسبوع (آخر 12 أسبوع)
    const weekly = await o.db.query(
      `select to_char(w, 'YYYY-MM-DD') as week,
         (select count(*) from trial_signups where created_at >= w and created_at < w + interval '7 days')::int as signups,
         (select count(*) from licenses where created_at >= w and created_at < w + interval '7 days')::int as activations
       from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as w order by w`,
    );
    return { signups, licenses, revenue, devices, newSignups, endingTrials, expiringLicenses, installations, weekly, contact: await vendorContact() };
  });

  // ---------------- صفحة التراخيص (لصاحب السيستم) ----------------
  app.get('/api/admin/licensing', { preHandler: o.perm('settings.manage') }, async () => {
    const signups = await o.db.query(`select * from trial_signups order by created_at desc limit 500`);
    const licenses = await o.db.query(`select l.*, u.full_name as created_by_name from licenses l left join users u on u.id = l.created_by order by l.created_at desc limit 500`);
    return { canIssue: !!o.privateKey, signups, licenses };
  });

  app.post('/api/admin/trial-signups/:id', { preHandler: o.perm('settings.manage') }, async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ status: z.enum(['new', 'contacted', 'activated', 'dropped']).optional(), notes: z.string().max(1000).nullable().optional() }).parse(req.body);
    const row = await o.db.one(`update trial_signups set status = coalesce($2, status), notes = case when $3::boolean then $4 else notes end where id = $1 returning *`, [id, b.status ?? null, b.notes !== undefined, b.notes ?? null]);
    if (!row) throw new AppError('مش موجود', 'not_found');
    return row;
  });

  app.post('/api/admin/licenses', { preHandler: o.perm('settings.manage') }, async (req) => {
    if (!o.privateKey) throw new AppError('مفتاح التوقيع (LICENSE_PRIVATE_KEY) مش متضبط في إعدادات Vercel، فمش هينفع يطلع أكواد.', 'state');
    const b = z
      .object({
        machine_id: z.string().refine(validMachineId, 'رقم الجهاز مش مظبوط. المفروض 16 حرف ورقم زي A1B2-C3D4-E5F6-0718'),
        customer: z.string().trim().min(2, 'اكتب اسم العميل').max(120),
        phone: z.string().trim().max(30).optional().nullable(),
        plan: z.enum(['month', 'quarter', 'year', 'life', 'days']),
        days: z.number().int().min(1).max(3650).optional(),
        signup_id: z.string().max(64).optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
        /** المبلغ المدفوع بالقرش */
        amount: z.number().int().min(0).max(1e12).optional(),
      })
      .parse(req.body);
    const machine = normalizeMachineId(b.machine_id);
    const expires = expiryFor(b.plan, b.days ?? 0);
    const today = new Date().toISOString().slice(0, 10);
    const code = signLicense(o.privateKey, { m: machine, e: expires, n: b.customer, t: today });
    const id = crypto.randomUUID();
    await o.db.query(
      `insert into licenses (id, machine_id, customer, phone, plan, expires_at, code, signup_id, notes, created_by, amount) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, machine, b.customer, b.phone || null, b.plan, expires, code, b.signup_id || null, b.notes || null, req.user!.id, b.amount ?? 0],
    );
    if (b.signup_id) await o.db.query(`update trial_signups set status = 'activated' where id = $1`, [b.signup_id]);
    return { id, code, machine_id: machine, expires_at: expires };
  });
}
