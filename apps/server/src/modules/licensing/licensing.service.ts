import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { hashPassword, strongEnough, WEAK_PASSWORD_MESSAGE } from '../../auth';
import type { Db } from '../../db';
import { AppError } from '../../errors';
import { DEFAULT_CONTACT, TRIAL_DAYS, expiryFor, extractCode, licenseStatus, signLicense, signReset, normalizeMachineId, verifyLicense, verifyReset, type LicenseInput, type LicenseStatus, type VendorContact } from '../../license';
import { minIso, normalizePhone } from '../../licensing';
import { APP_OPTIONS, type AppOptions, DB } from '../../core/tokens';
import { licenseSchemas, type LicenseSchemas as S } from './licensing.schemas';

const RELEASES = 'https://github.com/ZeyadKhaled19/erp-releases/releases';
// الطلبات المسموحة والبرنامج مقفول: معرفة الحالة والتفعيل، وشكل صفحة الدخول
const OPEN_WHEN_LOCKED = ['/api/license', '/api/brand', '/api/health'];
const ipOf = (req: FastifyRequest) => String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0].trim();

/**
 * التراخيص في مكانين:
 * - برنامج الويندوز (opts.license موجود): تجربة 7 أيام وقفل لحد كود التفعيل. القفل على الخادم نفسه علشان يشمل أجهزة الشبكة.
 * - موقع صاحب السيستم (opts.vendor): صفحة «جرّب مجانًا»، تسجيل التجربة لكل رقم، إصدار الأكواد، ولوحة صاحب السيستم.
 * الحالة اللي في الذاكرة (عدادات الإزعاج ولينك التحميل) زي ما كانت قبل NestJS: لكل نسخة خادم لوحدها.
 */
@Injectable()
export class LicensingService implements OnModuleDestroy {
  // تاريخ بداية التجربة محفوظ كمان جوه البيانات نفسها (settings.trial_started_at):
  // لو حد نقل نسخة بياناته (نفس اليوزر والباسورد) لجهاز تاني، التجربة ما تبدأش من الأول.
  private dbStart: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** تجربة واحدة لكل رقم: حماية من الإزعاج لكل عنوان */
  private starts = new Map<string, number[]>();
  private hits = new Map<string, number[]>();
  private pings = new Map<string, number>();
  private cachedUrl: { url: string; at: number } | null = null;

  constructor(@Inject(DB) private db: Db, @Inject(APP_OPTIONS) private opts: AppOptions) {
    if (opts.license) {
      void this.syncDbStart();
      // بعد استرجاع نسخة احتياطية أو تسجيل التجربة، نقرا تاني
      this.timer = setInterval(() => void this.syncDbStart(), 5 * 60 * 1000);
      this.timer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private get gate() {
    return this.opts.license;
  }

  private async syncDbStart() {
    if (!this.gate) return;
    try {
      const row = await this.db.one<{ value: any }>(`select value from settings where key = 'trial_started_at'`);
      const v = typeof row?.value === 'string' ? row.value : null;
      const earliest = minIso(v, this.gate.get().trialStart) ?? null;
      if (earliest && earliest !== v) await this.db.query(`insert into settings (key, value) values ('trial_started_at', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(earliest)]);
      this.dbStart = earliest;
    } catch { /* المرة الجاية */ }
  }

  private input(): LicenseInput | null {
    if (!this.gate) return null;
    const i = this.gate.get();
    return { ...i, trialStart: minIso(i.trialStart, this.dbStart) ?? i.trialStart };
  }

  status(): LicenseStatus | null {
    const i = this.input();
    return i ? licenseStatus(i) : null;
  }

  /** القفل: قبل أي توجيه أو تسجيل دخول، كل طلبات /api ما عدا الحالة والتفعيل وشكل صفحة الدخول بترجع 402 */
  readonly lockHook = async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/') || OPEN_WHEN_LOCKED.some((p) => url === p || url.startsWith(p + '/'))) return;
    const s = this.status();
    if (s?.status === 'expired' || s?.status === 'unregistered') return reply.status(402).send({ error: s.message, code: 'license' });
  };

  // بيانات التواصل: على موقع صاحب السيستم من الإعدادات، وفي برنامج الويندوز آخر نسخة جت من الموقع
  async vendorContact(): Promise<VendorContact> {
    const row = await this.db.one<{ value: any }>(`select value from settings where key = 'vendor_contact'`);
    const v = typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value;
    return { ...DEFAULT_CONTACT, ...(v && typeof v === 'object' ? v : {}) };
  }
  private async contact(): Promise<VendorContact> {
    return this.opts.vendor ? this.vendorContact() : { ...DEFAULT_CONTACT, ...(this.gate?.get().contact ?? {}) };
  }

  async info() {
    return { gated: !!this.gate, vendor: !!this.opts.vendor, canIssue: !!(this.opts.vendor && this.opts.licensePrivateKey), license: this.status(), contact: await this.contact() };
  }

  activate(raw: unknown) {
    if (!this.gate) throw new AppError('التفعيل بيتعمل من برنامج الويندوز', 'state');
    const { code } = licenseSchemas.activate.parse(raw);
    const cur = this.input()!;
    const v = verifyLicense(code, cur.machineId);
    if (!v.ok) throw new AppError(v.error);
    const clean = extractCode(code, 'ECO1-');
    const s = licenseStatus({ ...cur, code: clean });
    if (s.status !== 'active') throw new AppError(s.status === 'expired' ? s.message : 'الكود ده مش شغال');
    this.gate.activate(clean);
    return { license: s };
  }

  /** تسجيل التجربة أول مرة (من برنامج الويندوز): بيكلم موقع صاحب السيستم، وبيغيّر كلمة سر المدير من admin123 */
  async register(raw: unknown) {
    if (!this.gate?.register || !this.opts.vendorUrl) throw new AppError('التسجيل بيتعمل من برنامج الويندوز', 'state');
    const b = licenseSchemas.register.parse(raw);
    const phone = normalizePhone(b.phone);
    if (!/^01[0125][0-9]{8}$/.test(phone)) throw new AppError('رقم الموبايل مش مظبوط. اكتبه زي 01xxxxxxxxx');
    if (!strongEnough(b.admin_password)) throw new AppError(WEAK_PASSWORD_MESSAGE);
    const cur = this.input()!;
    let r: Response;
    try {
      r = await fetch(`${this.opts.vendorUrl}/api/public/trial-start`, {
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
    if (b.admin_username) {
      const taken = await this.db.one(`select 1 from users where lower(username) = lower($1) and id <> 'user-admin'`, [b.admin_username]);
      if (taken) throw new AppError('اسم المستخدم ده مستخدم لحد تاني');
    }
    if (b.admin_password) {
      await this.db.query(`update users set password_hash = $1, password_changed_at = now(), username = coalesce($2, username) where id = 'user-admin'`, [await hashPassword(b.admin_password), b.admin_username || null]);
      await this.db.query(`insert into audit_log (user_id, action, entity, entity_id) values ('user-admin', 'change_password', 'user', 'user-admin')`);
    }
    this.gate.register(start, phone);
    this.dbStart = minIso(start, this.dbStart) ?? start;
    await this.syncDbStart();
    return { license: this.status() };
  }

  /** كود الاسترجاع (يوزر وباسورد المدير الجداد) اللي صاحب السيستم طلّعه للجهاز ده */
  async applyReset(raw: unknown) {
    if (!this.gate) throw new AppError('كود الاسترجاع بيتحط في برنامج الويندوز', 'state');
    const { code } = licenseSchemas.reset.parse(raw);
    const v = verifyReset(code, this.input()!.machineId);
    if (!v.ok) throw new AppError(v.error);
    const { u, h } = v.payload;
    const taken = await this.db.one(`select 1 from users where lower(username) = lower($1) and id <> 'user-admin'`, [u]);
    if (taken) throw new AppError(`اسم المستخدم «${u}» مستخدم لموظف تاني. اطلب كود باسم تاني.`);
    const row = await this.db.one(`update users set username = $1, password_hash = $2, password_changed_at = now(), active = true where id = 'user-admin' returning username`, [u, h]);
    if (!row) throw new AppError('حساب المدير مش موجود', 'not_found');
    await this.db.query(`insert into audit_log (user_id, action, entity, entity_id, details) values ('user-admin', 'password_reset_code', 'user', 'user-admin', $1)`, [JSON.stringify({ username: u })]);
    return { ok: true, username: u };
  }

  // ======================= موقع صاحب السيستم بس =======================

  private requireKey(message: string) {
    if (!this.opts.licensePrivateKey) throw new AppError(message, 'state');
    return this.opts.licensePrivateKey;
  }

  async issueResetCode(actorId: string, raw: unknown) {
    const key = this.requireKey('مفتاح التوقيع (LICENSE_PRIVATE_KEY) مش متضبط في إعدادات Vercel.');
    const b = licenseSchemas.resetCode.parse(raw);
    if (!strongEnough(b.password)) throw new AppError(WEAK_PASSWORD_MESSAGE);
    const machine = normalizeMachineId(b.machine_id);
    const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const code = signReset(key, { m: machine, u: b.username, h: await hashPassword(b.password), x: expires });
    await this.db.query(`insert into audit_log (user_id, action, entity, entity_id, details) values ($1, 'reset_code_issued', 'installation', $2, $3)`, [actorId, machine, JSON.stringify({ username: b.username })]);
    return { code, machine_id: machine, username: b.username, expires_at: expires };
  }

  /** تجربة واحدة لكل رقم: لو الرقم أو الجهاز سجل قبل كده بنرجّع أقدم تاريخ بداية */
  async trialStart(req: FastifyRequest, b: S['trialStart']) {
    const phone = normalizePhone(b.phone);
    if (!/^01[0125][0-9]{8}$/.test(phone)) throw new AppError('رقم الموبايل مش مظبوط');
    const ip = ipOf(req);
    const now = Date.now();
    const recent = (this.starts.get(ip) ?? []).filter((t) => now - t < 3600000);
    if (recent.length >= 10) throw new AppError('محاولات كتير. استنى شوية وجرب تاني.');
    this.starts.set(ip, [...recent, now]);
    const machine = normalizeMachineId(b.machine_id);
    const prevMachine = await this.db.one<{ trial_start: any }>(`select trial_start from trial_devices where machine_id = $1`, [machine]);
    const prevPhone = await this.db.one<{ s: any }>(`select min(trial_start) as s from trial_devices where phone = $1`, [phone]);
    const iso = (v: any) => (v ? new Date(v).toISOString() : null);
    const localStart = b.local_start && !Number.isNaN(Date.parse(b.local_start)) && Date.parse(b.local_start) <= now ? b.local_start : null;
    const start = minIso(iso(prevMachine?.trial_start), iso(prevPhone?.s), localStart, new Date(now).toISOString())!;
    await this.db.query(
      `insert into trial_devices (machine_id, phone, business, governorate, trial_start, ip) values ($1,$2,$3,$4,$5,$6)
       on conflict (machine_id) do update set phone = excluded.phone, business = coalesce(excluded.business, trial_devices.business),
         governorate = coalesce(excluded.governorate, trial_devices.governorate), trial_start = least(trial_devices.trial_start, excluded.trial_start)`,
      [machine, phone, b.business || null, b.governorate || null, start, ip || null],
    );
    // لو الرقم ده مش متسجل في صفحة التسجيل، نضيفه علشان يظهر عند صاحب السيستم
    const known = await this.db.one(`select 1 from trial_signups where phone = $1`, [phone]);
    if (!known) {
      await this.db.query(`insert into trial_signups (id, name, phone, business, governorate, notes, ip) values ($1,$2,$3,$4,$5,$6,$7)`, [
        crypto.randomUUID(), b.business || 'من البرنامج', phone, b.business || 'من البرنامج', b.governorate || null, 'اتسجل من برنامج الويندوز مباشرة', ip || null,
      ]);
    }
    const reused = !!(prevMachine || prevPhone?.s);
    return { trial_start: start, trial_days: TRIAL_DAYS, reused, contact: await this.vendorContact() };
  }

  async downloadUrl() {
    if (this.opts.downloadUrl) return this.opts.downloadUrl;
    if (this.cachedUrl && Date.now() - this.cachedUrl.at < 10 * 60 * 1000) return this.cachedUrl.url;
    try {
      const yml = await (await fetch(`${RELEASES}/latest/download/latest.yml`, { signal: AbortSignal.timeout(8000) })).text();
      const file = /^path:\s*(.+)$/m.exec(yml)?.[1]?.trim();
      if (file) {
        const url = `${RELEASES}/latest/download/${encodeURIComponent(file)}`;
        this.cachedUrl = { url, at: Date.now() };
        return url;
      }
    } catch { /* نرجع لصفحة آخر نسخة، ونجرب تاني المرة الجاية */ }
    return `${RELEASES}/latest`;
  }

  /** التسجيل في التجربة من الموقع (من غير دخول): 5 تسجيلات بالكتير من نفس العنوان في الساعة */
  async trialSignup(req: FastifyRequest, b: S['signup']) {
    const ip = ipOf(req);
    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < 3600000);
    if (recent.length >= 5) throw new AppError('سجلت كذا مرة. استنى شوية وجرب تاني، أو كلمنا على طول.');
    this.hits.set(ip, [...recent, now]);
    const id = crypto.randomUUID();
    await this.db.query(`insert into trial_signups (id, name, phone, business, activity, governorate, city, ip) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [
      id, b.name, normalizePhone(b.phone) || b.phone.replace(/\s+/g, ''), b.business, b.activity || null, b.governorate, b.city || null, ip || null,
    ]);
    return { ok: true, download_url: await this.downloadUrl() };
  }

  /** إشارة من برنامج الويندوز: رقم الجهاز واسم المحل والنسخة وحالة الترخيص بس (جهاز واحد مرة كل دقيقة بالكتير) */
  async ping(req: FastifyRequest, b: S['ping']) {
    const machine = normalizeMachineId(b.machine_id);
    if (Date.now() - (this.pings.get(machine) ?? 0) > 60000) {
      this.pings.set(machine, Date.now());
      await this.db.query(
        `insert into installations (machine_id, company_name, version, status, days_left, expires_at, legacy, ip) values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (machine_id) do update set company_name = coalesce(excluded.company_name, installations.company_name), version = excluded.version,
           status = excluded.status, days_left = excluded.days_left, expires_at = excluded.expires_at, legacy = excluded.legacy, ip = excluded.ip,
           last_seen = now(), pings = installations.pings + 1`,
        [machine, b.company_name || null, b.version || null, b.status || null, b.days_left ?? null, b.expires_at || null, !!b.legacy, ipOf(req) || null],
      );
    }
    return { contact: await this.vendorContact() };
  }

  async setVendorContact(b: S['contact']) {
    await this.db.query(`insert into settings (key, value) values ('vendor_contact', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(b)]);
    return { contact: await this.vendorContact() };
  }

  async ownerDashboard() {
    const one = async (sql: string) => Number((await this.db.one<{ n: any }>(sql))?.n ?? 0);
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
    const newSignups = await this.db.query(`select id, name, phone, business, created_at from trial_signups where status = 'new' order by created_at desc limit 30`);
    const endingTrials = await this.db.query(`select machine_id, company_name, days_left, last_seen from installations where status = 'trial' and days_left <= 2 order by days_left, last_seen desc limit 30`);
    const expiringLicenses = await this.db.query(
      `select distinct on (machine_id) machine_id, customer, phone, expires_at from licenses where expires_at between current_date and current_date + 30 order by machine_id, expires_at desc limit 30`,
    );
    const installations = await this.db.query(
      `select i.*, l.customer, coalesce(l.phone, td.phone) as phone, td.governorate from installations i
       left join lateral (select customer, phone from licenses where machine_id = i.machine_id order by created_at desc limit 1) l on true
       left join trial_devices td on td.machine_id = i.machine_id
       order by i.last_seen desc limit 300`,
    );
    // التسجيلات والتفعيلات أسبوع بأسبوع (آخر 12 أسبوع)
    const weekly = await this.db.query(
      `select to_char(w, 'YYYY-MM-DD') as week,
         (select count(*) from trial_signups where created_at >= w and created_at < w + interval '7 days')::int as signups,
         (select count(*) from licenses where created_at >= w and created_at < w + interval '7 days')::int as activations
       from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as w order by w`,
    );
    const byGovernorate = await this.db.query(
      `select governorate, count(*)::int as n, count(*) filter (where status = 'activated')::int as activated from trial_signups where governorate is not null group by governorate order by n desc`,
    );
    return { byGovernorate, signups, licenses, revenue, devices, newSignups, endingTrials, expiringLicenses, installations, weekly, contact: await this.vendorContact() };
  }

  async licensingPage() {
    const signups = await this.db.query(`select * from trial_signups order by created_at desc limit 500`);
    const licenses = await this.db.query(`select l.*, u.full_name as created_by_name from licenses l left join users u on u.id = l.created_by order by l.created_at desc limit 500`);
    return { canIssue: !!this.opts.licensePrivateKey, signups, licenses };
  }

  async updateSignup(id: string, b: S['signupUpdate']) {
    const row = await this.db.one(`update trial_signups set status = coalesce($2, status), notes = case when $3::boolean then $4 else notes end where id = $1 returning *`, [id, b.status ?? null, b.notes !== undefined, b.notes ?? null]);
    if (!row) throw new AppError('مش موجود', 'not_found');
    return row;
  }

  async issueLicense(actorId: string, raw: unknown) {
    const key = this.requireKey('مفتاح التوقيع (LICENSE_PRIVATE_KEY) مش متضبط في إعدادات Vercel، فمش هينفع يطلع أكواد.');
    const b = licenseSchemas.license.parse(raw);
    const machine = normalizeMachineId(b.machine_id);
    const expires = expiryFor(b.plan, b.days ?? 0);
    const today = new Date().toISOString().slice(0, 10);
    const code = signLicense(key, { m: machine, e: expires, n: b.customer, t: today });
    const id = crypto.randomUUID();
    await this.db.query(
      `insert into licenses (id, machine_id, customer, phone, plan, expires_at, code, signup_id, notes, created_by, amount) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, machine, b.customer, b.phone || null, b.plan, expires, code, b.signup_id || null, b.notes || null, actorId, b.amount ?? 0],
    );
    if (b.signup_id) await this.db.query(`update trial_signups set status = 'activated' where id = $1`, [b.signup_id]);
    return { id, code, machine_id: machine, expires_at: expires };
  }
}
