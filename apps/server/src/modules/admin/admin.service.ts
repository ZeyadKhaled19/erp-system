import { Inject, Injectable } from '@nestjs/common';
import { ALL_PERMISSIONS, hasPermission } from '@erp/shared';
import type { z } from 'zod';
import { type AuthUser, hashPassword } from '../../auth';
import type { Db } from '../../db';
import { AppError } from '../../errors';
import { DB } from '../../core/tokens';
import { SETTINGS_KEYS, type roleHomeSchema, type roleSchema, type userSchema } from './admin.schemas';

/** نفس قفل الكتابة العام بتاع المزامنة (applyOp)، علشان row_version يفضل بالترتيب */
const WRITE_LOCK = 7331;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** المستخدمون والأدوار والإعدادات وسجل التدقيق */
@Injectable()
export class AdminService {
  constructor(@Inject(DB) private db: Db) {}

  /** هوية الشركة لصفحة الدخول (قبل تسجيل الدخول): الاسم واسم النظام واللوجو بس */
  async brand() {
    const rows = await this.db.query<{ key: string; value: any }>(`select key, value from settings where key in ('company_name', 'system_name', 'print_logo')`);
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { company_name: typeof v.company_name === 'string' ? v.company_name : '', system_name: typeof v.system_name === 'string' ? v.system_name : '', logo: typeof v.print_logo === 'string' ? v.print_logo : null };
  }

  async audit(f: { user_id?: string; device_id?: string }) {
    const params: unknown[] = [];
    const conds = ['true'];
    if (f.user_id) {
      params.push(f.user_id);
      conds.push(`a.user_id = $${params.length}`);
    }
    if (f.device_id) {
      params.push(f.device_id);
      conds.push(`a.device_id = $${params.length}`);
    }
    return {
      rows: await this.db.query(
        `select a.*, u.full_name as user_name, d.name as device_name from audit_log a left join users u on u.id = a.user_id left join devices d on d.id = a.device_id
          where ${conds.join(' and ')} order by a.id desc limit 500`,
        params,
      ),
    };
  }

  async devices() {
    return { rows: await this.db.query(`select d.*, u.full_name as user_name from devices d left join users u on u.id = d.user_id order by last_seen desc`) };
  }

  async saveUser(actor: AuthUser, deviceId: string | undefined, b: z.infer<typeof userSchema>) {
    // الصلاحيات المعروفة بس؛ والممنوع ما يتكررش مع المضاف
    const known = new Set(ALL_PERMISSIONS);
    const extra = [...new Set((b.extra_permissions ?? []).filter((p) => known.has(p)))];
    const denied = [...new Set((b.denied_permissions ?? []).filter((p) => known.has(p) && !extra.includes(p)))];
    if (b.id === actor.id && !b.active) throw new AppError('لا يمكنك إيقاف حسابك الحالي');
    return this.db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(${WRITE_LOCK})`);
      if (!(await t.one(`select 1 from roles where id = $1`, [b.role_id]))) throw new AppError('الدور غير موجود');
      const scope = (v: string[] | null | undefined) => (v ? JSON.stringify(v) : null);
      let id = b.id;
      if (id) {
        await t.query(`update users set username = $2, full_name = $3, role_id = $4, active = $5, warehouse_ids = $6, cashbox_ids = $7, extra_permissions = $8, denied_permissions = $9 where id = $1`, [
          id, b.username, b.full_name, b.role_id, b.active, scope(b.warehouse_ids), scope(b.cashbox_ids), JSON.stringify(extra), JSON.stringify(denied),
        ]);
        if (b.password) await t.query(`update users set password_hash = $2, password_changed_at = now() where id = $1`, [id, await hashPassword(b.password)]);
      } else {
        if (!b.password) throw new AppError('كلمة المرور مطلوب للمستخدم الجديد');
        id = crypto.randomUUID();
        await t.query(`insert into users (id, username, full_name, password_hash, role_id, active, warehouse_ids, cashbox_ids, extra_permissions, denied_permissions) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
          id, b.username, b.full_name, await hashPassword(b.password), b.role_id, b.active, scope(b.warehouse_ids), scope(b.cashbox_ids), JSON.stringify(extra), JSON.stringify(denied),
        ]);
      }
      await t.query(`insert into audit_log (user_id, device_id, action, entity, entity_id, details) values ($1,$2,'user.save','user',$3,$4)`, [
        actor.id, deviceId, id, JSON.stringify({ username: b.username, role_id: b.role_id, active: b.active, password_changed: !!b.password, extra_permissions: extra, denied_permissions: denied }),
      ]);
      return { id };
    });
  }

  /** صفحة البداية الافتراضية لكل دور (تُحفظ في الإعدادات وتصل للأجهزة بالمزامنة) */
  async setRoleHome(actor: AuthUser, deviceId: string | undefined, b: z.infer<typeof roleHomeSchema>) {
    return this.db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(${WRITE_LOCK})`);
      if (!(await t.one(`select id from roles where id = $1`, [b.role_id]))) throw new AppError('الدور غير موجود');
      const cur = (await t.one(`select value from settings where key = 'role_home_pages'`))?.value;
      const map: Record<string, string> = { ...(typeof cur === 'string' ? JSON.parse(cur) : cur ?? {}) };
      if (b.workspace) map[b.role_id] = b.workspace;
      else delete map[b.role_id];
      await t.query(`insert into settings (key, value) values ('role_home_pages', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(map)]);
      await t.query(`insert into audit_log (user_id, device_id, action, entity, entity_id, details) values ($1,$2,'role.home','role',$3,$4)`, [actor.id, deviceId, b.role_id, JSON.stringify(b)]);
      return { ok: true, role_home_pages: map };
    });
  }

  async saveRole(actor: AuthUser, deviceId: string | undefined, b: z.infer<typeof roleSchema>) {
    return this.db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(${WRITE_LOCK})`);
      if (b.id === 'role-admin') throw new AppError('لا يمكن تعديل دور مدير النظام');
      const id = b.id ?? crypto.randomUUID();
      await t.query(
        `insert into roles (id, name, permissions, limits) values ($1,$2,$3,$4) on conflict (id) do update set name = excluded.name, permissions = excluded.permissions, limits = excluded.limits`,
        [id, b.name, JSON.stringify(b.permissions), JSON.stringify(b.limits)],
      );
      await t.query(`insert into audit_log (user_id, device_id, action, entity, entity_id, details) values ($1,$2,'role.save','role',$3,$4)`, [actor.id, deviceId, id, JSON.stringify(b)]);
      return { id };
    });
  }

  async saveSettings(actor: AuthUser, deviceId: string | undefined, b: Record<string, any>) {
    return this.db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(${WRITE_LOCK})`);
      for (const [k, v] of Object.entries(b)) {
        this.checkSetting(actor, k, v);
        await t.query(`insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`, [k, JSON.stringify(v)]);
      }
      await t.query(`insert into audit_log (user_id, device_id, action, entity, details) values ($1,$2,'settings.save','settings',$3)`, [actor.id, deviceId, JSON.stringify(b)]);
      return { ok: true };
    });
  }

  private checkSetting(actor: AuthUser, k: string, v: any) {
    if (!SETTINGS_KEYS.includes(k)) throw new AppError(`إعداد غير معروف: ${k}`);
    if (k === 'print_logo' && v !== null && (typeof v !== 'string' || !v.startsWith('data:image/') || v.length > 300_000)) throw new AppError('الشعار يجب أن يكون صورة أصغر من 200 كيلوبايت');
    if (k === 'system_name' && (typeof v !== 'string' || v.length > 60)) throw new AppError('اسم النظام لازم يكون نص أقصاه 60 حرف');
    if (k === 'work_start_time' && (typeof v !== 'string' || !HHMM.test(v))) throw new AppError('ميعاد بداية الشغل غير صالح');
    if (k === 'work_end_time' && (typeof v !== 'string' || !HHMM.test(v))) throw new AppError('ميعاد الانصراف غير صالح');
    if (k === 'monthly_leave_days' && (!Number.isInteger(v) || v < 0 || v > 31)) throw new AppError('عدد أيام الأجازة الشهرية يجب أن يكون بين 0 و31');
    if (k === 'late_grace_minutes' && (!Number.isInteger(v) || v < 0 || v > 240)) throw new AppError('فترة السماح يجب أن تكون بين 0 و240 دقيقة');
    if (k === 'weekly_off_days' && (!Array.isArray(v) || v.length > 6 || v.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(v).size !== v.length)) throw new AppError('أيام الأجازة الأسبوعية غير صالحة');
    if (k === 'locked_until') {
      if (!hasPermission(actor.permissions, 'period.lock')) throw new AppError('قفل الفترات يحتاج صلاحية خاصة', 'forbidden');
      if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new AppError('تاريخ القفل غير صالح');
    }
  }
}
