import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { jwtVerify, SignJWT } from 'jose';
import type { Db } from './db';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

/** تخزين كلمة المرور كـ scrypt مع ملح عشوائي — لا تُخزّن أبدًا كنص صريح */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT_OPTS);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT_OPTS);
  return timingSafeEqual(key, expected);
}

export interface AuthUser {
  id: string;
  username: string;
  full_name: string;
  role_id: string;
  role_name: string;
  permissions: string[];
  limits: { max_discount_bp?: number; max_discount_amount?: number };
  /** null = كل المخازن/الخزائن */
  warehouse_ids: string[] | null;
  cashbox_ids: string[] | null;
}

export function makeTokens(secret: string) {
  const key = new TextEncoder().encode(secret);
  return {
    /** رمز طويل نسبيًا (30 يومًا) ليتمكن الجهاز من العمل دون اتصال؛ الخادم يتحقق من أن المستخدم ما زال نشطًا مع كل طلب */
    async sign(userId: string, deviceId: string) {
      return new SignJWT({ dev: deviceId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime('30d')
        .sign(key);
    },
    async verify(token: string) {
      const { payload } = await jwtVerify(token, key);
      return { userId: String(payload.sub), deviceId: String(payload.dev ?? '') };
    },
  };
}

export async function loadAuthUser(db: Db, userId: string): Promise<AuthUser | undefined> {
  const u = await db.one(
    `select u.id, u.username, u.full_name, u.role_id, u.active, u.warehouse_ids, u.cashbox_ids, r.name as role_name, r.permissions, r.limits
       from users u join roles r on r.id = u.role_id where u.id = $1`,
    [userId],
  );
  if (!u || !u.active) return undefined;
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role_id: u.role_id,
    role_name: u.role_name,
    permissions: u.permissions ?? [],
    limits: u.limits ?? {},
    // مدير النظام (كل الصلاحيات) يعمل دائمًا على كل المخازن والخزائن
    warehouse_ids: (u.permissions ?? []).includes('*') ? null : (u.warehouse_ids ?? null),
    cashbox_ids: (u.permissions ?? []).includes('*') ? null : (u.cashbox_ids ?? null),
  };
}
