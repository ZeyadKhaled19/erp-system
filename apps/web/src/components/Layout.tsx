import { useLiveQuery } from 'dexie-react-hooks';
import { CloudOff, Home, LayoutGrid, LogOut, Menu, Package, Palette, PanelRightClose, PanelRightOpen, RefreshCw, Search, Users, X, Zap } from 'lucide-react';
import { applyAppearance, isPaletteMode, loadAppearance, resolvedTheme, saveAppearance, type ThemeMode } from '../lib/theme';
import { AppearanceSheet } from './Appearance';
import { NewMenu } from './NewMenu';
import { QUICK_ACTIONS } from '../lib/quickActions';
import { hasPermission, WORKSPACES, canUseWorkspace } from '@erp/shared';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DOC_TYPES } from '@erp/shared';
import { db } from '../lib/db';
import { usePerm, useSession, useSettings, useSyncCounts, useSyncState } from '../lib/hooks';
import { syncNow } from '../lib/sync';
import { activeHubKey, HUBS, hubPath } from './nav';
import { ScreenTabs } from './ScreenTabs';
import { MainNav, TopIcons } from './TopNav';
import { searchItems } from '../lib/search';
import { setDocTitle, systemName, useSyncBrand } from '../lib/brand';

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
    <button className={`sync-pill ${cls}`} onClick={() => nav('/sync')} title={s.lastError ?? text} aria-label={text}>
      {s.syncing ? <RefreshCw className="spin" /> : !reachable ? <CloudOff /> : <span className="dot" />}
      <span>{text}</span>
    </button>
  );
}

function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const can = usePerm();
  const { session } = useSession();
  const pages = useMemo(
    () => [
      ...HUBS.filter((h) => !h.perm || can(h.perm)).map((h) => ({ to: hubPath(h), label: h.label })),
      ...HUBS.flatMap((h) => h.groups.flatMap((g) => g.links)).filter((l) => !l.perm || can(l.perm)),
      ...WORKSPACES.filter((w) => canUseWorkspace(w.id, session.user.permissions)).map((w) => ({ to: w.path, label: w.label })),
      ...QUICK_ACTIONS.filter((a) => hasPermission(session.user.permissions, a.perm)).map((a) => ({ to: a.to, label: a.label })),
    ],
    [can, session.user.permissions],
  );
  const results = useLiveQuery(async () => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const match = (...v: (string | undefined | null)[]) => v.some((x) => x?.toLowerCase().includes(s));
    // نتائج البحث لا تعرض إلا ما يملك المستخدم صلاحية مشاهدته
    const items = (can('items.view') ? searchItems(await db.items.toArray(), q).slice(0, 8) : []).map((i) => ({
      key: 'i' + i.id, label: i.name, sub: `صنف · ${i.code}`, to: `/items/inquiry?id=${i.id}`,
    }));
    const parties = (can('parties.view') ? await db.parties.filter((p) => match(p.name, p.code, p.phone)).limit(8).toArray() : []).map((p) => ({
      key: 'p' + p.id, label: p.name, sub: p.kind === 'customer' ? 'عميل' : 'مورد', to: `/parties/${p.kind}/${p.id}`,
    }));
    const docs = (await db.documents.filter((d) => { const m = DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES]?.module; return !!m && can(`${m}.view`) && match(d.number, d.local_number); }).limit(8).toArray()).map((d) => ({
      key: 'd' + d.id, label: d.number ?? d.local_number, sub: DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES]?.label, to: `/docs/view/${d.id}`,
    }));
    const pg = pages.filter((n) => n.label.includes(q.trim())).slice(0, 6).map((n) => ({ key: 'n' + n.to, label: n.label, sub: 'صفحة', to: n.to }));
    return [...pg, ...items, ...parties, ...docs];
  }, [q, pages, session.user.permissions.join(',')]) ?? [];
  const [hl, setHl] = useState(0);
  const go = (to: string) => {
    nav(to);
    onClose();
  };
  return (
    <div className="overlay" style={{ placeItems: 'start center', paddingTop: '12vh' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ width: 'min(620px, 100%)' }}>
        <div style={{ padding: 12 }}>
          <div className="search" style={{ height: 50 }}>
            <Search />
            <input
              autoFocus
              value={q}
              placeholder="ابحث عن صنف، عميل، مورد، رقم فاتورة أو صفحة..."
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

/** تجميع الأقسام في القائمة الجانبية (عرض فقط، الروابط كما هي) */
const HUB_GROUP: Record<string, string> = {
  pos: 'العمليات اليومية',
  invoices: 'العمليات اليومية',
  sales: 'العمليات اليومية',
  purchases: 'العمليات اليومية',
  inventory: 'المخزون والأطراف',
  customers: 'المخزون والأطراف',
  suppliers: 'المخزون والأطراف',
  treasury: 'المالية',
  reports: 'المالية',
  partners: 'المالية',
  employees: 'النظام',
  system: 'النظام',
};

const GROUP_ORDER = ['', 'العمليات اليومية', 'المخزون والأطراف', 'المالية', 'النظام'];

export function Layout({ children }: { children: ReactNode }) {
  const { session, logout } = useSession();
  const can = usePerm();
  const settings = useSettings();
  useSyncBrand(settings);
  const counts = useSyncCounts();
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [appearance, setAppearance] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('erp.sidebar.collapsed') === '1';
    } catch {
      return false;
    }
  });
  const contentRef = useRef<HTMLDivElement>(null);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('erp.sidebar.collapsed', c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  // مظهر المستخدم الحالي (كل مستخدم له اختياراته)
  useEffect(() => applyAppearance(), [session.user.id]);
  const [dark, setDark] = useState(() => resolvedTheme() === 'dark');
  useEffect(() => {
    const h = () => setDark(resolvedTheme() === 'dark');
    window.addEventListener('erp:appearance', h);
    return () => window.removeEventListener('erp:appearance', h);
  }, []);
  const toggleTheme = () => {
    const a = loadAppearance();
    // الرجوع من الغامق إلى آخر وضع فاتح استخدمه المستخدم (فاتح أو سماوي)
    if (resolvedTheme(a) === 'dark') {
      let back: ThemeMode = 'light';
      try {
        const last = localStorage.getItem(`erp.lastLight.${session.user.id}`) ?? 'light';
        back = isPaletteMode(last) ? (last as ThemeMode) : 'light';
      } catch {
        /* ignore */
      }
      saveAppearance({ ...a, theme: back });
    } else {
      try {
        localStorage.setItem(`erp.lastLight.${session.user.id}`, resolvedTheme(a));
      } catch {
        /* ignore */
      }
      saveAppearance({ ...a, theme: 'dark' });
    }
  };

  // التمرير لكل شاشة تديره تبويبات الشاشات (أعلى الصفحة للشاشة الجديدة، وموضعها السابق عند الرجوع لتبويب)
  useEffect(() => setOpen(false), [loc.pathname]);
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

  // ترتيب العرض حسب المجموعات (الروابط نفسها لا تتغير)
  const hubs = HUBS.filter((h) => !h.perm || can(h.perm))
    .map((h, i) => ({ h, i }))
    .sort((x, y) => GROUP_ORDER.indexOf(HUB_GROUP[x.h.key] ?? '') - GROUP_ORDER.indexOf(HUB_GROUP[y.h.key] ?? '') || x.i - y.i)
    .map((x) => x.h);
  const active = activeHubKey(loc.pathname);
  const problems = counts.rejected + counts.conflicts;
  const isPos = loc.pathname.startsWith('/pos');

  return (
    <div className={`app ${collapsed ? 'sb-collapsed' : ''}`}>
      {open && <div className="sb-scrim only-mobile" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="القائمة الرئيسية">
        <div className="sidebar-head">
          <div className="sb-brand">
            {settings.print_logo ? (
              <img className="sb-logo" src={settings.print_logo} alt="" />
            ) : (
              <span className="sb-logo">{(settings.company_name || 'ح').trim()[0]}</span>
            )}
            <div className="sb-brand-t">
              <div className="sidebar-title">{settings.company_name || 'الحسابات'}</div>
              <div className="sb-brand-s">{session.user.role_name}</div>
            </div>
            <button className="icon-btn hide-mobile sb-collapse" onClick={toggleCollapsed} title={collapsed ? 'توسيع القائمة' : 'طي القائمة'} aria-label={collapsed ? 'توسيع القائمة' : 'طي القائمة'}>
              {collapsed ? <PanelRightOpen /> : <PanelRightClose />}
            </button>
            <button className="icon-btn only-mobile" onClick={() => setOpen(false)} aria-label="إغلاق القائمة">
              <X />
            </button>
          </div>
        </div>
        <nav className="sidebar-scroll">
          {hubs.map((h, i) => {
            const g = HUB_GROUP[h.key];
            const prev = i > 0 ? HUB_GROUP[hubs[i - 1].key] : undefined;
            return (
              <div key={h.key}>
                {g && g !== prev && <div className="sb-section-title">{g}</div>}
                <a
                  href={hubPath(h)}
                  className={`sb-item ${active === h.key ? 'active' : ''}`}
                  aria-current={active === h.key ? 'page' : undefined}
                  title={collapsed ? h.label : h.sub}
                  onClick={(e) => {
                    e.preventDefault();
                    nav(hubPath(h));
                  }}
                >
                  <span className="sb-icon">{h.icon}</span>
                  <span className="sb-label">{h.label}</span>
                  {h.key === 'system' && problems > 0 && <span className="badge solid-red">{problems}</span>}
                </a>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="sb-avatar" aria-hidden="true">{(session.user.full_name || '؟').trim()[0]}</span>
          <div className="sb-user">
            <div className="sb-user-n">{session.user.full_name}</div>
            <div className="sb-user-r">{session.user.username}</div>
          </div>
          <button className="icon-btn" title="تفضيلاتي" aria-label="تفضيلاتي" onClick={() => setAppearance(true)}>
            <Palette />
          </button>
          <button className="icon-btn" title="تسجيل الخروج" aria-label="تسجيل الخروج" onClick={logout}>
            <LogOut />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className={`nav-bar mc-top ${scrolled ? 'scrolled' : ''}`}>
          <div className="mc-id">
            <button className="icon-btn only-mobile" onClick={() => setOpen(true)} aria-label="القائمة">
              <Menu />
            </button>
            <a href="/" className="mc-brand" title={settings.company_name || 'الرئيسية'} onClick={(e) => { e.preventDefault(); nav('/'); }}>
              {settings.print_logo ? (
                <img className="mc-logo-img" src={settings.print_logo} alt={settings.company_name || ''} />
              ) : (
                <>
                  <span className="mc-logo">{(settings.company_name || 'ح').trim()[0]}</span>
                  <span className="mc-company">{settings.company_name || 'شركتي'}</span>
                </>
              )}
              <span className="mc-brand-sep hide-mobile" aria-hidden="true" />
              <span className="mc-system hide-mobile">{systemName({ system_name: settings.system_name ?? '' })}</span>
            </a>
            <div className="nav-title" id="nav-title-slot" />
            <div className="spacer" />
            <button className="mc-search hide-mobile" onClick={() => setSearchOpen(true)} title="بحث (Ctrl K)" aria-label="بحث">
              <Search />
              <span>بحث</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="only-mobile"><NewMenu /></span>
            <SyncPill />
            <button className="icon-btn only-mobile" onClick={() => setSearchOpen(true)} aria-label="بحث">
              <Search />
            </button>
            <TopIcons
              can={can}
              dark={dark}
              onToggleTheme={toggleTheme}
              onAppearance={() => setAppearance(true)}
              onLogout={logout}
              onSearch={() => setSearchOpen(true)}
              userName={session.user.full_name}
              roleName={session.user.role_name}
              syncProblems={problems}
            />
          </div>
          <MainNav can={can} />
        </header>
        <ScreenTabs userId={session.user.id} scrollRef={contentRef} />
        <div className="content" ref={contentRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 30)} style={isPos ? { overflow: 'hidden' } : undefined}>
          {children}
        </div>
      </main>

      <nav className="tabbar">
        {[
          { to: '/', label: 'الرئيسية', icon: <Home /> },
          { to: '/pos', label: 'بيع سريع', icon: <Zap />, perm: 'sales.create' },
          { to: '/items', label: 'الأصناف', icon: <Package />, perm: 'items.view' },
          { to: '/parties/customer', label: 'العملاء', icon: <Users />, perm: 'parties.view' },
        ]
          .filter((t) => !t.perm || can(t.perm))
          .map((t) => (
            <button key={t.to} className={(t.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(t.to)) ? 'on' : ''} onClick={() => nav(t.to)}>
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
      {appearance && <AppearanceSheet onClose={() => setAppearance(false)} />}
    </div>
  );
}

/** عنوان الصفحة الكبير بأسلوب iPadOS مع أزرار الإجراءات */
export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const slot = document.getElementById('nav-title-slot');
    if (slot && typeof title === 'string') slot.textContent = title;
    if (typeof title === 'string') setDocTitle(`${title}`);
  }, [title]);
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h1 className="large-title">{title}</h1>
        {sub && <div className="page-sub" style={{ marginBottom: 0 }}>{sub}</div>}
      </div>
      {actions && <div className="page-head-actions no-print">{actions}</div>}
    </div>
  );
}

export function refreshNow() {
  void syncNow();
}
