import { hasPermission } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import { db } from './db';
import type { Session } from './session';
import { syncStore } from './sync';

export const SessionContext = createContext<{ session: Session; logout: () => void } | null>(null);

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error('no session');
  return s;
}

export function usePerm() {
  const { session } = useSession();
  return (key: string) => hasPermission(session.user.permissions, key);
}

export function useSyncState() {
  return useSyncExternalStore(syncStore.subscribe, syncStore.get);
}

export function useSyncCounts() {
  return (
    useLiveQuery(async () => {
      const pending = await db.outbox.where('status').equals('pending').count();
      const rejected = await db.outbox.where('status').equals('rejected').filter((e) => e.message !== 'تم التجاهل').count();
      const conflicts = await db.sync_conflicts.where('status').equals('open').count();
      return { pending, rejected, conflicts };
    }, []) ?? { pending: 0, rejected: 0, conflicts: 0 }
  );
}

export function useSettings(): Record<string, any> {
  return (
    useLiveQuery(async () => {
      const rows = await db.settings.toArray();
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    }, []) ?? {}
  );
}

/** بيانات تحتاج الخادم (التقارير): تُعيد خطأ واضحًا عند عدم الاتصال */
export function useRemote<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api<T>(url)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.network ? 'هذا التقرير يحتاج اتصالًا بالخادم. البيانات المسجلة على الجهاز محفوظة وستُرفع عند عودة الاتصال.' : e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

export function useDebounced<T>(v: T, ms = 200) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** خريطة id → سجل لجدول محلي */
export function useMap(table: 'items' | 'parties' | 'warehouses' | 'cashboxes' | 'accounts' | 'categories' | 'users') {
  return useLiveQuery(async () => new Map((await (db as any)[table].toArray()).map((r: any) => [r.id, r])), [table]) ?? new Map();
}
