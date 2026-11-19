import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import './DatePicker.css';

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  style?: CSSProperties;
  min?: string;
  max?: string;
  disabled?: boolean;
  'aria-label'?: string;
  title?: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (v: string) => v ? new Date(`${v}T12:00:00Z`) : new Date(`${iso(new Date())}T12:00:00Z`);

export function DatePicker({ value, onChange, className = 'input', style, min, max, disabled, title, 'aria-label': ariaLabel }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = parse(value);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12));
  });
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const selected = value ? parse(value) : null;
  const y = month.getUTCFullYear();
  const m = month.getUTCMonth();
  const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 1) % 7; // السبت أول أيام الأسبوع
  const days = useMemo(() => [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)], [offset, count]);
  const monthLabel = new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month);
  const week = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'];

  const place = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = 288;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
    const top = r.bottom + 6 + 320 > window.innerHeight ? Math.max(8, r.top - 326) : r.bottom + 6;
    setPosition({ top, left });
  };
  useEffect(() => {
    if (!open) return;
    place();
    const outside = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node)) return;
      const popover = document.querySelector('.date-picker-popover');
      if (!popover?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const choose = (day: number) => {
    const next = `${y}-${pad(m + 1)}-${pad(day)}`;
    if ((!min || next >= min) && (!max || next <= max)) {
      onChange(next);
      setOpen(false);
    }
  };
  const shift = (amount: number) => setMonth(new Date(Date.UTC(y, m + amount, 1, 12)));
  const today = iso(new Date());
  const display = selected ? new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(selected) : 'اختر تاريخًا';

  return (
    <div className="date-picker" ref={root}>
      <button ref={button} type="button" className={`date-picker-trigger ${className}`} style={style} disabled={disabled} title={title} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setMonth(new Date(Date.UTC((selected ?? parse(today)).getUTCFullYear(), (selected ?? parse(today)).getUTCMonth(), 1, 12))); setOpen((x) => !x); }}>
        <CalendarDays aria-hidden="true" />
        <span>{display}</span>
      </button>
      {open && createPortal(<div className="date-picker-popover" role="dialog" aria-label="اختيار التاريخ" style={{ top: position.top, left: position.left }}>
        <div className="date-picker-head">
          <button type="button" className="date-picker-nav" aria-label="الشهر السابق" onClick={() => shift(-1)}><ChevronRight /></button>
          <strong>{monthLabel}</strong>
          <button type="button" className="date-picker-nav" aria-label="الشهر التالي" onClick={() => shift(1)}><ChevronLeft /></button>
        </div>
        <div className="date-picker-grid date-picker-week">{week.map((d, i) => <span key={`${d}-${i}`}>{d}</span>)}</div>
        <div className="date-picker-grid date-picker-days">{days.map((day, i) => {
          if (!day) return <span key={`blank-${i}`} />;
          const current = `${y}-${pad(m + 1)}-${pad(day)}`;
          const blocked = (!!min && current < min) || (!!max && current > max);
          const active = value === current;
          return <button type="button" key={current} disabled={blocked} className={`${active ? 'selected' : ''} ${today === current ? 'today' : ''}`} onClick={() => choose(day)}>{day}</button>;
        })}</div>
        <div className="date-picker-foot">
          <button type="button" className="date-picker-clear" onClick={() => { onChange(''); setOpen(false); }}><X /> مسح</button>
          <button type="button" className="date-picker-today" onClick={() => { onChange(today); setMonth(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 12))); setOpen(false); }}>اليوم</button>
        </div>
      </div>, document.body)}
    </div>
  );
}
