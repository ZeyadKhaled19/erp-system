import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from './db';

/** الهيكل التنظيمي على الجهاز: الإدارات والوظائف وأدوات الفلترة بالإدارة */

const byName = (a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name), 'ar');

export const useDepartments = () => useLiveQuery(async () => (await db.departments.toArray()).sort(byName), []) ?? [];
export const useJobTitles = () => useLiveQuery(async () => (await db.job_titles.toArray()).sort(byName), []) ?? [];

/** الإدارة نفسها وكل الأقسام اللي تحتها */
export function withChildren(depts: any[], id: string) {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const d of depts) if (d.parent_id && out.has(d.parent_id) && !out.has(d.id)) { out.add(d.id); grew = true; }
  }
  return out;
}

/** اسم الإدارة بالكامل: «التشغيل ← المبيعات» */
export function deptPath(depts: any[], id?: string | null) {
  const map = new Map(depts.map((d) => [d.id, d]));
  const names: string[] = [];
  const seen = new Set<string>();
  for (let cur = id ? map.get(id) : undefined; cur && !seen.has(cur.id); cur = cur.parent_id ? map.get(cur.parent_id) : undefined) {
    seen.add(cur.id);
    names.unshift(cur.name);
  }
  return names.join(' ← ');
}

/** الإدارات مرتبة كشجرة (كل إدارة وتحتها أقسامها) مع العمق */
export function deptTree(depts: any[]) {
  const out: { d: any; depth: number }[] = [];
  const ids = new Set(depts.map((d) => d.id));
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const d of depts) {
      const p = d.parent_id && ids.has(d.parent_id) ? d.parent_id : null;
      if (p !== parent || seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({ d, depth });
      walk(d.id, depth + 1, seen);
    }
  };
  walk(null, 0, new Set());
  return out;
}

const KEY = 'erp.employees.dept';
/** فلتر الإدارة: نفس الاختيار بيفضل ماشي بين صفحات الموظفين والحضور والرواتب */
export function useDeptFilter() {
  const [v, setV] = useState<string>(() => {
    try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; }
  });
  const set = (x: string) => {
    setV(x);
    try { x ? sessionStorage.setItem(KEY, x) : sessionStorage.removeItem(KEY); } catch { /* المتصفح مانع التخزين */ }
  };
  return [v, set] as const;
}

/** يرجّع دالة بتقول الموظف داخل الإدارة المختارة (أو أقسامها) ولا لأ */
export function useDeptMatcher(deptId: string) {
  const depts = useDepartments();
  if (!deptId) return { depts, match: (_e: any) => true };
  if (deptId === '-') return { depts, match: (e: any) => !e.department_id };
  const set = withChildren(depts, deptId);
  return { depts, match: (e: any) => set.has(e.department_id) };
}

/** قائمة اختيار الإدارة للفلترة */
export function DeptSelect({ value, onChange, depts, width = 200 }: { value: string; onChange: (v: string) => void; depts: any[]; width?: number }) {
  if (!depts.length) return null;
  return (
    <select className="select" style={{ width }} value={value} onChange={(e) => onChange(e.target.value)} aria-label="الإدارة">
      <option value="">كل الإدارات</option>
      {deptTree(depts).map(({ d, depth }) => (
        <option key={d.id} value={d.id}>{'  '.repeat(depth)}{depth ? '└ ' : ''}{d.name}{d.active === false ? ' (موقوفة)' : ''}</option>
      ))}
      <option value="-">بدون إدارة</option>
    </select>
  );
}
