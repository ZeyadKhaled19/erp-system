import { uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm } from '../lib/hooks';
import { normalizeAr } from '../lib/search';
import { useUi } from './ui';

/** التصنيفات النشطة مرتبة بالاسم */
export function useCategories() {
  return useLiveQuery(async () => (await db.categories.toArray()).filter((c) => c.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')), []) ?? [];
}

/**
 * خانة التصنيف في إضافة/تعديل الصنف: اختيار بلمسة + إضافة تصنيف جديد من نفس المكان.
 * التصنيف الجديد يُحفظ على الجهاز فورًا ويُرفع مع المزامنة.
 */
export function CategoryField({ value, onChange }: { value: string | null | undefined; onChange: (id: string) => void }) {
  const ui = useUi();
  const can = usePerm();
  const cats = useCategories();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const same = cats.find((c) => c.name.trim() === n);
    if (same) {
      onChange(same.id);
    } else {
      const id = uuid();
      await saveMaster('category', id, { name: n, active: true });
      onChange(id);
      ui.toast(`أُضيف التصنيف «${n}»`);
    }
    setName('');
    setAdding(false);
  };
  return (
    <div className="field">
      <label>التصنيف</label>
      <div className="cat-field">
        {cats.map((c) => (
          <button key={c.id} type="button" className={value === c.id ? 'on' : ''} aria-pressed={value === c.id} onClick={() => onChange(c.id)}>
            {c.name}
          </button>
        ))}
        {can('items.create') &&
          (adding ? (
            <span className="cat-new" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void add(); } if (e.key === 'Escape') setAdding(false); }}>
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم التصنيف" aria-label="اسم التصنيف الجديد" />
              <button type="button" className="icon-btn" title="حفظ" aria-label="حفظ التصنيف" onClick={() => void add()}><Check /></button>
              <button type="button" className="icon-btn" title="إلغاء" aria-label="إلغاء" onClick={() => setAdding(false)}><X /></button>
            </span>
          ) : (
            <button type="button" className="cat-add" onClick={() => setAdding(true)}><Plus /> تصنيف جديد</button>
          ))}
      </div>
    </div>
  );
}

/**
 * فلتر التصنيف الموحد في كل النظام: زر «التصنيف: الكل» يفتح قائمة بشكل النظام
 * (بدل قائمة الويندوز الأصلية): بحث سريع، عدد أصناف كل تصنيف، علامة على المختار، وتعمل بالأسهم وEnter وEsc.
 */
export function CategoryFilter({ value, onChange, counts, className }: { value: string; onChange: (id: string) => void; counts?: Map<string, number>; className?: string }) {
  const cats = useCategories();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const [pos, setPos] = useState<{ top: number; right: number; maxH: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => {
    const all = [{ id: '', name: 'الكل', n: counts ? [...counts.values()].reduce((a, b) => a + b, 0) : undefined }, ...cats.map((c) => ({ id: c.id, name: c.name, n: counts?.get(c.id) ?? (counts ? 0 : undefined) }))];
    const nq = normalizeAr(q);
    return nq ? all.filter((o) => o.id && normalizeAr(o.name).includes(nq)) : all;
  }, [cats, counts, q]);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(Math.max(r.width, 240), window.innerWidth - 16);
    // القائمة تبدأ من يمين الزر (اتجاه عربي) ولا تخرج من الشاشة
    const right = Math.min(Math.max(8, window.innerWidth - r.right), window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 260 && above > below;
    setPos({ top: up ? Math.max(8, r.top - 6 - Math.min(420, above)) : r.bottom + 6, right, maxH: Math.min(420, up ? above : below), width });
  };
  const show = () => {
    setQ('');
    setHl(Math.max(0, [{ id: '' }, ...cats].findIndex((c) => c.id === value)));
    place();
    setOpen(true);
  };
  const close = (focusBtn = true) => {
    setOpen(false);
    if (focusBtn) btnRef.current?.focus();
  };
  const pick = (id: string) => {
    onChange(id);
    close();
  };

  useEffect(() => {
    if (!open) return;
    setTimeout(() => (searchRef.current ?? listRef.current)?.focus(), 0);
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) close(false);
    };
    const onMove = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      place();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // إبقاء العنصر المحدد ظاهرًا أثناء التنقل بالأسهم
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-i="${hl}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hl, open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(options.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setHl(0); }
    else if (e.key === 'End') { e.preventDefault(); setHl(options.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (options[hl]) pick(options[hl].id); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  };

  if (cats.length < 1) return null;
  const current = value ? (cats.find((c) => c.id === value)?.name ?? 'الكل') : 'الكل';
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`cat-select ${value ? 'on' : ''} ${open ? 'open' : ''} ${className ?? ''}`}
        aria-label="فلتر التصنيف"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); show(); } }}
      >
        <span>التصنيف:</span>
        <b className="cat-select-v">{current}</b>
        <ChevronDown className="cat-select-i" aria-hidden="true" />
      </button>
      {open && pos && createPortal(
        <div ref={popRef} className="cat-pop" style={{ top: pos.top, right: pos.right, width: pos.width, maxHeight: pos.maxH }} onKeyDown={onKey}>
          {cats.length > 7 && (
            <div className="cat-pop-search">
              <Search aria-hidden="true" />
              <input ref={searchRef} value={q} onChange={(e) => { setQ(e.target.value); setHl(0); }} placeholder="ابحث عن تصنيف…" aria-label="بحث في التصنيفات" />
            </div>
          )}
          <div ref={listRef} className="cat-pop-list" role="listbox" tabIndex={-1} aria-label="التصنيفات" aria-activedescendant={options[hl] ? `cat-opt-${hl}` : undefined}>
            {options.map((o, i) => (
              <div
                key={o.id || 'all'}
                id={`cat-opt-${i}`}
                data-i={i}
                role="option"
                aria-selected={o.id === value}
                className={`cat-pop-opt ${o.id === value ? 'sel' : ''} ${i === hl ? 'hl' : ''} ${o.id ? '' : 'all'}`}
                onMouseEnter={() => setHl(i)}
                onClick={() => pick(o.id)}
              >
                <Check className="cat-pop-check" aria-hidden="true" />
                <span className="cat-pop-name">{o.name}</span>
                {o.n !== undefined && <span className="cat-pop-n num">{o.n}</span>}
              </div>
            ))}
            {!options.length && <div className="cat-pop-empty">لا يوجد تصنيف بهذا الاسم</div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
