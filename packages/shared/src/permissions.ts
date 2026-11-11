/** الصلاحيات: كل مفتاح = شاشة/وحدة + عملية */
export const PERMISSION_GROUPS: { module: string; label: string; actions: { key: string; label: string }[] }[] = [
  {
    module: 'items',
    label: 'الأصناف',
    actions: [
      { key: 'items.view', label: 'مشاهدة' },
      { key: 'items.create', label: 'إنشاء' },
      { key: 'items.edit', label: 'تعديل' },
    ],
  },
  {
    module: 'inventory',
    label: 'المخازن والجرد والتحويل',
    actions: [
      { key: 'inventory.view', label: 'مشاهدة' },
      { key: 'inventory.create', label: 'إنشاء' },
      { key: 'inventory.post', label: 'ترحيل' },
      { key: 'inventory.cancel', label: 'إلغاء' },
    ],
  },
  {
    module: 'sales',
    label: 'المبيعات',
    actions: [
      { key: 'sales.view', label: 'مشاهدة' },
      { key: 'sales.create', label: 'إنشاء' },
      { key: 'sales.edit', label: 'تعديل المسودات' },
      { key: 'sales.post', label: 'ترحيل' },
      { key: 'sales.cancel', label: 'إلغاء' },
      { key: 'sales.price_change', label: 'تغيير الأسعار' },
      { key: 'sales.discount', label: 'منح خصم' },
      { key: 'sales.print', label: 'طباعة' },
    ],
  },
  {
    module: 'purchases',
    label: 'المشتريات',
    actions: [
      { key: 'purchases.view', label: 'مشاهدة' },
      { key: 'purchases.create', label: 'إنشاء' },
      { key: 'purchases.edit', label: 'تعديل المسودات' },
      { key: 'purchases.post', label: 'ترحيل' },
      { key: 'purchases.cancel', label: 'إلغاء' },
      { key: 'purchases.print', label: 'طباعة' },
    ],
  },
  {
    module: 'parties',
    label: 'العملاء والموردون',
    actions: [
      { key: 'parties.view', label: 'مشاهدة' },
      { key: 'parties.create', label: 'إنشاء' },
      { key: 'parties.edit', label: 'تعديل' },
    ],
  },
  {
    module: 'treasury',
    label: 'الخزينة والبنوك',
    actions: [
      { key: 'treasury.view', label: 'مشاهدة' },
      { key: 'treasury.create', label: 'إنشاء سندات' },
      { key: 'treasury.post', label: 'ترحيل' },
      { key: 'treasury.cancel', label: 'إلغاء' },
      { key: 'treasury.manage', label: 'إدارة الخزائن' },
    ],
  },
  {
    module: 'accounts',
    label: 'الحسابات',
    actions: [
      { key: 'accounts.view', label: 'مشاهدة' },
      { key: 'accounts.manage', label: 'إدارة دليل الحسابات' },
      { key: 'accounts.journal', label: 'قيود يدوية' },
      { key: 'accounts.post', label: 'ترحيل القيود' },
      { key: 'accounts.cancel', label: 'عكس القيود' },
    ],
  },
  {
    module: 'reports',
    label: 'التقارير',
    actions: [
      { key: 'reports.view', label: 'التقارير العامة' },
      { key: 'reports.financial', label: 'التقارير المالية' },
      { key: 'reports.profit', label: 'الأرباح' },
      { key: 'costs.view', label: 'رؤية التكلفة' },
    ],
  },
  {
    module: 'admin',
    label: 'الإدارة',
    actions: [
      { key: 'settings.manage', label: 'الإعدادات' },
      { key: 'users.manage', label: 'المستخدمون والصلاحيات' },
      { key: 'conflicts.resolve', label: 'حل تعارضات المزامنة' },
      { key: 'backup.manage', label: 'النسخ الاحتياطي' },
      { key: 'audit.view', label: 'سجل التدقيق' },
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.actions.map((a) => a.key));

export const DEFAULT_ROLES: { id: string; name: string; permissions: string[] }[] = [
  { id: 'role-admin', name: 'مدير النظام', permissions: ['*'] },
  {
    id: 'role-accountant',
    name: 'محاسب',
    permissions: ALL_PERMISSIONS.filter((p) => !['users.manage', 'backup.manage', 'settings.manage'].includes(p)),
  },
  {
    id: 'role-cashier',
    name: 'كاشير',
    permissions: [
      'items.view', 'parties.view', 'parties.create', 'sales.view', 'sales.create', 'sales.post', 'sales.print',
      'treasury.view', 'treasury.create', 'treasury.post', 'inventory.view',
    ],
  },
  {
    id: 'role-storekeeper',
    name: 'أمين مخزن',
    permissions: [
      'items.view', 'items.create', 'items.edit', 'inventory.view', 'inventory.create', 'inventory.post',
      'purchases.view', 'reports.view',
    ],
  },
];

export function hasPermission(perms: string[] | undefined, key: string): boolean {
  if (!perms) return false;
  return perms.includes('*') || perms.includes(key);
}
