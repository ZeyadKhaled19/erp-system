import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@erp/shared';
import type { FastifyRequest } from 'fastify';
import { type AuthUser, loadAuthUser } from '../auth';
import type { Db } from '../db';
import { AppError } from '../errors';
import { DB, JWT, type Jwt } from './tokens';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    deviceId?: string;
  }
}

const PUBLIC = 'erp:public';
const PERM = 'erp:perm';

/** No sign-in needed (health, brand, login, license, public vendor pages) */
export const Public = () => SetMetadata(PUBLIC, true);
/** Signed in and holding this permission. Routes with neither decorator only need a valid sign-in. */
export const Perm = (key: string) => SetMetadata(PERM, key);

/**
 * One global guard so no route is open by accident: every route needs a valid session unless it is
 * marked @Public(). Same checks, messages and order as the old preHandlers (auth, then permission).
 * The guard is for HTTP only; the operations themselves (applyOp, posting) still check permissions.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private reflector: Reflector,
    @Inject(DB) private db: Db,
    @Inject(JWT) private jwt: Jwt,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    await authenticate(req, this.db, this.jwt);
    const perm = this.reflector.getAllAndOverride<string | undefined>(PERM, targets);
    if (perm && !hasPermission(req.user!.permissions, perm)) throw new AppError('ليس لديك صلاحية', 'forbidden');
    return true;
  }
}

export async function authenticate(req: FastifyRequest, db: Db, jwt: Jwt) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw new AppError('سجّل الدخول أولًا', 'auth');
  let payload;
  try {
    payload = await jwt.verify(h.slice(7));
  } catch {
    throw new AppError('انتهت الجلسة؛ سجّل الدخول مرة أخرى', 'auth');
  }
  const user = await loadAuthUser(db, payload.userId);
  if (!user) throw new AppError('المستخدم موقوف أو غير موجود', 'auth');
  // كلمة السر اتغيرت بعد الدخول ده: الجلسة القديمة تتلغي
  const pc = await db.one<{ t: any }>(`select extract(epoch from password_changed_at) as t from users where id = $1`, [user.id]);
  if (pc?.t && payload.issuedAt && payload.issuedAt < Math.floor(Number(pc.t))) throw new AppError('كلمة السر اتغيرت؛ سجّل الدخول مرة تانية', 'auth');
  req.user = user;
  req.deviceId = String(req.headers['x-device-id'] ?? payload.deviceId ?? '');
}

/** Warehouse/cashbox assignment of the signed-in employee (null = all) */
export function assertWarehouseScope(user: AuthUser, id: string | null | undefined) {
  if (id && user.warehouse_ids && !user.warehouse_ids.includes(id)) throw new AppError('غير مسموح لك بالعمل على هذا المخزن', 'forbidden');
}
export function assertCashboxScope(user: AuthUser, id: string | null | undefined) {
  if (id && user.cashbox_ids && !user.cashbox_ids.includes(id)) throw new AppError('غير مسموح لك بالعمل على هذه الخزينة', 'forbidden');
}
export const can = (user: AuthUser, key: string) => hasPermission(user.permissions, key);
