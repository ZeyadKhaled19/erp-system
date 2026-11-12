import { uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm } from '../lib/hooks';
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

/** شريط فلتر بالتصنيف (الكل + كل تصنيف وعدد أصنافه) */
export function CategoryFilter({ value, onChange, counts }: { value: string; onChange: (id: string) => void; counts?: Map<string, number> }) {
  const cats = useCategories();
  if (cats.length < 2) return null;
  return (
    <div className="seg-chips cat-filter" role="radiogroup" aria-label="فلتر التصنيف">
      <button type="button" role="radio" aria-checked={!value} className={!value ? 'on' : ''} onClick={() => onChange('')}>كل التصنيفات</button>
      {cats.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={value === c.id} className={value === c.id ? 'on' : ''} onClick={() => onChange(c.id)}>
          {c.name}
          {counts && <span className="muted small num">{counts.get(c.id) ?? 0}</span>}
        </button>
      ))}
    </div>
  );
}
