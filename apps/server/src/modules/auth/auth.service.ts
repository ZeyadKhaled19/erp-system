import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { hashPassword, isCommonPassword, loadAuthUser, strongEnough, verifyPassword, WEAK_PASSWORD_MESSAGE } from '../../auth';
import type { Db } from '../../db';
import { AppError } from '../../errors';
import { ReplyError } from '../../core/http';
import { APP_OPTIONS, type AppOptions, DB, JWT, type Jwt } from '../../core/tokens';
import type { changeSchema, loginSchema } from './auth.schemas';

/**
 * حماية من تخمين كلمات المرور (مهم عند فتح النظام على الإنترنت): 10 محاولات خاطئة لنفس الاسم = إيقاف 15 دقيقة.
 * الحالة في ذاكرة الخادم (زي قبل NestJS): بتتمسح مع إعادة التشغيل، ولكل نسخة على Vercel عدّادها.
 */
@Injectable()
export class LoginThrottle {
  static readonly MAX = 10;
  static readonly WINDOW_MS = 15 * 60 * 1000;
  private failures = new Map<string, { n: number; first: number }>();

  lockedFor(key: string) {
    const f = this.failures.get(key);
    if (!f) return 0;
    const left = f.first + LoginThrottle.WINDOW_MS - Date.now();
    if (left <= 0) {
      this.failures.delete(key);
      return 0;
    }
    return f.n >= LoginThrottle.MAX ? left : 0;
  }
  fail(key: string) {
    const f = this.failures.get(key);
    if (f && Date.now() - f.first < LoginThrottle.WINDOW_MS) f.n++;
    else this.failures.set(key, { n: 1, first: Date.now() });
  }
  clear(key: string) {
    this.failures.delete(key);
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private db: Db,
    @Inject(JWT) private jwt: Jwt,
    @Inject(APP_OPTIONS) private opts: AppOptions,
    @Inject(LoginThrottle) private throttle: LoginThrottle,
  ) {}

  // كلمات السر الضعيفة لازم تتغير قبل الدخول:
  // - موقع صاحب السيستم (مفتوح للناس): أي كلمة معروفة أو أقل من 8 حروف.
  // - برنامج الويندوز (مفتوح لأجهزة شبكة المحل): الكلمات المعروفة بس زي admin123.
  private mustChangePassword(p: string) {
    return this.opts.vendor ? !strongEnough(p) : this.opts.license ? isCommonPassword(p) : false;
  }

  async login(body: z.infer<typeof loginSchema>) {
    const { db } = this;
    const key = body.username.trim().toLowerCase();
    const wait = this.throttle.lockedFor(key);
    if (wait > 0) throw new AppError(`محاولات دخول خاطئة كثيرة لهذا المستخدم. حاول بعد ${Math.ceil(wait / 60000)} دقيقة`, 'auth');
    const u = await db.one(`select * from users where lower(username) = lower($1)`, [body.username.trim()]);
    if (!u || !u.active || !(await verifyPassword(body.password, u.password_hash))) {
      this.throttle.fail(key);
      await db.query(`insert into audit_log (action, entity, details, device_id) values ('login_failed', 'user', $1, $2)`, [JSON.stringify({ username: body.username }), body.device_id]);
      throw new AppError('اسم المستخدم أو كلمة المرور غير صحيحة', 'auth');
    }
    if (this.mustChangePassword(body.password)) {
      if (!body.new_password) {
        throw new ReplyError(428, { code: 'weak_password', error: 'كلمة السر دي معروفة أو ضعيفة (زي admin123)، وأي حد ممكن يخمّنها. اختار كلمة سر جديدة خاصة بيك (8 حروف أو أرقام على الأقل).' });
      }
      if (!strongEnough(body.new_password)) throw new AppError(WEAK_PASSWORD_MESSAGE);
      if (body.new_password === body.password) throw new AppError('كلمة السر الجديدة لازم تختلف عن القديمة');
      await db.query(`update users set password_hash = $2, password_changed_at = now() where id = $1`, [u.id, await hashPassword(body.new_password)]);
      await db.query(`insert into audit_log (user_id, device_id, action, entity, entity_id) values ($1, $2, 'change_password', 'user', $1)`, [u.id, body.device_id]);
      // التوكن الجديد لازم يبقى بعد وقت التغيير (الثانية الجاية)
      await new Promise((r) => setTimeout(r, 1100));
    }
    await db.query(
      `insert into devices (id, name, user_id) values ($1, $2, $3) on conflict (id) do update set name = coalesce(excluded.name, devices.name), user_id = excluded.user_id, last_seen = now()`,
      [body.device_id, body.device_name ?? null, u.id],
    );
    this.throttle.clear(key);
    await db.query(`insert into audit_log (user_id, device_id, action, entity, entity_id) values ($1, $2, 'login', 'user', $1)`, [u.id, body.device_id]);
    const user = (await loadAuthUser(db, u.id))!;
    return { token: await this.jwt.sign(u.id, body.device_id), user };
  }

  async changePassword(userId: string, deviceId: string, b: z.infer<typeof changeSchema>) {
    const u = await this.db.one(`select password_hash from users where id = $1`, [userId]);
    if (!(await verifyPassword(b.current, u.password_hash))) throw new AppError('كلمة المرور الحالية غير صحيحة');
    if ((this.opts.vendor || this.opts.license) && !strongEnough(b.next)) throw new AppError(WEAK_PASSWORD_MESSAGE);
    await this.db.query(`update users set password_hash = $2, password_changed_at = now() where id = $1`, [userId, await hashPassword(b.next)]);
    await this.db.query(`insert into audit_log (user_id, device_id, action, entity, entity_id) values ($1, $2, 'change_password', 'user', $1)`, [userId, deviceId]);
    // كل الجلسات القديمة اتلغت؛ نرجّع توكن جديد للجهاز ده علشان يكمل من غير ما يخرج
    await new Promise((r) => setTimeout(r, 1100));
    return { ok: true, token: await this.jwt.sign(userId, deviceId) };
  }
}
