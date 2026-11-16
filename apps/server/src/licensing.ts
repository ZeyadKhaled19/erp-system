import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from './db';
import { hashPassword, strongEnough, WEAK_PASSWORD_MESSAGE } from './auth';
import { AppError } from './errors';
import { EG_GOVERNORATES } from '@erp/shared';
import { DEFAULT_CONTACT, TRIAL_DAYS, expiryFor, signReset, verifyReset, licenseStatus, normalizeMachineId, signLicense, validMachineId, verifyLicense, type LicenseInput, type LicenseStatus, type VendorContact } from './license';

/** القفل في برنامج الويندوز: البرنامج بيدّي الخادم بيانات الجهاز، والخادم بيقرر مفتوح ولا مقفول */
export interface LicenseGate {
  get(): LicenseInput;
  /** اتحط كود صحيح: البرنامج بيحفظه */
  activate(code: string): void;
  /** التجربة اتسجلت أونلاين برقم الموبايل (أو اتعرف تاريخ أقدم): البرنامج بيحفظ */
  register?(trialStart: string, phone: string): void;
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
  /** موقع صاحب السيستم (برنامج الويندوز بيسجل التجربة عليه) */
  vendorUrl?: string;
  perm: (key: string) => (req: FastifyRequest) => Promise<void>;
}

const RELEASES = 'https://github.com/ZeyadKhaled19/erp-releases/releases';
// الطلبات المسموحة والبرنامج مقفول: معرفة الحالة والتفعيل، وشكل صفحة الدخول
const OPEN_WHEN_LOCKED = ['/api/license', '/api/brand', '/api/health'];

/** رقم الموبايل بشكل واحد: 01xxxxxxxxx */
export const normalizePhone = (s: string) => {
  let d = String(s ?? '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[^0-9]/g, '');
  if (d.startsWith('0020')) d = '0' + d.slice(4);
  else if (d.startsWith('20') && d.length === 12) d = '0' + d.slice(2);
  return d;
};
const minIso = (...xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x && !Number.isNaN(Date.parse(x))).sort((a, b) => Date.parse(a) - Date.parse(b))[0];

export function registerLicensing(app: FastifyInstance, o: LicensingOptions) {
  // تاريخ بداية التجربة محفوظ كمان جوه البيانات نفسها (settings.trial_started_at):
  // لو حد نقل نسخة بياناته (نفس اليوزر والباسورد) لجهاز تاني، التجربة ما تبدأش من الأول.
  let dbStart: string | null = null;
  const syncDbStart = async () => {
    if (!o.gate) return;
    try {
      const row = await o.db.one<{ value: any }>(`select value from settings where key = 'trial_started_at'`);
      const v = typeof row?.value === 'string' ? row.value : null;
      const earliest = minIso(v, o.gate.get().trialStart) ?? null;
      if (earliest && earliest !== v) await o.db.query(`insert into settings (key, value) values ('trial_started_at', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(earliest)]);
      dbStart = earliest;
    } catch { /* المرة الجاية */ }
  };
  if (o.gate) {
    void syncDbStart();
    // بعد استرجاع نسخة احتياطية أو تسجيل التجربة، نقرا تاني
    setInterval(() => void syncDbStart(), 5 * 60 * 1000).unref();
  }
  const input = (): LicenseInput | null => {
    if (!o.gate) return null;
    const i = o.gate.get();
    return { ...i, trialStart: minIso(i.trialStart, dbStart) ?? i.trialStart };
  };
  const status = (): LicenseStatus | null => {
    const i = input();
    return i ? licenseStatus(i) : null;
  };

  // ---------------- القفل ----------------
  if (o.gate) {
    app.addHook('onRequest', async (req, reply) => {
      const url = req.url.split('?')[0];
      if (!url.startsWith('/api/') || OPEN_WHEN_LOCKED.some((p) => url === p || url.startsWith(p + '/'))) return;
      const s = status();
      if (s?.status === 'expired' || s?.status === 'unregistered') return reply.status(402).send({ error: s.message, code: 'license' });
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
    const cur = input()!;
    const v = verifyLicense(code, cur.machineId);
    if (!v.ok) throw new AppError(v.error);
    const s = licenseStatus({ ...cur, code: code.replace(/\s+/g, '') });
    if (s.status !== 'active') throw new AppError(s.status === 'expired' ? s.message : 'الكود ده مش شغال');
    o.gate.activate(code.replace(/\s+/g, ''));
    return { license: s };
  });

  // ---------------- تسجيل التجربة أول مرة (من برنامج الويندوز) ----------------
  app.post('/api/license/register', async (req) => {
    if (!o.gate?.register || !o.vendorUrl) throw new AppError('التسجيل بيتعمل من برنامج الويندوز', 'state');
    const b = z
      .object({
        phone: z.string().trim().min(8).max(20),
        business: z.string().trim().min(2, 'اكتب اسم المحل').max(120),
        governorate: z.string().refine((g) => (EG_GOVERNORATES as readonly string[]).includes(g), 'اختار المحافظة'),
        /** كلمة سر المدير الجديدة (بدل admin123) */
        admin_password: z.string({ required_error: 'اختار كلمة السر' }).max(200),
        /** اسم مستخدم المدير (لو عايز يغيره من admin) */
        admin_username: z.string({ required_error: 'اكتب اسم المستخدم' }).trim().min(2, 'اسم المستخدم حرفين على الأقل').max(50).regex(/^[^\s]+$/, 'اسم المستخدم من غير مسافات'),
      })
      .parse(req.body);
    const phone = normalizePhone(b.phone);
    if (!/^01[0125][0-9]{8}$/.test(phone)) throw new AppError('رقم الموبايل مش مظبوط. اكتبه زي 01xxxxxxxxx');
    if (!strongEnough(b.admin_password)) throw new AppError(WEAK_PASSWORD_MESSAGE);
    const cur = input()!;
    let r: Response;
    try {
      r = await fetch(`${o.vendorUrl}/api/public/trial-start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ machine_id: cur.machineId, phone, business: b.business, governorate: b.governorate, local_start: cur.trialStart }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new AppError('مفيش اتصال بالنت. أول مرة بس لازم الجهاز يكون على النت علشان التجربة تبدأ.');
    }
    const j = (await r.json().catch(() => ({}))) as { trial_start?: string; error?: string };
    if (!r.ok || !j.trial_start) throw new AppError(j.error ?? 'التسجيل ما نجحش، جرب تاني بعد شوية');
    const start = minIso(j.trial_start, cur.trialStart) ?? j.trial_start;
    // كلمة سر المدير اللي اختارها العميل (كده مفيش جهاز فيه admin123)
    if (b.admin_username) {
      const taken = await o.db.one(`select 1 from users where lower(username) = lower($1) and id <> 'user-admin'`, [b.admin_username]);
      if (taken) throw new AppError('اسم المستخدم ده مستخدم لحد تاني');
    }
    if (b.admin_password) {
      await o.db.query(`update users set password_hash = $1, password_changed_at = now(), username = coalesce($2, username) where id = 'user-admin'`, [await hashPassword(b.admin_password), b.admin_username || null]);
      await o.db.query(`insert into audit_log (user_id, action, entity, entity_id) values ('user-admin', 'change_password', 'user', 'user-admin')`);
    }
    o.gate.register(start, phone);
    dbStart = minIso(start, dbStart) ?? start;
    await syncDbStart();
    return { license: status() };
  });

  app.post('/api/license/reset', async (req) => {
    if (!o.gate) throw new AppError('كود الاسترجاع بيتحط في برنامج الويندوز', 'state');
    const { code } = z.object({ code: z.string().min(10).max(3000) }).parse(req.body);
    const v = verifyReset(code, input()!.machineId);
    if (!v.ok) throw new AppError(v.error);
    const { u, h } = v.payload;
    const taken = await o.db.one(`select 1 from users where lower(username) = lower($1) and id <> 'user-admin'`, [u]);
    if (taken) throw new AppError(`اسم المستخدم «${u}» مستخدم لموظف تاني. اطلب كود باسم تاني.`);
    const row = await o.db.one(`update users set username = $1, password_hash = $2, password_changed_at = now(), active = true where id = 'user-admin' returning username`, [u, h]);
    if (!row) throw new AppError('حساب المدير مش موجود', 'not_found');
    await o.db.query(`insert into audit_log (user_id, action, entity, entity_id, details) values ('user-admin', 'password_reset_code', 'user', 'user-admin', $1)`, [JSON.stringify({ username: u })]);
    return { ok: true, username: u };
  });

  if (!o.vendor) return;

  // كود استرجاع يوزر وباسورد المدير لجهاز عميل (من لوحة صاحب السيستم)
  app.post('/api/admin/reset-codes', { preHandler: o.perm('settings.manage') }, async (req) => {
    if (!o.privateKey) throw new AppError('مفتاح التوقيع (LICENSE_PRIVATE_KEY) مش متضبط في إعدادات Vercel.', 'state');
    const b = z
      .object({
        machine_id: z.string().refine(validMachineId, 'رقم الجهاز مش مظبوط'),
        username: z.string().trim().min(2, 'اسم المستخدم حرفين على الأقل').max(50).regex(/^[^\s]+$/, 'اسم المستخدم من غير مسافات'),
        password: z.string().max(200),
      })
      .parse(req.body);
    if (!strongEnough(b.password)) throw new AppError(WEAK_PASSWORD_MESSAGE);
    const machine = normalizeMachineId(b.machine_id);
    const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const code = signReset(o.privateKey, { m: machine, u: b.username, h: await hashPassword(b.password), x: expires });
    await o.db.query(`insert into audit_log (user_id, action, entity, entity_id, details) values ($1, 'reset_code_issued', 'installation', $2, $3)`, [req.user!.id, machine, JSON.stringify({ username: b.username })]);
    return { code, machine_id: machine, username: b.username, expires_at: expires };
  });

  // تجربة واحدة لكل رقم: لو الرقم أو الجهاز سجل قبل كده بنرجّع أقدم تاريخ بداية
  const starts = new Map<string, number[]>();
  app.post('/api/public/trial-start', async (req) => {
    const b = z
      .object({
        machine_id: z.string().refine(validMachineId),
        phone: z.string().trim().min(8).max(20),
        business: z.string().trim().max(120).optional().nullable(),
        governorate: z.string().max(40).optional().nullable(),
        local_start: z.string().max(40).optional().nullable(),
      })
      .parse(req.body);
    const phone = normalizePhone(b.phone);
    if (!/^01[0125][0-9]{8}$/.test(phone)) throw new AppError('رقم الموبايل مش مظبوط');
    const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0].trim();
    const now = Date.now();
    const recent = (starts.get(ip) ?? []).filter((t) => now - t < 3600000);
    if (recent.length >= 10) throw new AppError('محاولات كتير. استنى شوية وجرب تاني.');
    starts.set(ip, [...recent, now]);
    const machine = normalizeMachineId(b.machine_id);
    const prevMachine = await o.db.one<{ trial_start: any }>(`select trial_start from trial_devices where machine_id = $1`, [machine]);
    const prevPhone = await o.db.one<{ s: any }>(`select min(trial_start) as s from trial_devices where phone = $1`, [phone]);
    const iso = (v: any) => (v ? new Date(v).toISOString() : null);
    const localStart = b.local_start && !Number.isNaN(Date.parse(b.local_start)) && Date.parse(b.local_start) <= now ? b.local_start : null;
    const start = minIso(iso(prevMachine?.trial_start), iso(prevPhone?.s), localStart, new Date(now).toISOString())!;
    await o.db.query(
      `insert into trial_devices (machine_id, phone, business, governorate, trial_start, ip) values ($1,$2,$3,$4,$5,$6)
       on conflict (machine_id) do update set phone = excluded.phone, business = coalesce(excluded.business, trial_devices.business),
         governorate = coalesce(excluded.governorate, trial_devices.governorate), trial_start = least(trial_devices.trial_start, excluded.trial_start)`,
      [machine, phone, b.business || null, b.governorate || null, start, ip || null],
    );
    // لو الرقم ده مش متسجل في صفحة التسجيل، نضيفه علشان يظهر عند صاحب السيستم
    const known = await o.db.one(`select 1 from trial_signups where phone = $1`, [phone]);
    if (!known) {
      await o.db.query(`insert into trial_signups (id, name, phone, business, governorate, notes, ip) values ($1,$2,$3,$4,$5,$6,$7)`, [
        crypto.randomUUID(), b.business || 'من البرنامج', phone, b.business || 'من البرنامج', b.governorate || null, 'اتسجل من برنامج الويندوز مباشرة', ip || null,
      ]);
    }
    const reused = !!(prevMachine || prevPhone?.s);
    return { trial_start: start, trial_days: TRIAL_DAYS, reused, contact: await vendorContact() };
  });

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
        governorate: z.string().refine((g) => (EG_GOVERNORATES as readonly string[]).includes(g), 'اختار المحافظة'),
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
    await o.db.query(`insert into trial_signups (id, name, phone, business, activity, governorate, city, ip) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [
      id, b.name, normalizePhone(b.phone) || b.phone.replace(/\s+/g, ''), b.business, b.activity || null, b.governorate, b.city || null, ip || null,
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
      `select i.*, l.customer, coalesce(l.phone, td.phone) as phone, td.governorate from installations i
       left join lateral (select customer, phone from licenses where machine_id = i.machine_id order by created_at desc limit 1) l on true
       left join trial_devices td on td.machine_id = i.machine_id
       order by i.last_seen desc limit 300`,
    );
    // التسجيلات والتفعيلات أسبوع بأسبوع (آخر 12 أسبوع)
    const weekly = await o.db.query(
      `select to_char(w, 'YYYY-MM-DD') as week,
         (select count(*) from trial_signups where created_at >= w and created_at < w + interval '7 days')::int as signups,
         (select count(*) from licenses where created_at >= w and created_at < w + interval '7 days')::int as activations
       from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as w order by w`,
    );
    const byGovernorate = await o.db.query(
      `select governorate, count(*)::int as n, count(*) filter (where status = 'activated')::int as activated from trial_signups where governorate is not null group by governorate order by n desc`,
    );
    return { byGovernorate, signups, licenses, revenue, devices, newSignups, endingTrials, expiringLicenses, installations, weekly, contact: await vendorContact() };
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
