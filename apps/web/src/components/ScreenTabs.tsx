import { FileText, Home, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { HUBS, SECTIONS, activeHubKey } from './nav';
import { NewMenu } from './NewMenu';
import { stripTitleSuffix, TITLE_SEP } from '../lib/brand';

/** أيقونة التبويب: أيقونة القسم الذي تنتمي له الشاشة */
function tabIcon(url: string) {
  const path = url.split('?')[0];
  if (path === '/') return <Home />;
  const hub = activeHubKey(path);
  return SECTIONS.find((s) => s.key !== 'home' && s.hubs.includes(hub))?.icon ?? HUBS.find((h) => h.key === hub)?.icon ?? <FileText />;
}

/** اسم احتياطي من روابط القوائم لشاشة لا تضبط عنوانها */
const LINK_LABEL = new Map<string, string>();
for (const h of HUBS) {
  if (h.to) LINK_LABEL.set(h.to, h.label);
  else LINK_LABEL.set(`/hub/${h.key}`, h.label);
  for (const g of h.groups) for (const l of g.links) if (!LINK_LABEL.has(l.to)) LINK_LABEL.set(l.to, l.label);
}

/**
 * تبويبات الشاشات تحت شريط التنقل: كل شاشة تُفتح في تبويب، وتبقى مفتوحة حتى تُغلق.
 * - مفتاح التبويب هو مسار الشاشة؛ ويُحفظ معه آخر رابط كامل (بالفلاتر) وموضع التمرير.
 * - التنقل «استبدال» (مثل حفظ فاتورة ثم عرضها) يستبدل التبويب الحالي بدل فتح تبويب جديد.
 * - الرئيسية تبويب ثابت لا يُغلق. التبويبات تُحفظ لكل مستخدم على هذا الجهاز.
 */
interface Tab {
  key: string;
  url: string;
  title: string;
  scroll?: number;
}

const MAX_TABS = 12;
const HOME: Tab = { key: '/', url: '/', title: 'الرئيسية' };

function load(storeKey: string): { tabs: Tab[]; active: string } {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey) ?? 'null');
    if (v && Array.isArray(v.tabs) && v.tabs.length) {
      const tabs = v.tabs.filter((t: any) => t && typeof t.key === 'string' && typeof t.url === 'string');
      if (!tabs.some((t: Tab) => t.key === '/')) tabs.unshift(HOME);
      return { tabs, active: v.active ?? '/' };
    }
  } catch {
    /* ignore */
  }
  return { tabs: [HOME], active: '/' };
}

export function ScreenTabs({ userId, scrollRef }: { userId: string; scrollRef: RefObject<HTMLDivElement | null> }) {
  const loc = useLocation();
  const navType = useNavigationType();
  const nav = useNavigate();
  const storeKey = `erp.screenTabs.${userId}`;
  const [state, setState] = useState(() => load(storeKey));
  const prevKey = useRef<string | null>(null);
  const restoring = useRef<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // الطباعة شاشة مستقلة لا تُفتح كتبويب
  const skip = loc.pathname.startsWith('/print/');
  const locationParams = new URLSearchParams(loc.search);
  const invoiceTab = locationParams.get('saleTab') ?? locationParams.get('purchaseTab');
  const key = invoiceTab && /^\/docs\/new\/(sale|purchase)_invoice$/.test(loc.pathname)
    ? `${loc.pathname}?${locationParams.has('saleTab') ? 'saleTab' : 'purchaseTab'}=${encodeURIComponent(invoiceTab)}`
    : loc.pathname;
  const url = loc.pathname + loc.search;

  // فتح/تفعيل تبويب مع كل تنقل
  useLayoutEffect(() => {
    if (skip) return;
    setState((s) => {
      // حفظ موضع التمرير للتبويب الذي نغادره
      const leaving = prevKey.current;
      let tabs = s.tabs.map((t) => (t.key === leaving && leaving !== key ? { ...t, scroll: scrollRef.current?.scrollTop ?? 0 } : t));
      const existing = tabs.find((t) => t.key === key);
      if (existing) {
        tabs = tabs.map((t) => (t.key === key ? { ...t, url } : t));
        restoring.current = leaving !== key ? existing.scroll ?? 0 : null;
      } else if (navType === 'REPLACE' && leaving && leaving !== '/' && tabs.some((t) => t.key === leaving)) {
        // نفس التبويب انتقل لشاشة أخرى (حفظ فاتورة ← عرضها)
        tabs = tabs.map((t) => (t.key === leaving ? { key, url, title: t.title } : t));
        restoring.current = 0;
      } else {
        const tab: Tab = { key, url, title: '…' };
        const i = tabs.findIndex((t) => t.key === leaving);
        tabs = i >= 0 ? [...tabs.slice(0, i + 1), tab, ...tabs.slice(i + 1)] : [...tabs, tab];
        // الحد الأقصى: يُغلق أقدم تبويب غير نشط (عدا الرئيسية)
        while (tabs.length > MAX_TABS) {
          const drop = tabs.findIndex((t) => t.key !== '/' && t.key !== key);
          if (drop < 0) break;
          tabs.splice(drop, 1);
        }
        restoring.current = 0;
      }
      return { tabs, active: key };
    });
    prevKey.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url, skip]);

  // استعادة موضع التمرير بعد رسم الشاشة
  useEffect(() => {
    if (restoring.current == null) return;
    const y = restoring.current;
    restoring.current = null;
    const id = requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: y }));
    return () => cancelAnimationFrame(id);
  });

  // عنوان التبويب = عنوان الشاشة (كل صفحة تضبط document.title)
  useEffect(() => {
    const titleEl = document.querySelector('title');
    if (!titleEl || skip) return;
    const setTitle = (t: string) =>
      setState((s) => (s.tabs.some((x) => x.key === key && x.title !== t) ? { ...s, tabs: s.tabs.map((x) => (x.key === key ? { ...x, title: t } : x)) } : s));
    const startTitle = document.title;
    let changed = false;
    const apply = () => {
      // العنوان قبل ما الشاشة تضبطه (اسم الشركة لوحده) ما بيبقاش اسم تبويب
      if (!document.title.includes(TITLE_SEP)) return;
      changed = true;
      const t = stripTitleSuffix(document.title);
      if (t) setTitle(t);
    };
    const mo = new MutationObserver(apply);
    mo.observe(titleEl, { childList: true, characterData: true, subtree: true });
    // شاشة لم تغيّر العنوان: إن كان التبويب قديمًا يبقى اسمه، وإلا اسم الرابط من القوائم
    const timer = setTimeout(() => {
      if (changed) return;
      setState((s) => {
        const tab = s.tabs.find((x) => x.key === key);
        if (!tab || tab.title !== '…') return s;
        const t = LINK_LABEL.get(url) ?? LINK_LABEL.get(key) ?? ((startTitle.includes(TITLE_SEP) && stripTitleSuffix(startTitle)) || 'شاشة');
        return { ...s, tabs: s.tabs.map((x) => (x.key === key ? { ...x, title: t } : x)) };
      });
    }, 400);
    return () => {
      mo.disconnect();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, skip]);

  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, storeKey]);

  // إظهار التبويب النشط داخل الشريط
  useEffect(() => {
    stripRef.current?.querySelector('.st-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [state.active]);

  const close = (k: string) => {
    if (k === '/') return;
    const tab = state.tabs.find((t) => t.key === k);
    if (tab) {
      try {
        const u = new URL(tab.url, window.location.origin);
        if (/^\/docs\/new\/(sale|purchase)_invoice$/.test(u.pathname)) {
          const id = u.searchParams.get('saleTab') ?? u.searchParams.get('purchaseTab') ?? (u.pathname.includes('purchase') ? 'p-default' : 'default');
          const draftKey = `sale-draft-${id}`;
          const hasDraft = Boolean(localStorage.getItem(draftKey));
          if (hasDraft && !window.confirm('هذه الفاتورة تحتوي على مسودة غير محفوظة. هل تريد إغلاق التبويب وحذف المسودة؟')) return;
          if (hasDraft) localStorage.removeItem(draftKey);
        }
      } catch {
        /* إغلاق التبويب لا يتوقف إذا تعذر فحص المسودة */
      }
    }
    const i = state.tabs.findIndex((t) => t.key === k);
    const tabs = state.tabs.filter((t) => t.key !== k);
    setState({ tabs, active: state.active === k ? '' : state.active });
    if (state.active === k) {
      const next = tabs[Math.min(i, tabs.length - 1)] ?? HOME;
      nav(next.url);
    }
  };
  const closeOthers = () => {
    const keep = state.tabs.filter((t) => t.key === '/' || t.key === state.active);
    setState({ tabs: keep, active: state.active });
  };

  return (
    <div className="screen-tabs mc-tabs hide-mobile no-print" role="tablist" aria-label="الشاشات المفتوحة">
      <div className="st-strip" ref={stripRef}>
        {state.tabs.map((t) => {
          const on = t.key === state.active;
          return (
            <div
              key={t.key}
              role="tab"
              aria-selected={on}
              tabIndex={0}
              className={`st-tab ${on ? 'on' : ''} ${t.key === '/' ? 'home' : ''}`}
              title={t.title}
              onClick={() => !on && nav(t.url)}
              onKeyDown={(e) => e.key === 'Enter' && !on && nav(t.url)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  close(t.key);
                }
              }}
            >
              {t.key === '/' ? <Home className="st-home" /> : (
                <>
                  <span className="st-ic" aria-hidden="true">{tabIcon(t.url)}</span>
                  <span className="st-title">{t.title}</span>
                </>
              )}
              {t.key !== '/' && (
                <button
                  type="button"
                  className="st-x"
                  aria-label={`إغلاق ${t.title}`}
                  title="إغلاق"
                  onClick={(e) => {
                    e.stopPropagation();
                    close(t.key);
                  }}
                >
                  <X />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {state.tabs.length > 2 && (
        <button type="button" className="st-close-all" onClick={closeOthers} title="إغلاق كل التبويبات عدا الحالي والرئيسية">
          إغلاق الباقي
        </button>
      )}
      <NewMenu round />
    </div>
  );
}
