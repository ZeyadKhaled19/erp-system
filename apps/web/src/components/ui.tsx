import { DOC_STATUS_LABEL, moneyInput, parseMoney, parseQty, qtyInput } from '@erp/shared';
import { AlertTriangle, CheckCircle2, Info, Search, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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

// ---------------------------------------------------------------- منتقي بحث (عميل/صنف/حساب)

export interface PickOption {
  id: string;
  label: string;
  sub?: string;
  search?: string;
}

export function Picker({ value, options, onChange, placeholder, disabled, autoFocus, allowClear }: { value: string | null | undefined; options: PickOption[]; onChange: (id: string | null) => void; placeholder?: string; disabled?: boolean; autoFocus?: boolean; allowClear?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? options.filter((o) => (o.search ?? `${o.label} ${o.sub ?? ''}`).toLowerCase().includes(s)) : options;
    return list.slice(0, 60);
  }, [q, options]);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const pick = (o: PickOption) => {
    onChange(o.id);
    setOpen(false);
    setQ('');
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
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && !disabled && (
        <div className="picker-pop">
          {allowClear && value && (
            <div className="picker-opt" onMouseDown={() => { onChange(null); setOpen(false); }}>
              <span className="muted">— بدون —</span>
            </div>
          )}
          {filtered.length === 0 && <div className="picker-opt muted">لا نتائج</div>}
          {filtered.map((o, i) => (
            <div key={o.id} className={`picker-opt ${i === hl ? 'hl' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setHl(i)}>
              <span style={{ flex: 1 }}>{o.label}</span>
              {o.sub && <span className="muted small">{o.sub}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** تصدير جدول CSV متوافق مع Excel العربي (UTF-8 BOM) */
export function exportCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
