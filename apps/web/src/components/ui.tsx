import { DOC_STATUS_LABEL, moneyInput, parseMoney, parseQty, qtyInput } from '@erp/shared';
import { AlertTriangle, CheckCircle2, Info, Plus, Search, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { matchScore } from '../lib/search';

// ---------------------------------------------------------------- حقول

export function Field({ label, hint, error, children, className, required }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <div className={`field ${required ? 'required' : ''} ${className ?? ''}`}>
      {label && <label>{label}</label>}
      {children}
      {error ? <div className="err">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

/** إدخال مبلغ: يعرض بالجنيه ويخزن بالقرش (عدد صحيح) */
export function MoneyInput({ value, onChange, disabled, autoFocus, placeholder, id }: { value: number; onChange: (v: number) => void; disabled?: boolean; autoFocus?: boolean; placeholder?: string; id?: string }) {
  return <ScaledInput id={id} value={value} onChange={onChange} disabled={disabled} autoFocus={autoFocus} placeholder={placeholder ?? '0.00'} fmt={moneyInput} parse={parseMoney} />;
}
export function QtyInput({ value, onChange, disabled, autoFocus, id }: { value: number; onChange: (v: number) => void; disabled?: boolean; autoFocus?: boolean; id?: string }) {
  return <ScaledInput id={id} value={value} onChange={onChange} disabled={disabled} autoFocus={autoFocus} placeholder="0" fmt={qtyInput} parse={parseQty} />;
}
function ScaledInput({ value, onChange, fmt, parse, ...rest }: { value: number; onChange: (v: number) => void; fmt: (v: number) => string; parse: (s: string) => number; disabled?: boolean; autoFocus?: boolean; placeholder?: string; id?: string }) {
  const [text, setText] = useState(value ? fmt(value) : '');
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value ? fmt(value) : '');
  }, [value, fmt]);
  return (
    <input
      {...rest}
      className="input num"
      inputMode="decimal"
      value={text}
      style={bad ? { boxShadow: 'inset 0 0 0 2px var(--red)' } : undefined}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(value ? fmt(value) : '');
        setBad(false);
      }}
      onChange={(e) => {
        setText(e.target.value);
        try {
          const v = parse(e.target.value);
          setBad(false);
          onChange(v);
        } catch {
          setBad(true);
        }
      }}
    />
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, block }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; block?: boolean }) {
  return (
    <div className={`segmented ${block ? 'block' : ''}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} role="tab" aria-selected={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, autoFocus, inputRef, onKeyDown }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; inputRef?: React.Ref<HTMLInputElement>; onKeyDown?: React.KeyboardEventHandler }) {
  return (
    <div className="search">
      <Search />
      <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'بحث'} autoFocus={autoFocus} onKeyDown={onKeyDown} />
      {value && (
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => onChange('')} aria-label="مسح">
          <XCircle style={{ width: 16, height: 16, color: 'var(--label-3)' }} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- عرض

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  );
}

export function DocStatusBadge({ status, sync }: { status: string; sync?: string }) {
  if (sync === 'pending') return <span className="badge orange">بانتظار المزامنة</span>;
  if (sync === 'rejected') return <span className="badge red">مرفوض</span>;
  if (sync === 'conflict' || status === 'pending_review') return <span className="badge red">يحتاج مراجعة</span>;
  const cls = status === 'posted' ? 'green' : status === 'cancelled' ? '' : 'blue';
  return <span className={`badge ${cls}`}>{DOC_STATUS_LABEL[status] ?? status}</span>;
}

export function SyncBadge({ sync, error }: { sync?: string; error?: string }) {
  if (!sync) return null;
  if (sync === 'pending') return <span className="badge orange">بانتظار المزامنة</span>;
  return (
    <span className="badge red" title={error}>
      {sync === 'conflict' ? 'تعارض' : 'مرفوض'}
    </span>
  );
}

export function Banner({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'err' | 'ok'; children: ReactNode }) {
  const Icon = kind === 'ok' ? CheckCircle2 : kind === 'info' ? Info : AlertTriangle;
  return (
    <div className={`banner ${kind}`}>
      <Icon />
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- نوافذ

export function Sheet({ title, onClose, children, footer, wide, leading }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; leading?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal>
        <div className="sheet-head">
          <div style={{ minWidth: 70 }}>{leading}</div>
          <h3>{title}</h3>
          <div style={{ minWidth: 70, textAlign: 'left' }}>
            <button className="icon-btn" onClick={onClose} aria-label="إغلاق">
              <X />
            </button>
          </div>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}
interface ToastItem {
  id: number;
  kind: 'ok' | 'err' | 'info' | 'warn';
  text: string;
}

const UiCtx = createContext<{
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  toast: (text: string, kind?: ToastItem['kind']) => void;
} | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })), []);
  const toast = useCallback((text: string, kind: ToastItem['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3200);
  }, []);
  const value = useMemo(() => ({ confirm, toast }), [confirm, toast]);
  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };
  return (
    <UiCtx.Provider value={value}>
      {children}
      {dialog &&
        createPortal(
          <div className="overlay" style={{ placeItems: 'center' }}>
            <div className="alert-box" role="alertdialog">
              <div className="ab-body">
                <h4>{dialog.title}</h4>
                {dialog.message && <p>{dialog.message}</p>}
              </div>
              <div className="ab-actions">
                <button onClick={() => close(false)}>{dialog.cancelLabel ?? 'إلغاء'}</button>
                <button className={`strong ${dialog.destructive ? 'destructive' : ''}`} onClick={() => close(true)} autoFocus>
                  {dialog.confirmLabel ?? 'تأكيد'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {createPortal(
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              {t.kind === 'ok' ? <CheckCircle2 color="var(--green)" /> : t.kind === 'err' ? <XCircle color="var(--red)" /> : t.kind === 'warn' ? <AlertTriangle color="var(--orange)" /> : <Info color="var(--tint)" />}
              {t.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </UiCtx.Provider>
  );
}

export function useUi() {
  const c = useContext(UiCtx);
  if (!c) throw new Error('UiProvider missing');
  return c;
}

// ---------------------------------------------------------------- قائمة منسدلة عائمة
/**
 * تُرسم القائمة في body بموضع ثابت تحت الخانة (أو فوقها لو المساحة لا تكفي)،
 * فلا يقصها أي صندوق أو كارت أو نافذة مهما كان فيها overflow.
 */
export function FloatingPop({ anchor, children, className = 'picker-pop', maxHeight = 340, popRef, minWidth = 280 }: { anchor: React.RefObject<HTMLElement | null>; children: ReactNode; className?: string; maxHeight?: number; popRef?: React.RefObject<HTMLDivElement | null>; minWidth?: number }) {
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  useEffect(() => {
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      // تحت الخانة دائمًا ما دامت هناك مساحة معقولة؛ لأعلى فقط إن كانت المساحة تحتها ضيقة جدًا
      const up = below < 240 && above > below + 80;
      const width = Math.min(Math.max(r.width, minWidth), vw - 16);
      // محاذاة على يمين الخانة (واجهة عربية) مع البقاء داخل الشاشة
      let left = r.right - width;
      left = Math.max(8, Math.min(left, vw - width - 8));
      setPos({
        position: 'fixed',
        left,
        width,
        maxHeight: Math.max(140, Math.min(maxHeight, up ? above : below)),
        ...(up ? { bottom: vh - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, maxHeight, minWidth]);
  if (!pos) return null;
  return createPortal(
    <div ref={popRef} className={`${className} floating`} style={pos} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- منتقي بحث (عميل/صنف/حساب)

export interface PickOption {
  id: string;
  label: string;
  sub?: string;
  search?: string;
  /** التصنيف: لو للخيارات أكثر من تصنيف تظهر أزرار للتصفية أعلى القائمة */
  group?: string;
}

/** أزرار التصنيفات أعلى قائمة البحث */
export function GroupChips({ groups, value, onChange }: { groups: string[]; value: string; onChange: (g: string) => void }) {
  if (groups.length < 2) return null;
  return (
    <div className="picker-groups" onMouseDown={(e) => e.preventDefault()}>
      <button type="button" className={!value ? 'on' : ''} onClick={() => onChange('')}>الكل</button>
      {groups.map((g) => (
        <button type="button" key={g} className={value === g ? 'on' : ''} onClick={() => onChange(g)}>{g}</button>
      ))}
    </div>
  );
}

/**
 * قائمة اختيار بالبحث. لو اتبعت `onCreate` بيظهر في آخرها «+ إضافة جديد» (أو «+ إضافة «النص اللي اتكتب»»)
 * عشان المستخدم يضيف اختيار جديد من نفس المكان وهو شغال. `createLabel` = اسم الحاجة (بند مصروف، مورد، صنف...).
 */
export function Picker({ value, options, onChange, placeholder, disabled, autoFocus, allowClear, onCreate, createLabel }: { value: string | null | undefined; options: PickOption[]; onChange: (id: string | null) => void; placeholder?: string; disabled?: boolean; autoFocus?: boolean; allowClear?: boolean; onCreate?: (text: string) => void; createLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const [group, setGroup] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value);
  const groups = useMemo(() => [...new Set(options.map((o) => o.group).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ar')), [options]);
  const filtered = useMemo(() => {
    const pool = options.filter((o) => !group || o.group === group);
    if (!q.trim()) return pool.slice(0, 300);
    // بحث ذكي: أي جزء من الكلمة، أكثر من كلمة، مع توحيد الحروف العربية؛ الأقرب أولًا
    return pool
      .map((o) => ({ o, sc: matchScore(q, [o.label, o.search ?? '', o.sub ?? '']) }))
      .filter((x) => x.sc >= 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 300)
      .map((x) => x.o);
  }, [q, options, group]);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const pick = (o: PickOption) => {
    onChange(o.id);
    setOpen(false);
    setQ('');
  };
  const typed = q.trim();
  const exact = typed && options.some((o) => o.label.trim() === typed);
  const create = () => {
    if (!onCreate) return;
    setOpen(false);
    setQ('');
    onCreate(exact ? '' : typed);
  };
  return (
    <div className="picker" ref={ref}>
      <input
        className="input"
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={current ? current.label : placeholder ?? 'اختر...'}
        value={open ? q : current?.label ?? ''}
        onFocus={() => {
          setOpen(true);
          setQ('');
          setHl(0);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setHl(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHl((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHl((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered[hl]) pick(filtered[hl]);
            else if (onCreate && typed) create();
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && !disabled && (
        <FloatingPop anchor={ref} popRef={popRef}>
          <GroupChips groups={groups} value={group} onChange={(g) => { setGroup(g); setHl(0); }} />
          {allowClear && value && (
            <div className="picker-opt" onMouseDown={() => { onChange(null); setOpen(false); }}>
              <span className="muted">— بدون —</span>
            </div>
          )}
          {filtered.length === 0 && <div className="picker-opt muted">{onCreate && typed ? `مفيش «${typed}» في القائمة` : 'لا نتائج'}</div>}
          {filtered.map((o, i) => (
            <div key={o.id} className={`picker-opt ${i === hl ? 'hl' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setHl(i)}>
              <span style={{ flex: 1 }}>{o.label}</span>
              {o.sub && <span className="muted small">{o.sub}</span>}
            </div>
          ))}
          {onCreate && (
            <div className="picker-opt picker-create" role="button" onMouseDown={(e) => { e.preventDefault(); create(); }}>
              <Plus aria-hidden="true" />
              <span style={{ flex: 1 }}>{typed && !exact ? `إضافة «${typed}»${createLabel ? ` ك${createLabel} جديد` : ''}` : `إضافة ${createLabel ?? ''} جديد`.replace(/\s+/g, ' ')}</span>
              {typed && !exact && filtered.length === 0 && <kbd>Enter</kbd>}
            </div>
          )}
        </FloatingPop>
      )}
    </div>
  );
}

/** نص رقمي منسق (مثل 1,234.50 أو 12.5 أو 7) → رقم حقيقي في Excel؛ الأكواد والباركود تبقى نصًا */
const NUMERIC = /^-?(0|[1-9]\d{0,2}(,\d{3})*|[1-9]\d{0,2}(,\d{3})*)(\.\d+)?$|^-?0\.\d+$/;
function excelValue(v: unknown): string | number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (NUMERIC.test(s)) return Number(s.replace(/,/g, ''));
  return s;
}

/**
 * تصدير جدول إلى ملف Excel حقيقي (.xlsx) باتجاه من اليمين لليسار:
 * صف عناوين ثابت وعريض، والأرقام كأرقام قابلة للجمع في Excel.
 */
export async function exportExcel(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const head = headers.map((h) => ({ value: h, fontWeight: 'bold' as const, backgroundColor: '#E8EAF0', align: 'center' as const }));
  const body = rows.map((r) => r.map((v) => {
    const x = excelValue(v);
    // المبالغ المنسقة بكسور (120.00) تبقى بخانتين عشريتين في Excel
    const decimals = typeof v === 'string' ? /\.\d/.test(v) : typeof x === 'number' && !Number.isInteger(x);
    return x === null ? null : typeof x === 'number' ? { value: x, type: Number, format: decimals ? '#,##0.00' : '#,##0' } : { value: x, type: String };
  }));
  const widths = headers.map((h, i) => Math.min(60, Math.max(8, String(h).length + 2, ...rows.slice(0, 500).map((r) => String(r[i] ?? '').length + 2))));
  const name = (filename.replace(/\.(csv|xlsx)$/i, '') + ` ${new Date().toISOString().slice(0, 10)}`).replace(/[\/:*?"<>|]/g, '-');
  await writeXlsxFile([head, ...body] as any, {
    sheet: name.slice(0, 31),
    rightToLeft: true,
    stickyRowsCount: 1,
    columns: widths.map((width) => ({ width })),
  }, { fontFamily: 'Arial', fontSize: 11 }).toFile(`${name}.xlsx`);
}

/** حفظ PDF: يفتح نافذة الطباعة باسم ملف مناسب؛ اختر «حفظ كـ PDF» (يدعم العربية والاتجاه من اليمين لليسار) */
export function savePdf(title: string) {
  const old = document.title;
  document.title = `${title} ${new Date().toISOString().slice(0, 10)}`;
  const restore = () => {
    document.title = old;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}
