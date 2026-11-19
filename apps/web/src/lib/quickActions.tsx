import { hasPermission, type WorkspaceId } from '@erp/shared';
import {
  ArrowDownLeft, ArrowLeftRight, Fingerprint, HandCoins, ArrowUpRight, BookPlus, ClipboardCheck, Clock, FileText, PackagePlus, PackageSearch, Receipt, RotateCcw, ShoppingBag,
  ShoppingCart, TrendingUp, Undo2, UserPlus, Wallet, Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSession } from './hooks';

/**
 * الإجراءات السريعة: كل إجراء مرتبط بصلاحية، ولا يظهر إلا لمن يملكها.
 * الترتيب: الأكثر استخدامًا لهذا المستخدم أولًا، ثم الأهم لمساحة عمله، ثم الباقي.
 */
export interface QuickAction {
  key: string;
  label: string;
  icon: ReactNode;
  to: string;
  perm: string;
  group: 'المبيعات' | 'المشتريات' | 'الخزينة' | 'المخزون' | 'الأطراف' | 'الحسابات' | 'الموظفين' | 'الشركاء';
  /** إنشاء مستند/سجل جديد (يظهر في قائمة «جديد») */
  creates: boolean;
  /** المساحات التي يكون فيها هذا الإجراء من الأساسيات */
  ws: WorkspaceId[];
}

export const QUICK_ACTIONS: QuickAction[] = [
  { key: 'pos', label: 'بيع سريع', icon: <Zap />, to: '/pos', perm: 'sales.create', group: 'المبيعات', creates: false, ws: ['dashboard', 'sales'] },
  { key: 'sale_invoice', label: 'فاتورة بيع', icon: <ShoppingCart />, to: '/docs/new/sale_invoice', perm: 'sales.create', group: 'المبيعات', creates: true, ws: ['dashboard', 'pos', 'sales'] },
  { key: 'sale_return', label: 'مرتجع بيع', icon: <RotateCcw />, to: '/docs/new/sale_return', perm: 'sales.create', group: 'المبيعات', creates: true, ws: ['pos', 'sales'] },
  { key: 'quotation', label: 'عرض أسعار', icon: <FileText />, to: '/docs/new/quotation', perm: 'sales.quotation', group: 'المبيعات', creates: true, ws: ['sales'] },
  { key: 'customer_new', label: 'عميل جديد', icon: <UserPlus />, to: '/parties/customer?new=1', perm: 'parties.create', group: 'الأطراف', creates: true, ws: ['pos', 'sales'] },
  { key: 'supplier_new', label: 'مورد جديد', icon: <UserPlus />, to: '/parties/supplier?new=1', perm: 'parties.create', group: 'الأطراف', creates: true, ws: ['inventory'] },
  { key: 'receipt', label: 'قبض من عميل', icon: <ArrowDownLeft />, to: '/docs/new/receipt', perm: 'treasury.create', group: 'الخزينة', creates: true, ws: ['dashboard', 'accounting', 'sales'] },
  { key: 'payment', label: 'صرف لمورد', icon: <ArrowUpRight />, to: '/docs/new/payment', perm: 'treasury.create', group: 'الخزينة', creates: true, ws: ['accounting'] },
  { key: 'expense', label: 'مصروف', icon: <Receipt />, to: '/docs/new/expense', perm: 'treasury.create', group: 'الخزينة', creates: true, ws: ['dashboard', 'accounting'] },
  { key: 'income', label: 'إيراد آخر', icon: <TrendingUp />, to: '/docs/new/income', perm: 'treasury.create', group: 'الخزينة', creates: true, ws: [] },
  { key: 'cash_transfer', label: 'تحويل بين الخزائن', icon: <ArrowLeftRight />, to: '/docs/new/cash_transfer', perm: 'treasury.create', group: 'الخزينة', creates: true, ws: ['accounting'] },
  { key: 'purchase_invoice', label: 'فاتورة شراء', icon: <ShoppingBag />, to: '/docs/new/purchase_invoice', perm: 'purchases.create', group: 'المشتريات', creates: true, ws: ['dashboard', 'inventory'] },
  { key: 'purchase_return', label: 'مرتجع شراء', icon: <Undo2 />, to: '/docs/new/purchase_return', perm: 'purchases.create', group: 'المشتريات', creates: true, ws: ['inventory'] },
  { key: 'item_new', label: 'صنف جديد', icon: <PackagePlus />, to: '/items?new=1', perm: 'items.create', group: 'المخزون', creates: true, ws: ['inventory'] },
  { key: 'stock_adjustment', label: 'جرد وتسوية', icon: <ClipboardCheck />, to: '/docs/new/stock_adjustment', perm: 'inventory.create', group: 'المخزون', creates: true, ws: ['inventory'] },
  { key: 'opening_stock', label: 'بضاعة أول المدة', icon: <PackagePlus />, to: '/docs/new/opening_stock', perm: 'inventory.create', group: 'المخزون', creates: true, ws: [] },
  { key: 'stock_transfer', label: 'تحويل مخزني', icon: <ArrowLeftRight />, to: '/docs/new/stock_transfer', perm: 'inventory.create', group: 'المخزون', creates: true, ws: ['inventory'] },
  { key: 'item_inquiry', label: 'استعلام عن صنف', icon: <PackageSearch />, to: '/items/inquiry', perm: 'items.view', group: 'المخزون', creates: false, ws: ['pos', 'inventory', 'sales'] },
  { key: 'journal_voucher', label: 'قيد يومية', icon: <BookPlus />, to: '/docs/new/journal_voucher', perm: 'accounts.journal', group: 'الحسابات', creates: true, ws: ['accounting'] },
  { key: 'attendance', label: 'حضور وانصراف', icon: <Fingerprint />, to: '/employees/attendance', perm: 'employees.attendance', group: 'الموظفين', creates: false, ws: ['dashboard'] },
  { key: 'payroll', label: 'الرواتب', icon: <Wallet />, to: '/employees/payroll', perm: 'employees.create', group: 'الموظفين', creates: false, ws: [] },
  { key: 'employee_advance', label: 'سلفة موظف', icon: <HandCoins />, to: '/employees/advances', perm: 'employees.create', group: 'الموظفين', creates: false, ws: [] },
  { key: 'partner_capital', label: 'إيداع رأس مال', icon: <ArrowDownLeft />, to: '/docs/new/partner_capital', perm: 'partners.create', group: 'الشركاء', creates: true, ws: [] },
  { key: 'partner_withdrawal', label: 'مسحوبات شريك', icon: <ArrowUpRight />, to: '/docs/new/partner_withdrawal', perm: 'partners.create', group: 'الشركاء', creates: true, ws: [] },
  { key: 'shift', label: 'الوردية', icon: <Clock />, to: '/shift', perm: 'treasury.shift', group: 'الخزينة', creates: false, ws: ['pos'] },
];

const usageKey = (uid: string) => `erp.usage.${uid}`;

function readUsage(uid: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(usageKey(uid)) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** تسجيل استخدام إجراء (محليًا لهذا المستخدم) لترتيب الأكثر استخدامًا أولًا */
export function recordUse(uid: string, key: string) {
  try {
    const u = readUsage(uid);
    u[key] = (u[key] ?? 0) + 1;
    localStorage.setItem(usageKey(uid), JSON.stringify(u));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('erp:usage'));
}

/** الإجراءات المسموحة مرتبة للمستخدم الحالي */
export function useQuickActions(ws?: WorkspaceId): { actions: QuickAction[]; usage: Record<string, number>; use: (a: QuickAction) => void } {
  const { session } = useSession();
  const uid = session.user.id;
  const perms = session.user.permissions;
  const [usage, setUsage] = useState(() => readUsage(uid));
  useEffect(() => {
    setUsage(readUsage(uid));
    const h = () => setUsage(readUsage(uid));
    window.addEventListener('erp:usage', h);
    return () => window.removeEventListener('erp:usage', h);
  }, [uid]);
  const actions = useMemo(() => {
    const allowed = QUICK_ACTIONS.map((a, i) => ({ a, i })).filter(({ a }) => hasPermission(perms, a.perm));
    return allowed
      .sort((x, y) => {
        const ux = usage[x.a.key] ?? 0;
        const uy = usage[y.a.key] ?? 0;
        if (ux !== uy) return uy - ux;
        const rx = ws && x.a.ws.includes(ws) ? 0 : 1;
        const ry = ws && y.a.ws.includes(ws) ? 0 : 1;
        return rx - ry || x.i - y.i;
      })
      .map(({ a }) => a);
  }, [perms, usage, ws]);
  return { actions, usage, use: (a) => recordUse(uid, a.key) };
}
