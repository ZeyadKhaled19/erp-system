import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Hub } from './nav';
import { hubPath } from './nav';

/**
 * القوائم العلوية (سطح المكتب): كل قسم زر في الشريط العلوي؛ الأقسام التي فيها صفحات
 * متعددة تفتح قائمة منسدلة بمجموعاتها، والباقي رابط مباشر. توفّر عرض الصفحة كاملًا.
 */
export function TopNav({ hubs, active, can, badge }: { hubs: Hub[]; active: string; can: (p: string) => boolean; badge?: Record<string, number> }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState<string | null>(null);
  const btns = useRef<Record<string, HTMLButtonElement | null>>({});
  const pop = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => setOpen(null), [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || btns.current[open]?.contains(t)) return;
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

  const go = (to: string) => {
    setOpen(null);
    nav(to);
  };
  const enter = (key: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(key), open ? 0 : 120);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(null), 220);
  };

  // الأقسام التي لا تتسع في الشريط تنتقل إلى «المزيد»
  const wrap = useRef<HTMLElement>(null);
  const widths = useRef<Record<string, number>>({});
  const [fit, setFit] = useState(hubs.length);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      for (const h of hubs) {
        const b = btns.current[h.key];
        if (b && b.offsetWidth) widths.current[h.key] = b.offsetWidth + 2;
      }
      const avail = el.clientWidth;
      const total = hubs.reduce((a, h) => a + (widths.current[h.key] ?? 90), 0);
      if (total <= avail) return setFit(hubs.length);
      let used = 96; // زر «المزيد»
      let k = 0;
      while (k < hubs.length && used + (widths.current[hubs[k].key] ?? 90) <= avail) used += widths.current[hubs[k++].key] ?? 90;
      setFit(k);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hubs.map((h) => h.key).join(), badge?.system]);
  const overflow = hubs.slice(fit);
  const activeInMore = overflow.some((h) => h.key === active);

  const groupsOf = (h: Hub) => h.groups.map((g) => ({ ...g, links: g.links.filter((l) => !l.perm || can(l.perm)) })).filter((g) => g.links.length);
  const openHub = hubs.find((h) => h.key === open);
  const moreGroups = overflow.map((h) => ({ title: h.label, links: h.to ? [{ to: hubPath(h), label: h.label, icon: h.icon }] : groupsOf(h).flatMap((g) => g.links) }));

  return (
    <nav className="topnav-menus" aria-label="الأقسام" ref={wrap}>
      {hubs.map((h, i) => {
        const groups = groupsOf(h);
        const menu = !h.to && groups.length > 0;
        const n = badge?.[h.key] ?? 0;
        return (
          <button
            key={h.key}
            ref={(el) => { btns.current[h.key] = el; }}
            className={`tn-item ${active === h.key ? 'active' : ''} ${open === h.key ? 'open' : ''}`}
            style={i >= fit ? { position: 'absolute', visibility: 'hidden', pointerEvents: 'none' } : undefined}
            tabIndex={i >= fit ? -1 : undefined}
            aria-current={active === h.key ? 'page' : undefined}
            aria-haspopup={menu ? 'menu' : undefined}
            aria-expanded={menu ? open === h.key : undefined}
            title={h.sub}
            onClick={() => (menu ? setOpen((o) => (o === h.key ? null : h.key)) : go(hubPath(h)))}
            onMouseEnter={() => (menu ? enter(h.key) : open && setOpen(null))}
            onMouseLeave={() => menu && leave()}
          >
            <span className="tn-ic">{h.icon}</span>
            <span className="tn-label">{h.label}</span>
            {menu && <ChevronDown className="tn-caret" />}
            {n > 0 && <span className="badge solid-red">{n}</span>}
          </button>
        );
      })}
      {overflow.length > 0 && (
        <button
          ref={(el) => { btns.current.__more = el; }}
          className={`tn-item ${activeInMore ? 'active' : ''} ${open === '__more' ? 'open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open === '__more'}
          onClick={() => setOpen((o) => (o === '__more' ? null : '__more'))}
          onMouseEnter={() => enter('__more')}
          onMouseLeave={leave}
        >
          <MoreHorizontal className="tn-caret" style={{ opacity: 1, width: 16, height: 16 }} />
          <span className="tn-label">المزيد</span>
        </button>
      )}
      {open === '__more' && (
        <MenuPanel anchor={btns.current.__more} popRef={pop} onEnter={() => window.clearTimeout(timer.current)} onLeave={leave}>
          <div className="tn-groups more">
            {moreGroups.map((g) => (
              <div key={g.title} className="tn-group">
                <div className="tn-group-t">{g.title}</div>
                {g.links.map((l) => (
                  <button key={l.to + l.label} role="menuitem" className={`tn-link ${loc.pathname === l.to ? 'on' : ''}`} onClick={() => go(l.to)}>
                    <span className="tn-ic">{l.icon}</span>
                    <span className="tn-link-l">{l.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </MenuPanel>
      )}
      {openHub && (
        <MenuPanel anchor={btns.current[openHub.key]} popRef={pop} onEnter={() => window.clearTimeout(timer.current)} onLeave={leave}>
          <button className="tn-hub-link" onClick={() => go(hubPath(openHub))}>
            <span className="tn-ic">{openHub.icon}</span>
            <span><b>{openHub.label}</b><small>{openHub.sub}</small></span>
          </button>
          <div className="tn-groups">
            {groupsOf(openHub).map((g) => (
              <div key={g.title} className="tn-group">
                <div className="tn-group-t">{g.title}</div>
                {g.links.map((l) => (
                  <button key={l.to + l.label} role="menuitem" className={`tn-link ${loc.pathname === l.to ? 'on' : ''}`} onClick={() => go(l.to)}>
                    <span className="tn-ic">{l.icon}</span>
                    <span className="tn-link-l">{l.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </MenuPanel>
      )}
    </nav>
  );
}

function MenuPanel({ anchor, popRef, children, onEnter, onLeave }: { anchor: HTMLElement | null | undefined; popRef: React.RefObject<HTMLDivElement | null>; children: React.ReactNode; onEnter: () => void; onLeave: () => void }) {
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
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, popRef]);
  return createPortal(
    <div ref={popRef} className="tn-pop" role="menu" style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {children}
    </div>,
    document.body,
  );
}
