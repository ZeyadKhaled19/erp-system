import type { AppOptions } from '../app';
import type { makeTokens } from '../auth';

/**
 * Injection tokens. esbuild (used by tsx, the Vercel bundle and the desktop bundle) can't emit
 * decorator metadata, so every constructor parameter is injected by an explicit token: @Inject(DB).
 */
export const DB = Symbol('DB');
export const APP_OPTIONS = Symbol('APP_OPTIONS');
export const JWT = Symbol('JWT');

export type Jwt = ReturnType<typeof makeTokens>;
export type { AppOptions };
