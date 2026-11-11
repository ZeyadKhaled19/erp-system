import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BarChart3, BookOpen, Boxes, Building2, ChevronDown, ClipboardCheck, CloudOff,
  FileText, Home, Landmark, LayoutGrid, ListTree, LogOut, Menu, Package, PackageSearch, Receipt, RefreshCw, RotateCcw, Scale, ScrollText,
  Search, Settings, ShieldCheck, ShoppingBag, ShoppingCart, TrendingUp, Truck, Undo2, Users, Wallet, Warehouse, HardDriveDownload, AlertTriangle, PackagePlus, BookPlus, UserPlus,
  CalendarClock, Clock, PieChart, Tags, Barcode,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { usePerm, useSession, useSettings, useSyncCounts, useSyncState } from '../lib/hooks';
import { syncNow } from '../lib/sync';
import { DOC_TYPES } from '@erp/shared';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  color: string;
  perm?: string;
  badge?: 'sync';
}
interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    title: '',
    items: [{ to: '/', label: 'الرئيسية', icon: <Home />, color: '#007AFF' }],
  },
  {
    title: 'المبيعات',
    items: [
      { to: '/docs/new/sale_invoice', label: 'فاتورة بيع', icon: <ShoppingCart />, color: '#34C759', perm: 'sales.create' },
      { to: '/docs/new/sale_return', label: 'مرتجع بيع', icon: <Undo2 />, color: '#FF9500', perm: 'sales.create' },
      { to: '/docs/new/quotation', label: 'عرض أسعار / حجز', icon: <FileText />, color: '#5856D6', perm: 'sales.quotation' },
      { to: '/receivables', label: 'متابعة الفواتير الآجلة', icon: <CalendarClock />, color: '#FF3B30', perm: 'sales.view' },
      { to: '/deliveries', label: 'متابعة التسليم', icon: <Truck />, color: '#A2845E', perm: 'sales.view' },
      { to: '/docs/list/sales', label: 'سجل المبيعات', icon: <FileText />, color: '#30B0C7', perm: 'sales.view' },
      { to: '/parties/customer', label: 'العملاء', icon: <Users />, color: '#5856D6', perm: 'parties.view' },
    ],
  },
  {
    title: 'المشتريات',
    items: [
      { to: '/docs/new/purchase_invoice', label: 'فاتورة شراء', icon: <ShoppingBag />, color: '#AF52DE', perm: 'purchases.create' },
      { to: '/docs/new/purchase_return', label: 'مرتجع شراء', icon: <RotateCcw />, color: '#FF9500', perm: 'purchases.create' },
      { to: '/docs/list/purchases', label: 'سجل المشتريات', icon: <FileText />, color: '#30B0C7', perm: 'purchases.view' },
      { to: '/parties/supplier', label: 'الموردون', icon: <Truck />, color: '#A2845E', perm: 'parties.view' },
    ],
  },
  {
    title: 'البضاعة',
    items: [
      { to: '/items', label: 'الأصناف', icon: <Package />, color: '#FF9500', perm: 'items.view' },
      { to: '/items/inquiry', label: 'استعلام عن صنف', icon: <PackageSearch />, color: '#007AFF', perm: 'items.view' },
      { to: '/reports/item', label: 'تقرير حركة صنف', icon: <ArrowLeftRight />, color: '#5856D6', perm: 'inventory.view' },
      { to: '/reports/stock', label: 'تقرير بضاعة مخزن', icon: <Boxes />, color: '#34C759', perm: 'inventory.view' },
      { to: '/reports/warehouse-movement', label: 'تقرير حركة مخزن', icon: <Warehouse />, color: '#30B0C7', perm: 'inventory.view' },
      { to: '/reports/reorder', label: 'الأصناف تحت حد الطلب', icon: <AlertTriangle />, color: '#FF3B30', perm: 'inventory.view' },
      { to: '/reports/serial', label: 'بحث برقم سيريال', icon: <Barcode />, color: '#8E8E93', perm: 'inventory.view' },
      { to: '/reports/expiry', label: 'تقرير صلاحية الأصناف', icon: <CalendarClock />, color: '#FF9500', perm: 'inventory.view' },
      { to: '/docs/new/stock_transfer', label: 'تحويل بين المخازن', icon: <ArrowLeftRight />, color: '#AF52DE', perm: 'inventory.create' },
      { to: '/docs/new/stock_adjustment', label: 'جرد وتسوية', icon: <ClipboardCheck />, color: '#FF2D55', perm: 'inventory.create' },
      { to: '/docs/new/opening_stock', label: 'بضاعة أول المدة', icon: <PackagePlus />, color: '#8E8E93', perm: 'inventory.create' },
      { to: '/docs/list/inventory', label: 'سجل حركات المخازن', icon: <FileText />, color: '#30B0C7', perm: 'inventory.view' },
      { to: '/warehouses', label: 'المخازن والتصنيفات', icon: <Building2 />, color: '#8E8E93', perm: 'items.view' },
      { to: '/lists', label: 'قوائم الأسعار والمندوبون', icon: <Tags />, color: '#FF9500', perm: 'items.view' },
    ],
  },
  {
    title: 'الخزينة',
    items: [
      { to: '/docs/new/receipt', label: 'سند قبض', icon: <ArrowDownLeft />, color: '#34C759', perm: 'treasury.create' },
      { to: '/docs/new/payment', label: 'سند صرف', icon: <ArrowUpRight />, color: '#FF3B30', perm: 'treasury.create' },
      { to: '/docs/new/expense', label: 'مصروف', icon: <Receipt />, color: '#FF9500', perm: 'treasury.create' },
      { to: '/docs/new/income', label: 'إيراد آخر', icon: <TrendingUp />, color: '#34C759', perm: 'treasury.create' },
      { to: '/docs/new/cash_transfer', label: 'تحويل بين الخزائن', icon: <ArrowLeftRight />, color: '#5856D6', perm: 'treasury.create' },
      { to: '/instruments', label: 'الشيكات والأقساط', icon: <CalendarClock />, color: '#AF52DE', perm: 'treasury.view' },
      { to: '/shift', label: 'الوردية', icon: <Clock />, color: '#30B0C7', perm: 'treasury.shift' },
      { to: '/cashboxes', label: 'الخزائن والبنوك', icon: <Wallet />, color: '#007AFF', perm: 'treasury.view' },
      { to: '/docs/list/treasury', label: 'سجل السندات', icon: <FileText />, color: '#30B0C7', perm: 'treasury.view' },
    ],
  },
  {
    title: 'الحسابات',
    items: [
      { to: '/accounts', label: 'دليل الحسابات', icon: <ListTree />, color: '#5856D6', perm: 'accounts.view' },
      { to: '/docs/new/journal_voucher', label: 'قيد يومية', icon: <BookPlus />, color: '#007AFF', perm: 'accounts.journal' },
      { to: '/docs/new/party_opening', label: 'رصيد افتتاحي لطرف', icon: <UserPlus />, color: '#8E8E93', perm: 'accounts.journal' },
      { to: '/reports/trial-balance', label: 'ميزان المراجعة', icon: <Scale />, color: '#34C759', perm: 'reports.financial' },
      { to: '/reports/ledger', label: 'دفتر الأستاذ', icon: <BookOpen />, color: '#A2845E', perm: 'reports.financial' },
      { to: '/reports/income', label: 'قائمة الدخل', icon: <TrendingUp />, color: '#FF9500', perm: 'reports.profit' },
      { to: '/reports/balance-sheet', label: 'الميزانية العمومية', icon: <Landmark />, color: '#5856D6', perm: 'reports.financial' },
      { to: '/docs/list/accounts', label: 'سجل القيود', icon: <FileText />, color: '#30B0C7', perm: 'accounts.view' },
    ],
  },
  {
    title: 'الشركاء',
    items: [{ to: '/partners', label: 'الشركاء وتوزيع الأرباح', icon: <PieChart />, color: '#34C759', perm: 'partners.view' }],
  },
  {
    title: 'التقارير',
    items: [
      { to: '/reports/analysis', label: 'تحليل المبيعات والمشتريات', icon: <TrendingUp />, color: '#5856D6', perm: 'reports.view' },
      { to: '/reports/documents', label: 'تقارير المستندات', icon: <BarChart3 />, color: '#FF2D55', perm: 'reports.view' },
    ],
  },
  {
    title: 'النظام',
    items: [
      { to: '/sync', label: 'مركز المزامنة', icon: <RefreshCw />, color: '#34C759', badge: 'sync' },
      { to: '/users', label: 'المستخدمون والصلاحيات', icon: <ShieldCheck />, color: '#8E8E93', perm: 'users.manage' },
      { to: '/settings', label: 'الإعدادات', icon: <Settings />, color: '#8E8E93' },
      { to: '/backups', label: 'النسخ الاحتياطي', icon: <HardDriveDownload />, color: '#007AFF', perm: 'backup.manage' },
      { to: '/audit', label: 'سجل التدقيق', icon: <ScrollText />, color: '#A2845E', perm: 'audit.view' },
    ],
  },
];

export function SyncPill() {
  const s = useSyncState();
  const c = useSyncCounts();
  const nav = useNavigate();
  const problems = c.rejected + c.conflicts;
  const reachable = s.online && s.serverReachable;
  const cls = problems ? 'error' : !reachable ? 'offline' : c.pending ? 'pending' : 'online';
  const text = problems
    ? `${problems} تحتاج مراجعة`
    : !reachable
      ? c.pending
        ? `دون اتصال · ${c.pending} بالانتظار`
        : 'دون اتصال'
      : c.pending
        ? `${c.pending} بانتظار المزامنة`
        : 'متصل ومتزامن';
  return (
    <button className={`sync-pill ${cls}`} onClick={() => nav('/sync')} title={s.lastError ?? undefined}>
      {s.syncing ? <RefreshCw className="spin" /> : !reachable ? <CloudOff /> : <span className="dot" />}
      <span>{text}</span>
    </button>
  );
}

function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const results = useLiveQuery(async () => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const match = (...v: (string | undefined | null)[]) => v.some((x) => x?.toLowerCase().includes(s));
    const items = (await db.items.filter((i) => match(i.name, i.code, i.barcode)).limit(8).toArray()).map((i) => ({
      key: 'i' + i.id, label: i.name, sub: `صنف · ${i.code}`, to: `/items/inquiry?id=${i.id}`,
    }));
    const parties = (await db.parties.filter((p) => match(p.name, p.code, p.phone)).limit(8).toArray()).map((p) => ({
      key: 'p' + p.id, label: p.name, sub: p.kind === 'customer' ? 'عميل' : 'مورد', to: `/parties/${p.kind}/${p.id}`,
    }));
    const docs = (await db.documents.filter((d) => match(d.number, d.local_number)).limit(8).toArray()).map((d) => ({
      key: 'd' + d.id, label: d.number ?? d.local_number, sub: DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES]?.label, to: `/docs/view/${d.id}`,
    }));
    const pages = NAV.flatMap((s2) => s2.items).filter((n) => n.label.includes(q.trim())).slice(0, 5).map((n) => ({ key: 'n' + n.to, label: n.label, sub: 'صفحة', to: n.to }));
    return [...pages, ...items, ...parties, ...docs];
  }, [q]) ?? [];
  const [hl, setHl] = useState(0);
  const go = (to: string) => {
    nav(to);
    onClose();
  };
  return (
    <div className="overlay" style={{ placeItems: 'start center', paddingTop: '12vh' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ width: 'min(620px, 100%)' }}>
        <div style={{ padding: 12 }}>
          <div className="search" style={{ height: 46 }}>
            <Search />
            <input
              autoFocus
              value={q}
              placeholder="ابحث عن صنف، عميل، مورد، رقم مستند أو صفحة..."
              onChange={(e) => {
                setQ(e.target.value);
                setHl(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'ArrowDown') setHl((h) => Math.min(h + 1, results.length - 1));
                if (e.key === 'ArrowUp') setHl((h) => Math.max(h - 1, 0));
                if (e.key === 'Enter' && results[hl]) go(results[hl].to);
              }}
            />
          </div>
        </div>
        {results.length > 0 && (
          <div style={{ padding: '0 8px 8px', maxHeight: 420, overflowY: 'auto' }}>
            {results.map((r, i) => (
              <div key={r.key} className={`picker-opt ${i === hl ? 'hl' : ''}`} onMouseEnter={() => setHl(i)} onClick={() => go(r.to)}>
                <span style={{ flex: 1 }}>{r.label}</span>
                <span className="muted small">{r.sub}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { session, logout } = useSession();
  const can = usePerm();
  const settings = useSettings();
  const counts = useSyncCounts();
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('erp.nav.collapsed') ?? '{}');
    } catch {
      return {};
    }
  });
  const [scrolled, setScrolled] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    contentRef.current?.scrollTo({ top: 0 });
  }, [loc.pathname]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const sections = useMemo(
    () => NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.perm || can(i.perm)) })).filter((s) => s.items.length),
    [can],
  );
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname === to || loc.pathname.startsWith(to + '/'));
  const toggle = (t: string) => {
    const n = { ...collapsed, [t]: !collapsed[t] };
    setCollapsed(n);
    try {
      localStorage.setItem('erp.nav.collapsed', JSON.stringify(n));
    } catch {
      /* ignore */
    }
  };
  const problems = counts.rejected + counts.conflicts;

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-head">
          <div className="row">
            <div className="sidebar-title" style={{ flex: 1 }}>{settings.company_name || 'الحسابات'}</div>
            <button className="icon-btn only-mobile" onClick={() => setOpen(false)} aria-label="إغلاق القائمة">
              <ChevronDown style={{ transform: 'rotate(-90deg)' }} />
            </button>
          </div>
          <button className="search" style={{ width: '100%', border: 0, cursor: 'pointer' }} onClick={() => setSearchOpen(true)}>
            <Search />
            <span className="muted" style={{ flex: 1, textAlign: 'start' }}>بحث</span>
            <kbd className="hide-mobile">Ctrl K</kbd>
          </button>
        </div>
        <nav className="sidebar-scroll">
          {sections.map((s) => (
            <div className="sb-section" key={s.title || 'main'}>
              {s.title && (
                <div className="sb-section-title" onClick={() => toggle(s.title)}>
                  <span>{s.title}</span>
                  <ChevronDown style={{ width: 15, height: 15, transform: collapsed[s.title] ? 'rotate(90deg)' : undefined, transition: 'transform .2s' }} />
                </div>
              )}
              {!collapsed[s.title] &&
                s.items.map((i) => (
                  <div key={i.to} className={`sb-item ${isActive(i.to) ? 'active' : ''}`} onClick={() => nav(i.to)} role="link">
                    <span className="sb-icon" style={{ background: i.color }}>{i.icon}</span>
                    <span>{i.label}</span>
                    {i.badge === 'sync' && problems > 0 && <span className="badge solid-red">{problems}</span>}
                    {i.badge === 'sync' && !problems && counts.pending > 0 && <span className="badge orange">{counts.pending}</span>}
                  </div>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bold" style={{ fontSize: 15 }}>{session.user.full_name}</div>
            <div className="caption">{session.user.role_name}</div>
          </div>
          <button className="icon-btn" title="تسجيل الخروج" onClick={logout}>
            <LogOut />
          </button>
        </div>
      </aside>

      <main className="main">
        <div className={`nav-bar ${scrolled ? 'scrolled' : ''}`}>
          <button className="icon-btn only-mobile" onClick={() => setOpen(true)} aria-label="القائمة">
            <Menu />
          </button>
          <div className="nav-title" id="nav-title-slot" />
          <div className="spacer" />
          <SyncPill />
          <button className="icon-btn only-mobile" onClick={() => setSearchOpen(true)} aria-label="بحث">
            <Search />
          </button>
        </div>
        <div className="content" ref={contentRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 30)}>
          {children}
        </div>
      </main>

      <nav className="tabbar">
        {[
          { to: '/', label: 'الرئيسية', icon: <Home /> },
          { to: '/docs/new/sale_invoice', label: 'بيع', icon: <ShoppingCart />, perm: 'sales.create' },
          { to: '/items', label: 'الأصناف', icon: <Package />, perm: 'items.view' },
          { to: '/parties/customer', label: 'العملاء', icon: <Users />, perm: 'parties.view' },
        ]
          .filter((t) => !t.perm || can(t.perm))
          .map((t) => (
            <button key={t.to} className={isActive(t.to) ? 'on' : ''} onClick={() => nav(t.to)}>
              {t.icon}
              {t.label}
            </button>
          ))}
        <button onClick={() => setOpen(true)}>
          <LayoutGrid />
          المزيد
        </button>
      </nav>
      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

/** عنوان الصفحة الكبير بأسلوب iPadOS مع أزرار الإجراءات */
export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const slot = document.getElementById('nav-title-slot');
    if (slot && typeof title === 'string') slot.textContent = title;
    if (typeof title === 'string') document.title = `${title} — الحسابات`;
  }, [title]);
  return (
    <div className="row wrap" style={{ alignItems: 'flex-end', marginBottom: 14, gap: 12 }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <h1 className="large-title">{title}</h1>
        {sub && <div className="page-sub" style={{ marginBottom: 0 }}>{sub}</div>}
      </div>
      {actions && <div className="row wrap no-print">{actions}</div>}
    </div>
  );
}

export function refreshNow() {
  void syncNow();
}
