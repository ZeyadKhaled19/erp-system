import { DOC_TYPES, formatMoney, hasPermission, todayISO } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Bell, Box, CalendarClock, CalendarDays, Check, ChevronLeft, Coins, FilePlus2, Fingerprint, FileText, Layers, Package, RotateCcw, ShieldAlert, ShoppingCart, SlidersHorizontal, Truck, Users, Wallet, Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DocStatusBadge } from '../components/ui';
import { Hint } from '../components/Hint';
import { HomeKpis } from '../components/HomeKpis';
import { ActivityCard, KpiStrip } from '../components/HomeOverview';
import { GEAR_HUBS, HUBS, SECTIONS, type SectionColor } from '../components/nav';
import { db } from '../lib/db';
import { useWorkCounts } from '../lib/alerts';
import { QUICK_ACTIONS, recordUse } from '../lib/quickActions';
import { usePerm, useSession, useSettings } from '../lib/hooks';
import { setDocTitle, systemName } from '../lib/brand';

export function Dashboard() {
  useEffect(() => {
    const slot = document.getElementById('nav-title-slot');
    if (slot) slot.textContent = 'الرئيسية';
    setDocTitle('الرئيسية');
  }, []);
  const nav = useNavigate();
  const can = usePerm();
  const { session } = useSession();
  const settings = useSettings();
  const [editCards, setEditCards] = useState(false);
  const perms = session.user.permissions;
  const permsKey = perms.join(',');
  const allowedDocTypes = useMemo(() => Object.entries(DOC_TYPES)
    .filter(([, meta]) => !!meta.module && hasPermission(perms, `${meta.module}.view`))
    .map(([type]) => type), [permsKey]);
  const allowedTypesKey = allowedDocTypes.join(',');
  const recent = useLiveQuery(async () => {
    if (!allowedDocTypes.length) return [];
    // اقرأ آخر المستندات من الأنواع المسموح بها فقط؛ لا نجلب مستندات الأقسام المحجوبة ثم نخفيها.
    const batches = await Promise.all(allowedDocTypes.map((type) => db.documents
      .where('[doc_type+date]')
      .between([type, '0000-01-01'], [type, '9999-12-31'], true, true)
      .reverse()
      .limit(30)
      .toArray()));
    return batches.flat()
      .sort((a, b) => String(b.created_at ?? b.date).localeCompare(String(a.created_at ?? a.date)))
      .slice(0, 5);
  }, [allowedTypesKey]);

  const partyNames = useLiveQuery(async () => {
    const ids = [...new Set((recent ?? []).map((d) => d.party_id).filter(Boolean))] as string[];
    const rows = ids.length ? await db.parties.bulkGet(ids) : [];
    return new Map(rows.filter(Boolean).map((p) => [p!.id, p!.name as string]));
  }, [recent]);

  // الترتيب زي التصميم المعتمد بالظبط: الترحيب ← حركة الشغل + المهام ← المؤشرات ← آخر العمليات + إجراءات سريعة
  // وبعده باقي مميزات الرئيسية اللي كانت موجودة (ملخص الأداء بالفترات والكروت) من غير ما يتشال حاجة.
  return (
    <div className="page mc-home home-ds">
      <HomeHeader system={systemName({ system_name: settings.system_name ?? '' })} company={settings.company_name || ''} name={session.user.full_name} />

      <div className="home-row home-row-top">
        <QuickTasks />
        <ActivityCard />
      </div>

      <KpiStrip />

      <div className="home-row home-row-bottom">
        <Favorites />
        <section className="ds-card home-recent" aria-labelledby="home-recent-t">
          <div className="ds-card-h">
            <h2 id="home-recent-t"><Layers className="ds-ic" /> آخر العمليات <Hint side="start" text="آخر 5 مستندات اتعملت على الجهاز ده من الأقسام اللي عندك صلاحية تشوفها. دوس على أي واحد يفتحه." /></h2>
          </div>
          {recent?.length ? (
            <div className="home-recent-wrap">
              <table className="ds-table">
                <thead>
                  <tr><th>رقم المستند</th><th>النوع</th><th>الطرف</th><th>التاريخ</th><th className="n">القيمة</th><th>الحالة</th></tr>
                </thead>
                <tbody>
                  {recent.map((d) => (
                    <tr key={d.id} className="click" tabIndex={0} onClick={() => nav(`/docs/view/${d.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/docs/view/${d.id}`); }}>
                      <td className="num" data-label="رقم المستند">{d.number ?? d.local_number ?? '—'}</td>
                      <td data-label="النوع">{DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES]?.label ?? d.doc_type}</td>
                      <td data-label="الطرف">{(d.party_id && partyNames?.get(d.party_id)) || <span className="muted">—</span>}</td>
                      <td className="num" data-label="التاريخ">{when(d.created_at, d.date)}</td>
                      <td className="n num" data-label="القيمة"><b>{formatMoney(d.total)}</b> <small>ج.م</small></td>
                      <td data-label="الحالة"><DocStatusBadge status={d.status} sync={d._sync} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="ds-empty">لا توجد عمليات بعد. ابدأ بإضافة الأصناف، ثم فاتورة شراء أو «بيع سريع».</div>
          )}
        </section>
      </div>

      <HomeKpis />

      <div className="home-cards-h">
        <h2>أقسامي</h2>
        {!editCards && <button type="button" className="mc-chip" onClick={() => setEditCards(true)} title="اختار الكروت اللي تظهر في الرئيسية"><SlidersHorizontal /> تخصيص الكروت</button>}
      </div>
      <HomeCards editing={editCards} onDone={() => setEditCards(false)} />
    </div>
  );
}

/** «2025-01-23 17:42» من وقت التسجيل، أو التاريخ بس لو الوقت مش معروف */
function when(created: string | undefined, date: string) {
  const t = created ? new Date(created) : null;
  if (!t || Number.isNaN(t.getTime()) || todayISO(t) !== date) return date;
  return `${date} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

/** «مرحبًا بك في نظام …» + سطر النظرة العامة، والتاريخ على الشمال (بيتحدث كل نص دقيقة) */
function HomeHeader({ system, company, name }: { system: string; company: string; name: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const date = now.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="home-hello">
      <div className="home-hello-t">
        <h1>مرحبًا بك في نظام <bdi>{system}</bdi></h1>
        <p title={[name.trim(), company].filter(Boolean).join(' · ')}>نظرة عامة على أداء النشاط اليوم</p>
      </div>
      <div className="home-when"><CalendarDays /> <span>{date}</span></div>
    </div>
  );
}

/** «مهامي السريعة»: أرقام حقيقية من بيانات الجهاز، وكل سطر يظهر لمن يملك صلاحيته */
function QuickTasks() {
  const nav = useNavigate();
  const can = usePerm();
  const w = useWorkCounts();
  const rows: { show: boolean; n: number; label: string; sub: string; to: string; icon: ReactNode; tone: string; title?: string }[] = [
    { show: can('sales.view'), n: w.overdue, label: 'فواتير مبيعات غير مسددة', sub: `يوجد ${w.overdue} فواتير آجلة عدّى ميعاد سدادها`, to: '/receivables', icon: <FileText />, tone: 'red', title: 'فواتير بيع آجلة عدّى ميعاد سدادها' },
    { show: can('inventory.view'), n: w.reorder, label: 'أصناف وصلت لحد إعادة الطلب', sub: `يوجد ${w.reorder} أصناف بحاجة إلى إعادة طلب`, to: '/reports/reorder', icon: <Package />, tone: 'orange' },
    { show: can('parties.view'), n: w.customers, label: 'مستحقات على العملاء', sub: `إجمالي المستحق ${formatMoney(w.customersAmount)} ج.م`, to: '/parties/customer', icon: <Users />, tone: 'blue', title: `إجمالي المستحق: ${formatMoney(w.customersAmount)}` },
    { show: can('parties.view'), n: w.suppliers, label: 'مستحقات للموردين', sub: `إجمالي المستحق ${formatMoney(w.suppliersAmount)} ج.م`, to: '/parties/supplier', icon: <Truck />, tone: 'blue', title: `إجمالي المستحق: ${formatMoney(w.suppliersAmount)}` },
    { show: true, n: w.review, label: 'عمليات تحتاج مراجعة', sub: `يوجد ${w.review} عمليات مرفوضة أو فيها تعارض`, to: '/sync', icon: <ShieldAlert />, tone: 'red' },
    { show: can('treasury.view'), n: w.dueSoon, label: 'شيكات وأقساط مستحقة', sub: `يوجد ${w.dueSoon} مستحقة خلال أسبوع`, to: '/instruments', icon: <CalendarClock />, tone: 'orange' },
    { show: can('sales.view'), n: w.pendingDelivery, label: 'فواتير بانتظار التسليم', sub: `يوجد ${w.pendingDelivery} فواتير لسه متسلمتش`, to: '/deliveries', icon: <Truck />, tone: 'blue' },
  ];
  const list = rows.filter((r) => r.show && r.n > 0);
  return (
    <section className="ds-card home-tasks" aria-labelledby="mc-tasks-t">
      <div className="ds-card-h">
        <h2 id="mc-tasks-t"><Bell className="ds-ic" /> مهام تحتاج متابعة <Hint side="start" text="حاجات محتاجة منك تتصرف فيها دلوقتي: فواتير آجلة عدّى ميعادها، أصناف قربت تخلص، وفلوس على العملاء أو للموردين. الرقم = عدد الحالات، ودوس على السطر يفتحها." /></h2>
        {list.length > 0 && <span className="ds-pill brand num">{list.length} مهام</span>}
      </div>
      {list.length ? (
        <div className="home-task-list">
          {list.map((r) => (
            <button key={r.label} type="button" className={`home-task tone-${r.tone}`} title={r.title} onClick={() => nav(r.to)}>
              <span className="home-task-n num">{r.n}</span>
              <span className="home-task-t">
                <span className="home-task-l">{r.label}</span>
                <span className="home-task-s">{r.sub}</span>
              </span>
              <ChevronLeft className="home-task-chev" />
            </button>
          ))}
        </div>
      ) : (
        <div className="ds-empty">مفيش مهام محتاجة متابعة دلوقتي.</div>
      )}
    </section>
  );
}

/** أيقونات وأسماء المفضلة (الباقي يستخدم أيقونة واسم الإجراء نفسه) */
const FAV_ICONS: Record<string, ReactNode> = {
  sale_invoice: <FilePlus2 />, purchase_invoice: <ShoppingCart />, item_new: <Box />, receipt: <Coins />, pos: <Zap />,
  purchase_return: <RotateCcw />, payment: <Wallet />, attendance: <Fingerprint />,
};
const FAV_LABEL: Record<string, string> = {
  sale_invoice: 'فاتورة بيع جديدة', purchase_invoice: 'فاتورة شراء', item_new: 'إضافة صنف', receipt: 'قبض من عميل',
};
/** الافتراضي؛ ونكمل للستة من الباقي حسب صلاحيات المستخدم */
const MAX_FAVS = 6;
// زي التصميم: بيع، شراء، قبض، صنف (والمستخدم يقدر يزود لحد 6 من «تخصيص»)
const FAV_DEFAULT = ['sale_invoice', 'purchase_invoice', 'receipt', 'item_new'];
const favKey = (uid: string) => `erp.favorites.v1.${uid}`;
function readFavs(uid: string): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(favKey(uid)) ?? 'null');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/** «إجراءات سريعة»: لحد 6 أزرار، الأول برتقالي ممتلئ والباقي بحد، و«تخصيص» يحفظ اختيار كل مستخدم على الجهاز */
function Favorites() {
  const nav = useNavigate();
  const { session } = useSession();
  const uid = session.user.id;
  const perms = session.user.permissions;
  const available = useMemo(() => QUICK_ACTIONS.filter((a) => hasPermission(perms, a.perm)), [perms]);
  const [saved, setSaved] = useState<string[] | null>(() => readFavs(uid));
  useEffect(() => setSaved(readFavs(uid)), [uid]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const pick = (keys: string[]) => keys.map((k) => available.find((a) => a.key === k)).filter((a): a is (typeof available)[number] => !!a);
  const chosen = (saved ? pick(saved) : pick(FAV_DEFAULT)).slice(0, MAX_FAVS);
  const startEdit = () => {
    setDraft(chosen.map((a) => a.key));
    setEditing(true);
  };
  const toggle = (k: string) => setDraft((d) => (d.includes(k) ? d.filter((x) => x !== k) : d.length >= MAX_FAVS ? d : [...d, k]));
  const save = () => {
    try {
      localStorage.setItem(favKey(uid), JSON.stringify(draft));
    } catch {
      /* التخزين غير متاح: يُحفظ للجلسة الحالية فقط */
    }
    setSaved(draft);
    setEditing(false);
  };
  return (
    <section className="ds-card home-actions" aria-labelledby="mc-favs-t">
      <div className="ds-card-h">
        <h2 id="mc-favs-t"><Zap className="ds-ic" /> إجراءات سريعة <Hint side="start" text="أسرع طريق للعمليات اللي بتعملها كتير. «تخصيص» يخليك تختار لحد 6 بالترتيب، والأول بيظهر برتقالي. الاختيار بيتحفظ ليك على الجهاز ده." /></h2>
        {available.length > 0 && (editing ? (
          <span className="mc-fav-tools">
            <button type="button" className="mc-chip" onClick={() => setEditing(false)}>إلغاء</button>
            <button type="button" className="mc-chip primary" onClick={save} disabled={!draft.length}><Check /> حفظ</button>
          </span>
        ) : (
          <button type="button" className="mc-chip" onClick={startEdit}><SlidersHorizontal /> تخصيص</button>
        ))}
      </div>
      {editing ? (
        <div className="mc-fav-pick">
          <div className="mc-fav-hint">اختار لحد {MAX_FAVS} اختصارات بالترتيب ({draft.length}/{MAX_FAVS}) — الأول بيظهر برتقالي.</div>
          <div className="mc-fav-opts">
            {available.map((a) => {
              const i = draft.indexOf(a.key);
              return (
                <button key={a.key} type="button" className={`mc-fav-opt ${i >= 0 ? 'on' : ''}`} aria-pressed={i >= 0} onClick={() => toggle(a.key)} disabled={i < 0 && draft.length >= MAX_FAVS}>
                  {i >= 0 && <b className="num">{i + 1}</b>}
                  <span className="mc-fav-ic">{FAV_ICONS[a.key] ?? a.icon}</span>
                  {FAV_LABEL[a.key] ?? a.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : chosen.length ? (
        <div className="home-action-list">
          {chosen.map((a, i) => (
            <button key={a.key} type="button" className={`ds-btn ${i === 0 ? 'primary' : 'outline'} home-action fav-${a.key}`} title={a.group} onClick={() => { recordUse(uid, a.key); nav(a.to); }}>
              <span className="home-action-ic">{FAV_ICONS[a.key] ?? a.icon}</span>
              <span className="home-action-l">{FAV_LABEL[a.key] ?? a.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="ds-empty">مفيش اختصارات متاحة لصلاحياتك.</div>
      )}
    </section>
  );
}

/** كل الشاشات اللي ينفع تبقى كارت في الرئيسية: الأقسام أولًا، ثم صفحات كل قسم بلونه */
interface CardOpt { key: string; label: string; icon: ReactNode; color: SectionColor; to: string; perms: string[]; group: string }
const CARD_OPTIONS: CardOpt[] = (() => {
  const homeSections = SECTIONS.filter((s) => s.homeCard !== false);
  const out: CardOpt[] = homeSections.map((s) => ({ key: `sec:${s.key}`, label: s.label, icon: s.cardIcon, color: s.color, to: s.to, perms: s.perms, group: 'الأقسام' }));
  const seen = new Set(out.map((o) => o.to));
  const add = (hubKey: string, color: SectionColor, group: string) => {
    const h = HUBS.find((x) => x.key === hubKey);
    if (!h) return;
    if (h.to && !seen.has(h.to)) {
      seen.add(h.to);
      out.push({ key: h.to, label: h.label, icon: h.icon, color, to: h.to, perms: h.perm ? [h.perm] : [], group });
    }
    for (const g of h.groups) for (const l of g.links) {
      if (seen.has(l.to)) continue;
      seen.add(l.to);
      out.push({ key: l.to, label: l.label, icon: l.icon, color, to: l.to, perms: l.perm ? [l.perm] : [], group });
    }
  };
  for (const s of homeSections) for (const hk of s.hubs) add(hk, s.color, s.label);
  for (const hk of GEAR_HUBS) add(hk, 'indigo', HUBS.find((x) => x.key === hk)?.label ?? '');
  return out;
})();
const MAX_CARDS = 8;
const CARDS_DEFAULT = SECTIONS.filter((s) => s.homeCard !== false).map((s) => `sec:${s.key}`);
const cardsKey = (uid: string) => `erp.homeCards.v1.${uid}`;
function readCards(uid: string): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(cardsKey(uid)) ?? 'null');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/** كروت الرئيسية: افتراضيًا أقسام الشريط، و«تخصيص الكروت» يخلي كل مستخدم يختار لحد 8 شاشات بالترتيب (تتحفظ على الجهاز) */
function HomeCards({ editing, onDone }: { editing: boolean; onDone: () => void }) {
  const nav = useNavigate();
  const { session } = useSession();
  const uid = session.user.id;
  const perms = session.user.permissions;
  const available = useMemo(() => CARD_OPTIONS.filter((o) => !o.perms.length || o.perms.some((p) => hasPermission(perms, p))), [perms]);
  const [saved, setSaved] = useState<string[] | null>(() => readCards(uid));
  useEffect(() => setSaved(readCards(uid)), [uid]);
  const pick = (keys: string[]) => keys.map((k) => available.find((o) => o.key === k)).filter((o): o is CardOpt => !!o);
  const chosen = (saved ? pick(saved) : pick(CARDS_DEFAULT)).slice(0, MAX_CARDS);
  const [draft, setDraft] = useState<string[]>([]);
  useEffect(() => {
    if (editing) setDraft(chosen.map((o) => o.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const toggle = (k: string) => setDraft((d) => (d.includes(k) ? d.filter((x) => x !== k) : d.length >= MAX_CARDS ? d : [...d, k]));
  const save = (keys: string[] | null) => {
    try {
      if (keys) localStorage.setItem(cardsKey(uid), JSON.stringify(keys));
      else localStorage.removeItem(cardsKey(uid));
    } catch {
      /* التخزين غير متاح: يُحفظ للجلسة الحالية فقط */
    }
    setSaved(keys);
    onDone();
  };

  if (editing) {
    const groups = [...new Set(available.map((o) => o.group))];
    return (
      <section className="mc-panel mc-cards-pick" aria-labelledby="mc-cards-t">
        <div className="mc-panel-h">
          <h2 id="mc-cards-t"><SlidersHorizontal className="mc-panel-ic" /> تخصيص الكروت</h2>
          <span className="mc-fav-tools">
            <button type="button" className="mc-chip" onClick={() => save(null)}><RotateCcw /> الافتراضي</button>
            <button type="button" className="mc-chip" onClick={onDone}>إلغاء</button>
            <button type="button" className="mc-chip primary" onClick={() => save(draft)} disabled={!draft.length}><Check /> حفظ</button>
          </span>
        </div>
        <div className="mc-fav-pick">
          <div className="mc-fav-hint">اختار لحد {MAX_CARDS} كروت بالترتيب ({draft.length}/{MAX_CARDS}). ممكن تحط شاشات بتستخدمها كتير بدل الأقسام اللي موجودة في الشريط فوق.</div>
          {groups.map((g) => (
            <div key={g} className="mc-fav-pick">
              <div className="mc-pick-group">{g}</div>
              <div className="mc-fav-opts">
                {available.filter((o) => o.group === g).map((o) => {
                  const i = draft.indexOf(o.key);
                  return (
                    <button key={o.key} type="button" className={`mc-fav-opt mc-${o.color} ${i >= 0 ? 'on' : ''}`} aria-pressed={i >= 0} onClick={() => toggle(o.key)} disabled={i < 0 && draft.length >= MAX_CARDS}>
                      {i >= 0 && <b className="num">{i + 1}</b>}
                      <span className="mc-fav-ic" style={{ color: 'var(--c)' }}>{o.icon}</span>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="mc-cards" role="list">
      {chosen.map((o) => (
        <button key={o.key} type="button" role="listitem" className={`mc-card mc-${o.color} ${o.key === 'sec:home' ? 'on' : ''}`} aria-current={o.key === 'sec:home' ? 'page' : undefined} onClick={() => nav(o.to)}>
          <span className="mc-card-ic">{o.icon}</span>
          <span className="mc-card-l">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
