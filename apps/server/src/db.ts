import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

/**
 * طبقة قاعدة البيانات: واجهة واحدة تعمل مع
 * - PGlite (PostgreSQL مدمج، للتشغيل المحلي والاختبارات دون أي تثبيت)
 * - PostgreSQL حقيقي عبر DATABASE_URL (للإنتاج)
 * كل الأعداد الصحيحة الكبيرة (bigint) تعود كـ number، والتواريخ (date) كنص YYYY-MM-DD.
 */
export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
  exec(sql: string): Promise<void>;
  /** معاملة واحدة: إما تُحفظ كل التغييرات أو لا شيء */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'pglite' | 'postgres';
}

const INT8 = 20;
const DATE = 1082;

function normalizeRow(row: any) {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (typeof v === 'bigint') row[k] = Number(v);
  }
  return row;
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

function makeDb(
  q: Queryable,
  execFn: (sql: string) => Promise<void>,
  txFn: <T>(fn: (db: Db) => Promise<T>) => Promise<T>,
  closeFn: () => Promise<void>,
  kind: Db['kind'],
): Db {
  const db: Db = {
    kind,
    async query(sql, params) {
      const r = await q.query(sql, params as any[]);
      return r.rows.map(normalizeRow);
    },
    async one(sql, params) {
      const rows = await db.query(sql, params);
      return rows[0];
    },
    exec: execFn,
    tx: txFn,
    close: closeFn,
  };
  return db;
}

export async function openPglite(dataDir?: string): Promise<Db> {
  const parsers = { [INT8]: (v: string) => Number(v), [DATE]: (v: string) => v };
  const pgl = dataDir ? new PGlite(dataDir, { parsers }) : new PGlite({ parsers });
  await pgl.waitReady;
  let chain: Promise<unknown> = Promise.resolve();
  let inTx = false;

  const root: Db = makeDb(
    pgl as unknown as Queryable,
    async (sql) => {
      await pgl.exec(sql);
    },
    async (fn) => {
      if (inTx) return fn(root);
      // تسلسل المعاملات: PGlite اتصال واحد
      const run = async () => {
        inTx = true;
        try {
          return await pgl.transaction(async (t) => {
            const txDb = makeDb(
              t as unknown as Queryable,
              async (sql) => {
                await t.exec(sql);
              },
              async (inner) => inner(txDb),
              async () => {},
              'pglite',
            );
            return fn(txDb);
          });
        } finally {
          inTx = false;
        }
      };
      const p = chain.then(run, run);
      chain = p.catch(() => undefined);
      return p as any;
    },
    async () => {
      await pgl.close();
    },
    'pglite',
  );
  return root;
}

export async function openPostgres(url: string): Promise<Db> {
  pg.types.setTypeParser(INT8, (v) => Number(v));
  pg.types.setTypeParser(DATE, (v) => v);
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  await pool.query('select 1');
  const root: Db = makeDb(
    pool,
    async (sql) => {
      await pool.query(sql);
    },
    async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txDb = makeDb(
          client,
          async (sql) => {
            await client.query(sql);
          },
          async (inner) => inner(txDb),
          async () => {},
          'postgres',
        );
        const r = await fn(txDb);
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async () => {
      await pool.end();
    },
    'postgres',
  );
  return root;
}

export async function openDb(opts: { url?: string; dataDir?: string; memory?: boolean } = {}): Promise<Db> {
  if (opts.url) return openPostgres(opts.url);
  return openPglite(opts.memory ? undefined : opts.dataDir);
}
