import { Bell, CalendarClock, CircleHelp, LogOut, Moon, Package, Palette, ShieldAlert, Settings, Sun, Truck, Users, Wallet, FileWarning } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkCounts } from '../lib/alerts';
import { GEAR_HUBS, HUBS, SECTIONS, activeHubKey, activeSectionKey, type NavLink, type Section } from './nav';

type Can = (p: string) => boolean;
const allowed = (can: Can, perms: string[]) => !perms.length || perms.some((p) => can(p));
const linksOf = (can: Can, links: NavLink[]) => links.filter((l) => !l.perm || can(l.perm));

/** مجموعات القائمة المنسدلة لقسم: روابطه الإضافية ثم مجموعات أقسامه، بلا تكرار */
function sectionGroups(s: Section, can: Can) {
  const seen = new Set<string>();
  const uniq = (links: NavLink[]) => linksOf(can, links).filter((l) => !seen.has(l.to) && (seen.add(l.to), true));
  const groups: { title: string; links: NavLink[] }[] = [];
  if (s.extra) groups.push({ title: s.label, links: uniq(s.extra) });
  for (const k of s.hubs) for (const g of HUBS.find((h) => h.key === k)?.groups ?? []) groups.push({ title: g.title, links: uniq(g.links) });
  return groups.filter((g) => g.links.length);
}

/** فتح/غلق قائمة: الضغط برّه أو Esc يقفلها، وتغيير الصفحة يقفلها */
function useMenu<T extends string>() {
  const loc = useLocation();
  const [open, setOpen] = useState<T | null>(null);
  const anchors = useRef<Partial<Record<T, HTMLElement | null>>>({});
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(null), [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || anchors.current[open]?.contains(t)) return;
      setOpen(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return { open, setOpen, anchors, pop };
}

function LinkGroups({ groups, onGo, wide }: { groups: { title: string; links: NavLink[] }[]; onGo: (to: string) => void; wide?: boolean }) {
  const loc = useLocation();
  return (
    <div className={`tn-groups ${wide ? 'more' : ''}`}>
      {groups.map((g) => (
        <div key={g.title} className="tn-group">
          <div className="tn-group-t">{g.title}</div>
          {g.links.map((l) => (
            <button key={l.to + l.label} role="menuitem" className={`tn-link ${loc.pathname + loc.search === l.to || loc.pathname === l.to ? 'on' : ''}`} onClick={() => onGo(l.to)}>
              <span className="tn-ic">{l.icon}</span>
              <span className="tn-link-l">{l.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * الشريط الأفقي المشترك لكل الصفحات: الأقسام السبعة بأيقونات وفواصل، والقسم النشط أزرق ممتلئ.
 * الضغط يفتح صفحة القسم، والوقوف بالماوس يفتح قائمة بكل شاشاته.
 */
export function MainNav({ can }: { can: Can }) {
  const nav = useNavigate();
  const loc = useLocation();
  const { open, setOpen, anchors, pop } = useMenu<string>();
  const timer = useRef<number | undefined>(undefined);
  const active = activeSectionKey(loc.pathname);
  const sections = SECTIONS.filter((s) => allowed(can, s.perms));
  const enter = (key: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(key), open ? 0 : 160);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(null), 220);
  };
  const go = (to: string) => {
    window.clearTimeout(timer.current);
    setOpen(null);
    nav(to);
  };
  const openSection = sections.find((s) => s.key === open);
  const groups = openSection ? sectionGroups(openSection, can) : [];
  return (
    <nav className="mc-nav hide-mobile no-print" aria-label="الأقسام">
      <div className="mc-nav-in">
        {sections.map((s) => {
          const hasMenu = sectionGroups(s, can).length > 0;
          return (
            <button
              key={s.key}
              ref={(el) => { anchors.current[s.key] = el; }}
              type="button"
              className={`mc-nav-item ${active === s.key ? 'on' : ''} ${open === s.key ? 'open' : ''}`}
              aria-current={active === s.key ? 'page' : undefined}
              aria-haspopup={hasMenu ? 'menu' : undefined}
              aria-expanded={hasMenu ? open === s.key : undefined}
              onClick={() => go(s.to)}
              onKeyDown={(e) => { if (hasMenu && e.key === 'ArrowDown') { e.preventDefault(); setOpen(s.key); } }}
              onMouseEnter={() => (hasMenu ? enter(s.key) : (window.clearTimeout(timer.current), setOpen(null)))}
              onMouseLeave={() => hasMenu && leave()}
            >
              <span className="mc-nav-ic">{s.icon}</span>
              <span className="mc-nav-l">{s.label}</span>
            </button>
          );
        })}
      </div>
      {openSection && groups.length > 0 && (
        <MenuPanel anchor={anchors.current[openSection.key]} popRef={pop} onEnter={() => window.clearTimeout(timer.current)} onLeave={leave}>
          <button className="tn-hub-link" onClick={() => go(openSection.to)}>
            <span className="tn-ic">{openSection.icon}</span>
            <span><b>{openSection.label}</b><small>افتح صفحة القسم</small></span>
          </button>
          <LinkGroups groups={groups} onGo={go} />
        </MenuPanel>
      )}
    </nav>
  );
}

/** أيقونات الشريط العلوي: الإعدادات (وفيها الحسابات والخزينة والتقارير)، المساعدة، الإشعارات */
export function TopIcons({ can, dark, onToggleTheme, onAppearance, onLogout, onSearch, userName, roleName, syncProblems }: {
  can: Can; dark: boolean; onToggleTheme: () => void; onAppearance: () => void; onLogout: () => void; onSearch: () => void; userName: string; roleName: string; syncProblems: number;
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const { open, setOpen, anchors, pop } = useMenu<'gear' | 'help' | 'bell'>();
  const w = useWorkCounts();
  const go = (to: string) => {
    setOpen(null);
    nav(to);
  };
  const gearGroups = GEAR_HUBS.map((k) => HUBS.find((h) => h.key === k)!)
    .filter((h) => h && (!h.perm || can(h.perm)))
    .map((h) => ({ title: h.label, links: linksOf(can, h.groups.flatMap((g) => g.links)) }))
    .filter((g) => g.links.length);
  const gearActive = GEAR_HUBS.includes(activeHubKey(loc.pathname));
  const alerts: { n: number; label: string; to: string; icon: ReactNode; tone: string }[] = [
    { n: w.review, label: 'عمليات تحتاج مراجعة', to: '/sync', icon: <ShieldAlert />, tone: 'red' },
    { n: w.overdue, label: 'فواتير آجلة متأخرة السداد', to: '/receivables', icon: <FileWarning />, tone: 'red' },
    { n: w.reorder, label: 'أصناف تحت حد الطلب', to: '/reports/reorder', icon: <Package />, tone: 'orange' },
    { n: w.dueSoon, label: 'شيكات وأقساط مستحقة خلال أسبوع', to: '/instruments', icon: <CalendarClock />, tone: 'purple' },
    { n: w.pendingDelivery, label: 'فواتير بانتظار التسليم', to: '/deliveries', icon: <Truck />, tone: 'blue' },
  ].filter((a) => a.n > 0);
  const totalAlerts = alerts.reduce((s, a) => s + a.n, 0);
  const btn = (k: 'gear' | 'help' | 'bell', label: string, icon: ReactNode, extra?: ReactNode, cls = '') => (
    <button
      ref={(el) => { anchors.current[k] = el; }}
      type="button"
      className={`mc-icon-btn ${open === k ? 'open' : ''} ${cls}`}
      title={label}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open === k}
      onClick={() => setOpen((o) => (o === k ? null : k))}
    >
      {icon}
      {extra}
    </button>
  );
  return (
    <>
      {btn('gear', 'الإعدادات والحسابات والتقارير', <Settings />, syncProblems > 0 ? <span className="mc-dot" /> : null, gearActive ? 'on' : '')}
      {btn('help', 'مساعدة', <CircleHelp />)}
      {btn('bell', totalAlerts ? `الإشعارات (${totalAlerts})` : 'الإشعارات', <Bell />, totalAlerts > 0 ? <span className="mc-dot" /> : null)}
      {open === 'gear' && (
        <MenuPanel anchor={anchors.current.gear} popRef={pop}>
          <div className="mc-menu-user">
            <span className="mc-avatar" aria-hidden="true">{(userName || '؟').trim()[0]}</span>
            <span><b>{userName}</b><small>{roleName}</small></span>
          </div>
          <LinkGroups groups={gearGroups} onGo={go} />
          <div className="mc-menu-foot">
            <button className="tn-link" onClick={() => { setOpen(null); onAppearance(); }}><span className="tn-ic"><Palette /></span>تفضيلاتي (المظهر والخط)</button>
            <button className="tn-link" onClick={() => { setOpen(null); onToggleTheme(); }}><span className="tn-ic">{dark ? <Sun /> : <Moon />}</span>{dark ? 'الوضع الفاتح' : 'الوضع الغامق'}</button>
            <button className="tn-link danger" onClick={() => { setOpen(null); onLogout(); }}><span className="tn-ic"><LogOut /></span>تسجيل الخروج</button>
          </div>
        </MenuPanel>
      )}
      {open === 'help' && (
        <MenuPanel anchor={anchors.current.help} popRef={pop}>
          <div className="mc-help">
            <b>فين ألاقي…؟</b>
            <p><Wallet /> <span><b>الخزينة والحسابات والتقارير والإعدادات</b> في زرار الترس <Settings className="inl" /> فوق.</span></p>
            <p><Users /> <span>كل قسم في الشريط الأزرق: اضغط عليه يفتح صفحته، أو وقّف الماوس عليه تظهر كل شاشاته.</span></p>
            <b>اختصارات الكيبورد</b>
            <p><kbd>Ctrl</kbd>+<kbd>K</kbd> <span>بحث عن صنف أو عميل أو فاتورة</span></p>
            <button className="btn sm" onClick={() => { setOpen(null); onSearch(); }}>افتح البحث</button>
          </div>
        </MenuPanel>
      )}
      {open === 'bell' && (
        <MenuPanel anchor={anchors.current.bell} popRef={pop}>
          <div className="mc-bell">
            <div className="tn-group-t">الإشعارات</div>
            {alerts.length ? alerts.map((a) => (
              <button key={a.to} className="tn-link" onClick={() => go(a.to)}>
                <span className={`tn-ic mc-tone-${a.tone}`}>{a.icon}</span>
                <span className="tn-link-l" style={{ flex: 1 }}>{a.label}</span>
                <span className={`mc-count ${a.tone}`}>{a.n}</span>
              </button>
            )) : <div className="mc-empty">مفيش تنبيهات دلوقتي 👍</div>}
          </div>
        </MenuPanel>
      )}
    </>
  );
}

function MenuPanel({ anchor, popRef, children, onEnter, onLeave }: { anchor: HTMLElement | null | undefined; popRef: React.RefObject<HTMLDivElement | null>; children: ReactNode; onEnter?: () => void; onLeave?: () => void }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = popRef.current?.offsetWidth ?? 420;
      // محاذاة يمين القائمة مع يمين الزر (واجهة عربية)، مع إبقائها داخل الشاشة
      let right = window.innerWidth - r.right;
      if (window.innerWidth - right - w < 8) right = Math.max(8, window.innerWidth - w - 8);
      setPos({ top: r.bottom + 6, right });
    };
    place();
    // إعادة الحساب بعد معرفة العرض الفعلي للقائمة
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
    };
  }, [anchor, popRef]);
  return createPortal(
    <div ref={popRef} className="tn-pop" role="menu" style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {children}
    </div>,
    document.body,
  );
}
