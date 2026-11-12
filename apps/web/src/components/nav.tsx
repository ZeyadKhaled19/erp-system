import {
  AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Barcode, BarChart3, BookOpen, BookPlus, Boxes, Building2, CalendarClock, ClipboardCheck,
  Clock, FileText, HardDriveDownload, Home, Landmark, ListTree, Package, PackagePlus, PackageSearch, PieChart, Receipt, RefreshCw, RotateCcw, Scale,
  ScrollText, Settings, ShieldCheck, ShoppingBag, ShoppingCart, Tags, TrendingUp, Truck, Undo2, UserPlus, Users, Wallet, Warehouse, Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';

export interface NavLink {
  to: string;
  label: string;
  desc?: string;
  icon: ReactNode;
  grad: string;
  perm?: string;
  /** إجراء رئيسي يظهر كبطاقة كبيرة */
  hero?: boolean;
}
export interface Hub {
  key: string;
  label: string;
  sub: string;
  icon: ReactNode;
  grad: string;
  /** رابط مباشر بدل صفحة قسم */
  to?: string;
  perm?: string;
  groups: { title: string; links: NavLink[] }[];
}

/** الأقسام الرئيسية: كل قسم صفحة واحدة فيها أهم الإجراءات أولًا ثم الباقي */
export const HUBS: Hub[] = [
  { key: 'home', label: 'الرئيسية', sub: 'ملخص اليوم', icon: <Home />, grad: 'var(--grad-blue)', to: '/', groups: [] },
  { key: 'pos', label: 'بيع سريع', sub: 'كاشير بلمسة واحدة', icon: <Zap />, grad: 'var(--grad-green)', to: '/pos', perm: 'sales.create', groups: [] },
  { key: 'invoices', label: 'الفواتير', sub: 'كل الفواتير والسندات في مكان واحد', icon: <FileText />, grad: 'var(--grad-teal)', to: '/invoices', perm: 'sales.view', groups: [] },
  {
    key: 'sales',
    label: 'المبيعات',
    sub: 'فواتير ومرتجعات وعروض أسعار',
    icon: <ShoppingCart />,
    grad: 'var(--grad-green)',
    perm: 'sales.view',
    groups: [
      {
        title: 'ابدأ',
        links: [
          { to: '/pos', label: 'بيع سريع', desc: 'اختر الأصناف وادفع في خطوتين', icon: <Zap />, grad: 'var(--grad-green)', perm: 'sales.create', hero: true },
          { to: '/docs/new/sale_invoice', label: 'فاتورة بيع', desc: 'بكل الخيارات (آجل، أقساط، تسليم لاحق)', icon: <ShoppingCart />, grad: 'var(--grad-blue)', perm: 'sales.create' },
          { to: '/docs/new/sale_return', label: 'مرتجع بيع', icon: <Undo2 />, grad: 'var(--grad-orange)', perm: 'sales.create' },
          { to: '/docs/new/quotation', label: 'عرض أسعار / حجز', icon: <FileText />, grad: 'var(--grad-indigo)', perm: 'sales.quotation' },
        ],
      },
      {
        title: 'المتابعة',
        links: [
          { to: '/docs/list/sales', label: 'سجل المبيعات', icon: <FileText />, grad: 'var(--grad-teal)', perm: 'sales.view' },
          { to: '/receivables', label: 'الفواتير الآجلة', icon: <CalendarClock />, grad: 'var(--grad-red)', perm: 'sales.view' },
          { to: '/deliveries', label: 'متابعة التسليم', icon: <Truck />, grad: 'var(--grad-brown)', perm: 'sales.view' },
          { to: '/parties/customer', label: 'العملاء', icon: <Users />, grad: 'var(--grad-indigo)', perm: 'parties.view' },
        ],
      },
    ],
  },
  {
    key: 'purchases',
    label: 'المشتريات',
    sub: 'فواتير الشراء والموردون',
    icon: <ShoppingBag />,
    grad: 'var(--grad-purple)',
    perm: 'purchases.view',
    groups: [
      {
        title: 'ابدأ',
        links: [
          { to: '/docs/new/purchase_invoice', label: 'فاتورة شراء', desc: 'أضف البضاعة للمخزن وسجّل المستحق للمورد', icon: <ShoppingBag />, grad: 'var(--grad-purple)', perm: 'purchases.create', hero: true },
          { to: '/docs/new/purchase_return', label: 'مرتجع شراء', icon: <RotateCcw />, grad: 'var(--grad-orange)', perm: 'purchases.create' },
        ],
      },
      {
        title: 'المتابعة',
        links: [
          { to: '/docs/list/purchases', label: 'سجل المشتريات', icon: <FileText />, grad: 'var(--grad-teal)', perm: 'purchases.view' },
          { to: '/parties/supplier', label: 'الموردون', icon: <Truck />, grad: 'var(--grad-brown)', perm: 'parties.view' },
        ],
      },
    ],
  },
  {
    key: 'inventory',
    label: 'المخزون',
    sub: 'الأصناف والمخازن والجرد',
    icon: <Package />,
    grad: 'var(--grad-orange)',
    perm: 'items.view',
    groups: [
      {
        title: 'الأصناف',
        links: [
          { to: '/items', label: 'الأصناف', desc: 'إضافة وتعديل الأصناف والأسعار', icon: <Package />, grad: 'var(--grad-orange)', perm: 'items.view', hero: true },
          { to: '/items/inquiry', label: 'استعلام عن صنف', icon: <PackageSearch />, grad: 'var(--grad-blue)', perm: 'items.view' },
          { to: '/lists', label: 'قوائم الأسعار والمندوبون', icon: <Tags />, grad: 'var(--grad-orange)', perm: 'items.view' },
          { to: '/warehouses', label: 'المخازن والتصنيفات', icon: <Building2 />, grad: 'var(--grad-gray)', perm: 'items.view' },
        ],
      },
      {
        title: 'حركات المخزن',
        links: [
          { to: '/docs/new/stock_transfer', label: 'تحويل بين المخازن', icon: <ArrowLeftRight />, grad: 'var(--grad-purple)', perm: 'inventory.create' },
          { to: '/docs/new/stock_adjustment', label: 'جرد وتسوية', icon: <ClipboardCheck />, grad: 'var(--grad-pink)', perm: 'inventory.create' },
          { to: '/docs/new/opening_stock', label: 'بضاعة أول المدة', icon: <PackagePlus />, grad: 'var(--grad-gray)', perm: 'inventory.create' },
          { to: '/docs/list/inventory', label: 'سجل حركات المخازن', icon: <FileText />, grad: 'var(--grad-teal)', perm: 'inventory.view' },
        ],
      },
      {
        title: 'تقارير المخزون',
        links: [
          { to: '/reports/stock', label: 'بضاعة مخزن', icon: <Boxes />, grad: 'var(--grad-green)', perm: 'inventory.view' },
          { to: '/reports/item', label: 'حركة صنف', icon: <ArrowLeftRight />, grad: 'var(--grad-indigo)', perm: 'inventory.view' },
          { to: '/reports/warehouse-movement', label: 'حركة مخزن', icon: <Warehouse />, grad: 'var(--grad-teal)', perm: 'inventory.view' },
          { to: '/reports/reorder', label: 'تحت حد الطلب', icon: <AlertTriangle />, grad: 'var(--grad-red)', perm: 'inventory.view' },
          { to: '/reports/negative', label: 'أرصدة سالبة', icon: <AlertTriangle />, grad: 'var(--grad-orange)', perm: 'inventory.view' },
          { to: '/reports/serial', label: 'بحث بالسيريال', icon: <Barcode />, grad: 'var(--grad-gray)', perm: 'inventory.view' },
          { to: '/reports/expiry', label: 'صلاحية الأصناف', icon: <CalendarClock />, grad: 'var(--grad-orange)', perm: 'inventory.view' },
        ],
      },
    ],
  },
  {
    key: 'treasury',
    label: 'الخزينة',
    sub: 'قبض وصرف ومصروفات',
    icon: <Wallet />,
    grad: 'var(--grad-blue)',
    perm: 'treasury.view',
    groups: [
      {
        title: 'ابدأ',
        links: [
          { to: '/docs/new/receipt', label: 'قبض من عميل', desc: 'يُخصم تلقائيًا من أقدم فواتيره', icon: <ArrowDownLeft />, grad: 'var(--grad-green)', perm: 'treasury.create', hero: true },
          { to: '/docs/new/payment', label: 'صرف لمورد', icon: <ArrowUpRight />, grad: 'var(--grad-red)', perm: 'treasury.create' },
          { to: '/docs/new/expense', label: 'مصروف', icon: <Receipt />, grad: 'var(--grad-orange)', perm: 'treasury.create' },
          { to: '/docs/new/income', label: 'إيراد آخر', icon: <TrendingUp />, grad: 'var(--grad-green)', perm: 'treasury.create' },
          { to: '/docs/new/cash_transfer', label: 'تحويل بين الخزائن', icon: <ArrowLeftRight />, grad: 'var(--grad-indigo)', perm: 'treasury.create' },
        ],
      },
      {
        title: 'المتابعة',
        links: [
          { to: '/cashboxes', label: 'الخزائن والبنوك', icon: <Wallet />, grad: 'var(--grad-blue)', perm: 'treasury.view' },
          { to: '/instruments', label: 'الشيكات والأقساط', icon: <CalendarClock />, grad: 'var(--grad-purple)', perm: 'treasury.view' },
          { to: '/shift', label: 'الوردية', icon: <Clock />, grad: 'var(--grad-teal)', perm: 'treasury.shift' },
          { to: '/docs/list/treasury', label: 'سجل السندات', icon: <FileText />, grad: 'var(--grad-teal)', perm: 'treasury.view' },
          { to: '/reports/treasury', label: 'تحليل المقبوضات', icon: <PieChart />, grad: 'var(--grad-green)', perm: 'treasury.view' },
          { to: '/reports/treasury?dir=out', label: 'تحليل المصروفات', icon: <PieChart />, grad: 'var(--grad-red)', perm: 'treasury.view' },
        ],
      },
    ],
  },
  { key: 'customers', label: 'العملاء', sub: 'الأرصدة وكشوف الحساب', icon: <Users />, grad: 'var(--grad-indigo)', to: '/parties/customer', perm: 'parties.view', groups: [] },
  { key: 'suppliers', label: 'الموردون', sub: 'المستحقات وكشوف الحساب', icon: <Truck />, grad: 'var(--grad-brown)', to: '/parties/supplier', perm: 'parties.view', groups: [] },
  {
    key: 'reports',
    label: 'التقارير والحسابات',
    sub: 'الأرباح والميزانية والتحليل',
    icon: <BarChart3 />,
    grad: 'var(--grad-pink)',
    perm: 'reports.view',
    groups: [
      {
        title: 'أهم التقارير',
        links: [
          { to: '/reports/analysis', label: 'تحليل المبيعات', desc: 'حسب الصنف أو العميل أو اليوم مع الربح', icon: <TrendingUp />, grad: 'var(--grad-indigo)', perm: 'reports.view', hero: true },
          { to: '/reports/daily', label: 'الحركة اليومية', icon: <CalendarClock />, grad: 'var(--grad-blue)', perm: 'reports.view' },
          { to: '/reports/income', label: 'الأرباح والخسائر', icon: <TrendingUp />, grad: 'var(--grad-orange)', perm: 'reports.profit' },
          { to: '/reports/documents', label: 'تقارير المستندات', icon: <BarChart3 />, grad: 'var(--grad-pink)', perm: 'reports.view' },
          { to: '/reports/commissions', label: 'عمولات المندوبين', icon: <Users />, grad: 'var(--grad-teal)', perm: 'reports.view' },
        ],
      },
      {
        title: 'الحسابات',
        links: [
          { to: '/reports/trial-balance', label: 'ميزان المراجعة', icon: <Scale />, grad: 'var(--grad-green)', perm: 'reports.financial' },
          { to: '/reports/balance-sheet', label: 'الميزانية العمومية', icon: <Landmark />, grad: 'var(--grad-indigo)', perm: 'reports.financial' },
          { to: '/reports/ledger', label: 'دفتر الأستاذ', icon: <BookOpen />, grad: 'var(--grad-brown)', perm: 'reports.financial' },
          { to: '/accounts', label: 'دليل الحسابات', icon: <ListTree />, grad: 'var(--grad-indigo)', perm: 'accounts.view' },
          { to: '/docs/new/journal_voucher', label: 'قيد يومية', icon: <BookPlus />, grad: 'var(--grad-blue)', perm: 'accounts.journal' },
          { to: '/docs/new/party_opening', label: 'رصيد افتتاحي لطرف', icon: <UserPlus />, grad: 'var(--grad-gray)', perm: 'accounts.journal' },
          { to: '/docs/list/accounts', label: 'سجل القيود', icon: <FileText />, grad: 'var(--grad-teal)', perm: 'accounts.view' },
          { to: '/year-end', label: 'إقفال السنة المالية', icon: <Landmark />, grad: 'var(--grad-red)', perm: 'period.lock' },
        ],
      },
    ],
  },
  { key: 'partners', label: 'الشركاء', sub: 'رأس المال وتوزيع الأرباح', icon: <PieChart />, grad: 'var(--grad-green)', to: '/partners', perm: 'partners.view', groups: [] },
  {
    key: 'system',
    label: 'الإعدادات',
    sub: 'المستخدمون والمزامنة والنسخ',
    icon: <Settings />,
    grad: 'var(--grad-gray)',
    groups: [
      {
        title: 'النظام',
        links: [
          { to: '/settings', label: 'الإعدادات العامة', desc: 'بيانات الشركة والطباعة والضرائب', icon: <Settings />, grad: 'var(--grad-gray)', hero: true },
          { to: '/sync', label: 'مركز المزامنة', icon: <RefreshCw />, grad: 'var(--grad-green)' },
          { to: '/users', label: 'المستخدمون والصلاحيات', icon: <ShieldCheck />, grad: 'var(--grad-gray)', perm: 'users.manage' },
          { to: '/backups', label: 'النسخ الاحتياطي', icon: <HardDriveDownload />, grad: 'var(--grad-blue)', perm: 'backup.manage' },
          { to: '/audit', label: 'سجل التدقيق', icon: <ScrollText />, grad: 'var(--grad-brown)', perm: 'audit.view' },
        ],
      },
    ],
  },
];

export const hubPath = (h: Hub) => h.to ?? `/hub/${h.key}`;

/** القسم الذي تنتمي إليه الصفحة الحالية (لتمييزه في الشريط الجانبي) */
export function activeHubKey(pathname: string): string {
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/hub/')) return pathname.slice(5);
  if (pathname.startsWith('/pos')) return 'pos';
  if (pathname.startsWith('/invoices')) return 'invoices';
  if (pathname.startsWith('/parties/customer')) return 'customers';
  if (pathname.startsWith('/parties/supplier')) return 'suppliers';
  if (pathname.startsWith('/partners') || pathname.includes('partner_')) return 'partners';
  const type = pathname.match(/\/docs\/(?:new|list)\/([a-z_]+)/)?.[1];
  if (type) {
    if (type.startsWith('sale') || type === 'quotation' || type === 'sales') return 'sales';
    if (type.startsWith('purchase')) return 'purchases';
    if (['stock_transfer', 'stock_adjustment', 'opening_stock', 'inventory'].includes(type)) return 'inventory';
    if (['receipt', 'payment', 'expense', 'income', 'cash_transfer', 'treasury'].includes(type)) return 'treasury';
    if (['journal_voucher', 'party_opening', 'accounts'].includes(type)) return 'reports';
  }
  for (const h of HUBS) {
    for (const g of h.groups) if (g.links.some((l) => l.to === pathname || (l.to !== '/' && pathname.startsWith(l.to + '/')))) return h.key;
  }
  return '';
}
