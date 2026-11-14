import { hasPermission } from '@erp/shared';
import { CalendarDays, Check, ChevronLeft, Clock3, SlidersHorizontal, Zap } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/hooks';
import { QUICK_ACTIONS, recordUse } from '../lib/quickActions';
import '../sections.css';

/**
 * نظام صفحات الأقسام الموحد (نفس صورة المبيعات المعتمدة):
 * عنوان مدمج ← صف مؤشرات ← العمليات السريعة ← محتوى رئيسي (ثلثين) + متابعة (ثلث).
 */

export type SectionColor = 'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'red' | 'teal' | 'indigo' | 'slate';

/** عنوان القسم: أيقونة + اسم + وصف، وعلى الشمال التاريخ والوقت أو أدوات القسم */
export function SectionHeader({ icon, color = 'blue', title, sub, tools, clock = true }: { icon: ReactNode; color?: SectionColor; title: string; sub?: string; tools?: ReactNode; clock?: boolean }) {
  useEffect(() => {
    document.title = `${title} — الحسابات`;
    const slot = document.getElementById('nav-title-slot');
    if (slot) slot.textContent = title;
  }, [title]);
  return (
    <div className="sx-head">
      <div className="sx-title">
        <span className={`sx-title-ic c-${color}`} aria-hidden="true">{icon}</span>
        <div>
          <h1>{title}</h1>
          {sub && <div className="sx-sub">{sub}</div>}
        </div>
      </div>
      {(tools || clock) && (
        <div className="sx-tools">
          {tools}
          {clock && <SectionClock />}
        </div>
      )}
    </div>
  );
}

function SectionClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const date = now.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="sx-when">
      <span><CalendarDays /> {date}</span>
      <i aria-hidden="true" />
      <span className="num"><Clock3 /> {time}</span>
    </div>
  );
}

export interface SectionStat {
  key: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: ReactNode;
  color: SectionColor;
  /** لون الرقم نفسه (افتراضيًا لون العناوين) */
  valueTone?: 'green' | 'red' | 'orange';
  to?: string;
}

/** صف المؤشرات: كروت صغيرة متساوية تلتف تلقائيًا حسب العرض */
export function SectionStats({ items }: { items: SectionStat[] }) {
  const nav = useNavigate();
  if (!items.length) return null;
  return (
    <div className="sx-stats">
      {items.map((s) => (
        <button key={s.key} type="button" className="sx-stat" onClick={() => s.to && nav(s.to)} disabled={!s.to}>
          <span className={`sx-stat-ic c-${s.color}`} aria-hidden="true">{s.icon}</span>
          <span className="sx-stat-t">
            <span className="sx-stat-l">{s.label}</span>
            <b className={`sx-stat-v num ${s.valueTone ?? ''}`}>{s.value}</b>
            {s.sub && <span className="sx-stat-s">{s.sub}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** ألوان أيقونات العمليات (نفس أسلوب الصورة المعتمدة) */
const ACTION_COLOR: Record<string, SectionColor> = {
  sale_invoice: 'blue', pos: 'green', sale_return: 'purple', quotation: 'orange', expense: 'purple', supplier_new: 'blue', customer_new: 'blue',
  receipt: 'green', payment: 'orange', purchase_invoice: 'purple', purchase_return: 'orange', item_new: 'blue', stock_adjustment: 'teal',
  stock_transfer: 'indigo', item_inquiry: 'teal', journal_voucher: 'indigo', cash_transfer: 'teal', attendance: 'green', employee_advance: 'orange', shift: 'slate', income: 'green', opening_stock: 'slate', payroll: 'purple', employee_new: 'blue', partner_capital: 'green', partner_withdrawal: 'orange',
};
const MAX_ACTIONS = 6;
const actionsKey = (uid: string, section: string) => `erp.section-actions.v1.${uid}.${section}`;
function readSaved(uid: string, section: string): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(actionsKey(uid, section)) ?? 'null');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * العمليات السريعة: أزرار بأيقونات ملونة، الأولى زرقاء ممتلئة.
 * بتظهر بس العمليات المسموحة للمستخدم، و«تخصيص» بيحفظ اختياره لكل قسم على الجهاز.
 */
export function QuickActions({ section, defaults }: { section: string; defaults: string[] }) {
  const nav = useNavigate();
  const { session } = useSession();
  const uid = session.user.id;
  const perms = session.user.permissions;
  const available = useMemo(() => QUICK_ACTIONS.filter((a) => hasPermission(perms, a.perm)), [perms]);
  const [saved, setSaved] = useState<string[] | null>(() => readSaved(uid, section));
  useEffect(() => setSaved(readSaved(uid, section)), [uid, section]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const pick = (keys: string[]) => keys.map((k) => available.find((a) => a.key === k)).filter((a): a is (typeof available)[number] => !!a);
  const chosen = pick(saved ?? defaults).slice(0, MAX_ACTIONS);
  if (!available.length) return null;
  const toggle = (k: string) => setDraft((d) => (d.includes(k) ? d.filter((x) => x !== k) : d.length >= MAX_ACTIONS ? d : [...d, k]));
  const save = () => {
    try {
      localStorage.setItem(actionsKey(uid, section), JSON.stringify(draft));
    } catch {
      /* التخزين غير متاح: يُحفظ للجلسة الحالية فقط */
    }
    setSaved(draft);
    setEditing(false);
  };
  return (
    <section className={`sx-card sx-actions ${editing ? 'editing' : ''}`} aria-labelledby={`sx-qa-${section}`}>
      <div className="sx-card-h">
        <h2 id={`sx-qa-${section}`}><Zap className="sx-h-ic c-orange" /> العمليات السريعة</h2>
        {editing ? (
          <span className="sx-chips">
            <button type="button" className="mc-chip" onClick={() => setEditing(false)}>إلغاء</button>
            <button type="button" className="mc-chip primary" onClick={save} disabled={!draft.length}><Check /> حفظ</button>
          </span>
        ) : (
          <button type="button" className="mc-chip" onClick={() => { setDraft(chosen.map((a) => a.key)); setEditing(true); }}><SlidersHorizontal /> تخصيص</button>
        )}
      </div>
      {editing ? (
        <div className="mc-fav-pick">
          <div className="mc-fav-hint">اختار لحد {MAX_ACTIONS} عمليات بالترتيب ({draft.length}/{MAX_ACTIONS}) — الأولى بتظهر زرقاء.</div>
          <div className="mc-fav-opts">
            {available.map((a) => {
              const i = draft.indexOf(a.key);
              return (
                <button key={a.key} type="button" className={`mc-fav-opt ${i >= 0 ? 'on' : ''}`} aria-pressed={i >= 0} onClick={() => toggle(a.key)} disabled={i < 0 && draft.length >= MAX_ACTIONS}>
                  {i >= 0 && <b className="num">{i + 1}</b>}
                  <span className={`mc-fav-ic c-${ACTION_COLOR[a.key] ?? 'blue'}`}>{a.icon}</span>
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="sx-action-row">
          {chosen.map((a, i) => (
            <button key={a.key} type="button" className={`sx-action ${i === 0 ? 'primary' : ''}`} onClick={() => { recordUse(uid, a.key); nav(a.to); }}>
              <span className={`sx-action-ic c-${ACTION_COLOR[a.key] ?? 'blue'}`} aria-hidden="true">{a.icon}</span>
              <span className="sx-action-l">{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** كارت محتوى بعنوان وأيقونة ورابط «عرض الكل» */
export function SectionCard({ icon, color = 'blue', title, moreTo, moreLabel = 'عرض الكل', className = '', children }: { icon: ReactNode; color?: SectionColor; title: string; moreTo?: string; moreLabel?: string; className?: string; children: ReactNode }) {
  const nav = useNavigate();
  return (
    <section className={`sx-card ${className}`}>
      <div className="sx-card-h">
        <h2><span className={`sx-h-ic c-${color}`}>{icon}</span> {title}</h2>
        {moreTo && <button type="button" className="mc-chip sx-more" onClick={() => nav(moreTo)}>{moreLabel} <ChevronLeft /></button>}
      </div>
      {children}
    </section>
  );
}

export interface FollowUpItem {
  key: string;
  label: string;
  icon: ReactNode;
  to: string;
  count?: number;
  tone?: 'red' | 'blue' | 'orange' | 'green';
  title?: string;
}

/** «المتابعة»: سطور قصيرة بأيقونة وعدد ملون وسهم */
export function FollowUpPanel({ title = 'المتابعة', icon, items }: { title?: string; icon: ReactNode; items: FollowUpItem[] }) {
  const nav = useNavigate();
  if (!items.length) return null;
  return (
    <SectionCard icon={icon} title={title} className="sx-follow">
      <div className="sx-follow-list">
        {items.map((r) => (
          <button key={r.key} type="button" className="sx-follow-row" title={r.title} onClick={() => nav(r.to)}>
            <span className="sx-follow-ic">{r.icon}</span>
            <span className="sx-follow-l">{r.label}</span>
            {r.count !== undefined && r.count > 0 && <span className={`mc-count ${r.tone ?? 'blue'} num`}>{r.count}</span>}
            <ChevronLeft className="sx-chev" />
          </button>
        ))}
      </div>
    </SectionCard>
  );
}

/** المحتوى الرئيسي (ثلثين) + المتابعة (ثلث، على اليمين) — بيتحطوا تحت بعض في الشاشات الصغيرة */
export function ResponsiveSectionLayout({ main, side }: { main?: ReactNode; side?: ReactNode }) {
  if (!side || !main) return <div className="sx-body single">{main || side}</div>;
  return (
    <div className="sx-body">
      <div className="sx-side">{side}</div>
      <div className="sx-main">{main}</div>
    </div>
  );
}

export interface SectionLink {
  key: string;
  label: string;
  desc?: string;
  icon: ReactNode;
  to: string;
  color?: SectionColor;
}

const LINK_COLORS: SectionColor[] = ['blue', 'green', 'purple', 'orange', 'teal', 'indigo', 'pink', 'red', 'slate'];

/** شبكة روابط (للتقارير والإعدادات): أيقونة ملونة + اسم + وصف قصير */
export function LinkGrid({ items }: { items: SectionLink[] }) {
  const nav = useNavigate();
  if (!items.length) return null;
  return (
    <div className="sx-links">
      {items.map((l, i) => (
        <button key={l.key} type="button" className="sx-link" onClick={() => nav(l.to)}>
          <span className={`sx-link-ic c-${l.color ?? LINK_COLORS[i % LINK_COLORS.length]}`} aria-hidden="true">{l.icon}</span>
          <span className="sx-link-t">
            <span className="sx-link-l">{l.label}</span>
            {l.desc && <span className="sx-link-d">{l.desc}</span>}
          </span>
          <ChevronLeft className="sx-chev" />
        </button>
      ))}
    </div>
  );
}
