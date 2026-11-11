import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, CloudOff, Home, LayoutGrid, LogOut, Menu, Package, RefreshCw, Search, Users, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DOC_TYPES } from '@erp/shared';
import { db } from '../lib/db';
import { usePerm, useSession, useSettings, useSyncCounts, useSyncState } from '../lib/hooks';
import { syncNow } from '../lib/sync';
import { activeHubKey, HUBS, hubPath } from './nav';

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
  const can = usePerm();
  const pages = useMemo(
    () => [
      ...HUBS.filter((h) => !h.perm || can(h.perm)).map((h) => ({ to: hubPath(h), label: h.label })),
      ...HUBS.flatMap((h) => h.groups.flatMap((g) => g.links)).filter((l) => !l.perm || can(l.perm)),
    ],
    [can],
  );
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
    const pg = pages.filter((n) => n.label.includes(q.trim())).slice(0, 6).map((n) => ({ key: 'n' + n.to, label: n.label, sub: 'صفحة', to: n.to }));
    return [...pg, ...items, ...parties, ...docs];
  }, [q, pages]) ?? [];
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

export function Layout({ children }: { children: ReactNode }) {
  const { session, logout } = useSession();
  const can = usePerm();
  const settings = useSettings();
  const counts = useSyncCounts();
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
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

  const hubs = HUBS.filter((h) => !h.perm || can(h.perm));
  const active = activeHubKey(loc.pathname);
  const problems = counts.rejected + counts.conflicts;
  const isPos = loc.pathname.startsWith('/pos');

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-head">
          <div className="row">
            {settings.print_logo && <img src={settings.print_logo} alt="" style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 8 }} />}
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
        <nav className="sidebar-scroll" style={{ paddingTop: 10 }}>
          {hubs.map((h) => (
            <div key={h.key} className={`sb-item ${active === h.key ? 'active' : ''}`} onClick={() => nav(hubPath(h))} role="link">
              <span className="sb-icon" style={{ background: h.grad }}>{h.icon}</span>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                <span>{h.label}</span>
                <span className="sb-sub">{h.sub}</span>
              </span>
              {h.key === 'system' && problems > 0 && <span className="badge solid-red">{problems}</span>}
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
    <div className="row wrap" style={{ alignItems: 'flex-end', marginBottom: 18, gap: 12 }}>
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
