import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from './db';
import { AppError } from './errors';
import { expiryFor, licenseStatus, normalizeMachineId, signLicense, validMachineId, verifyLicense, type LicenseInput, type LicenseStatus } from './license';

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

  app.get('/api/license', async () => {
    const s = status();
    return { gated: !!o.gate, vendor: !!o.vendor, canIssue: !!(o.vendor && o.privateKey), license: s };
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
      })
      .parse(req.body);
    const machine = normalizeMachineId(b.machine_id);
    const expires = expiryFor(b.plan, b.days ?? 0);
    const today = new Date().toISOString().slice(0, 10);
    const code = signLicense(o.privateKey, { m: machine, e: expires, n: b.customer, t: today });
    const id = crypto.randomUUID();
    await o.db.query(
      `insert into licenses (id, machine_id, customer, phone, plan, expires_at, code, signup_id, notes, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, machine, b.customer, b.phone || null, b.plan, expires, code, b.signup_id || null, b.notes || null, req.user!.id],
    );
    if (b.signup_id) await o.db.query(`update trial_signups set status = 'activated' where id = $1`, [b.signup_id]);
    return { id, code, machine_id: machine, expires_at: expires };
  });
}
