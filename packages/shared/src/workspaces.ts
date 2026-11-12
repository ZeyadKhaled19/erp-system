import { hasPermission } from './permissions';

/**
 * مساحات العمل (صفحات البداية). عرض فقط: فتح مساحة لا يمنح أي صلاحية،
 * وكل شاشة وكل عملية تتحقق من صلاحيتها بنفسها في الواجهة والخادم.
 */
export type WorkspaceId = 'dashboard' | 'pos' | 'sales' | 'inventory' | 'accounting' | 'invoices';

export interface Workspace {
  id: WorkspaceId;
  label: string;
  desc: string;
  path: string;
  /** يكفي امتلاك واحدة منها لاستخدام المساحة (فارغة = متاحة للجميع) */
  anyOf: string[];
}

export const WORKSPACES: Workspace[] = [
  { id: 'dashboard', label: 'لوحة الإدارة', desc: 'المؤشرات والتنبيهات العامة', path: '/', anyOf: [] },
  { id: 'pos', label: 'البيع السريع', desc: 'كاشير وباركود وعملاء وآخر المبيعات', path: '/pos', anyOf: ['sales.create'] },
  { id: 'sales', label: 'مساحة المبيعات', desc: 'العملاء وعروض الأسعار والطلبات والأداء', path: '/hub/sales', anyOf: ['sales.view'] },
  { id: 'inventory', label: 'مساحة المخزون', desc: 'الأرصدة والنواقص والحركة والاستلام', path: '/hub/inventory', anyOf: ['items.view'] },
  { id: 'accounting', label: 'مساحة الحسابات', desc: 'الملخص المالي والمستحقات والقيود', path: '/hub/reports', anyOf: ['reports.view'] },
  { id: 'invoices', label: 'الفواتير', desc: 'كل الفواتير والسندات', path: '/invoices', anyOf: ['sales.view', 'purchases.view'] },
];

export const WORKSPACE_IDS = WORKSPACES.map((w) => w.id);

export function canUseWorkspace(id: string | null | undefined, perms: string[] | undefined): boolean {
  const w = WORKSPACES.find((x) => x.id === id);
  if (!w) return false;
  return w.anyOf.length === 0 || w.anyOf.some((p) => hasPermission(perms, p));
}

/** صفحة البداية المبنية للأدوار الافتراضية */
export const BUILTIN_ROLE_HOME: Record<string, WorkspaceId> = {
  'role-admin': 'dashboard',
  'role-accountant': 'accounting',
  'role-cashier': 'pos',
  'role-storekeeper': 'inventory',
};

/** لدور مخصص بلا إعداد: أقرب مساحة لطبيعة صلاحياته */
export function inferRoleHome(perms: string[] | undefined): WorkspaceId {
  const p = perms ?? [];
  if (p.includes('*')) return 'dashboard';
  const has = (k: string) => p.includes(k);
  if (has('sales.create') && has('treasury.shift') && !has('accounts.view')) return 'pos';
  if (has('inventory.create') && !has('sales.create')) return 'inventory';
  if (has('accounts.view') || has('reports.financial')) return 'accounting';
  if (has('sales.view')) return 'sales';
  return 'dashboard';
}

/**
 * الأولوية: تفضيل المستخدم الصالح ← صفحة الدور المسموحة (إعداد المدير ثم الافتراضي) ← الأنسب لصلاحياته ← أول مساحة مسموحة.
 * صالح = موجود ولدى المستخدم صلاحية استخدامه الآن (يُعاد حسابه عند تغير الصلاحيات).
 */
export function resolveHome(opts: { perms: string[] | undefined; roleId: string; preference?: string | null; roleHomes?: Record<string, string> | null }): Workspace {
  const { perms, roleId, preference, roleHomes } = opts;
  const pick = (id: string | null | undefined) => (id && canUseWorkspace(id, perms) ? WORKSPACES.find((w) => w.id === id)! : null);
  return (
    pick(preference) ??
    pick(roleHomes?.[roleId]) ??
    pick(BUILTIN_ROLE_HOME[roleId]) ??
    pick(inferRoleHome(perms)) ??
    WORKSPACES.find((w) => canUseWorkspace(w.id, perms))!
  );
}
