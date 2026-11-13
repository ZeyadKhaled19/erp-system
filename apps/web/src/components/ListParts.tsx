import { FileText, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePerm } from '../lib/hooks';

/** تبويبات أعلى صفحات القوائم (خط أزرق تحت النشط) — كل تبويب صفحة، ويظهر لمن يملك صلاحيته */
export function PageTabs({ tabs }: { tabs: { to: string; label: string; perm?: string; match?: string[] }[] }) {
  const loc = useLocation();
  const nav = useNavigate();
  const can = usePerm();
  const shown = tabs.filter((t) => !t.perm || can(t.perm));
  if (shown.length < 2) return null;
  const isOn = (t: (typeof tabs)[number]) => [t.to, ...(t.match ?? [])].some((p) => loc.pathname === p.split('?')[0]);
  return (
    <div className="lp-tabs" role="tablist">
      {shown.map((t) => (
        <button key={t.to} type="button" role="tab" aria-selected={isOn(t)} className={isOn(t) ? 'on' : ''} onClick={() => !isOn(t) && nav(t.to)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** نفس شكل التبويبات لكن داخل الصفحة (بدون تغيير الرابط) */
export function InlineTabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="lp-tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** أزرار آخر السطر: تعديل + كشف/تفاصيل (لا تفتح السطر نفسه) */
export function RowActions({ onEdit, onOpen, editLabel = 'تعديل', openLabel = 'التفاصيل', children }: { onEdit?: () => void; onOpen?: () => void; editLabel?: string; openLabel?: string; children?: ReactNode }) {
  return (
    <span className="lp-actions" onClick={(e) => e.stopPropagation()}>
      {children}
      {onOpen && <button type="button" className="lp-act" title={openLabel} aria-label={openLabel} onClick={onOpen}><FileText /></button>}
      {onEdit && <button type="button" className="lp-act" title={editLabel} aria-label={editLabel} onClick={onEdit}><Pencil /></button>}
    </span>
  );
}

/** حالة السجل: نشط (أخضر) أو موقوف (رمادي) */
export function ActiveBadge({ active, off = 'موقوف' }: { active: boolean; off?: string }) {
  return <span className={`badge ${active ? 'green' : 'gray'}`}>{active ? 'نشط' : off}</span>;
}

/** دائرة بالحرف الأول من الاسم */
export function Avatar({ name }: { name: string }) {
  return <span className="lp-avatar" aria-hidden="true">{(name || '؟').trim()[0]}</span>;
}

/** كروت الإجماليات الملونة أسفل/أعلى القوائم */
export function TotalCards({ items }: { items: { label: string; value: ReactNode; tone: 'blue' | 'green' | 'red' | 'orange' | 'purple' }[] }) {
  return (
    <div className="lp-totals">
      {items.map((i) => (
        <div key={i.label} className={`lp-total ${i.tone}`}>
          <span className="lp-total-l">{i.label}</span>
          <b className="lp-total-v num">{i.value}</b>
        </div>
      ))}
    </div>
  );
}

/** تبويبات صفحات الخزينة والحسابات (نفس الشريط في الثلاث صفحات) */
export const TREASURY_TABS = [
  { to: '/cashboxes', label: 'الخزائن والبنوك', perm: 'treasury.view' },
  { to: '/accounts', label: 'دليل الحسابات', perm: 'accounts.view' },
  { to: '/docs/list/treasury', label: 'التحصيل والصرف', perm: 'treasury.view' },
];
