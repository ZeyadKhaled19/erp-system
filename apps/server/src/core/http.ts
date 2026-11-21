import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, NotFoundException, StandardSchemaValidationPipe } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors';

/**
 * A reply with a specific status and body that isn't an AppError (e.g. 428 weak_password).
 * Thrown from a handler and written as-is by the filter, so @HttpCode can't override it.
 */
export class ReplyError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body.error ?? ''));
  }
}

const APP_STATUS: Record<AppError['code'], number> = { validation: 400, forbidden: 403, not_found: 404, state: 409, auth: 401 };

/** Same error contract as the pre-NestJS Fastify error handler: { error, code? } with the same statuses. */
export function writeError(err: any, reply: FastifyReply, log?: (e: unknown) => void) {
  if (err instanceof ReplyError) return reply.status(err.status).send(err.body);
  if (err instanceof AppError) return reply.status(APP_STATUS[err.code]).send({ error: err.message, code: err.code });
  if (err?.name === 'ZodError') return reply.status(400).send({ error: err.issues.map((i: any) => i.message).join('، ') });
  if (err?.validation) return reply.status(400).send({ error: 'طلب غير صالح' });
  log?.(err);
  return reply.status(500).send({ error: 'خطأ في الخادم' });
}

/** Unknown routes: the PWA's index.html for app paths, 404 for API calls, assets and files. */
export function writeNotFound(req: FastifyRequest, reply: FastifyReply, serveWeb: boolean) {
  const url = req.url;
  if (!serveWeb || url.startsWith('/api/') || url.startsWith('/assets/') || /\.[a-z0-9]{2,5}(\?|$)/i.test(url)) {
    return reply.status(404).send({ error: 'غير موجود' });
  }
  reply.header('cache-control', 'no-cache');
  return reply.sendFile('index.html');
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private serveWeb: boolean, private log: (e: unknown) => void) {}

  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    // Nest throws NotFoundException only for unmatched routes (our code uses AppError 'not_found')
    if (err instanceof NotFoundException) return writeNotFound(ctx.getRequest<FastifyRequest>(), reply, this.serveWeb);
    if (err instanceof HttpException) {
      // A Fastify error before the handler (bad JSON, body too large) arrives wrapped by Nest's
      // adapter: answer it exactly like the old Fastify error handler did
      const cause = (err as { cause?: unknown }).cause;
      if (cause) return writeError(cause, reply, this.log);
      // Nest's own HTTP exceptions (none are thrown by our code) keep their status with our body shape
      return reply.status(err.getStatus()).send({ error: err.message });
    }
    return writeError(err, reply, this.log);
  }
}

/**
 * Runtime validation for @Body/@Query/@Param({ schema }) with the shared zod schemas.
 * Failures become the same 400 { error: 'msg، msg' } the handlers produced before.
 */
export const schemaPipe = () =>
  new StandardSchemaValidationPipe({ exceptionFactory: (issues) => Object.assign(new Error('validation'), { name: 'ZodError', issues: [...issues] }) });
