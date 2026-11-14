import { uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { Banner, Field, Sheet, useUi } from './ui';

type AccType = 'expense' | 'revenue';
const TITLE: Record<AccType, string> = { expense: 'بند مصروف جديد', revenue: 'بند إيراد جديد' };
const HINT: Record<AccType, string> = { expense: 'مثال: بوفيه، نظافة، دعاية وإعلان، أدوات مكتبية', revenue: 'مثال: إيجار مخزن، عمولة توكيل، خدمة توصيل' };

/**
 * إضافة بند مصروف/إيراد جديد من جوه السند وانت شغال.
 * البند بيتعمل كحساب فرعي تحت نفس المجموعة اللي فيها أغلب بنود القائمة، وكوده بيتولد تلقائيًا.
 */
export function QuickAccountSheet({ type, initialName = '', onClose, onSaved }: { type: AccType; initialName?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const ui = useUi();
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const groups = useMemo(() => accounts.filter((a) => a.is_group && a.type === type && a.active !== false).sort((a, b) => String(a.code).localeCompare(String(b.code))), [accounts, type]);
  // المجموعة الافتراضية: اللي فيها أكتر بنود عادية من نفس النوع
  const defaultParent = useMemo(() => {
    const count = new Map<string, number>();
    accounts.filter((a) => !a.is_group && a.type === type && !a.system_key && a.parent_id).forEach((a) => count.set(a.parent_id, (count.get(a.parent_id) ?? 0) + 1));
    const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return best ?? groups[groups.length - 1]?.id ?? '';
  }, [accounts, groups, type]);
  const [name, setName] = useState(initialName);
  const [parent, setParent] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parentId = parent || defaultParent;

  const save = async () => {
    setErr(null);
    const n = name.trim();
    if (!n) return setErr('اكتب اسم البند');
    const p = accounts.find((a) => a.id === parentId);
    if (!p) return setErr('مفيش مجموعة حسابات مناسبة. ضيف البند من «دليل الحسابات».');
    if (accounts.some((a) => a.type === type && String(a.name).trim() === n)) return setErr('البند ده موجود بالفعل، اختاره من القائمة');
    // الكود: أكبر كود رقمي تحت نفس المجموعة + 1، أو كود المجموعة + 01 لو أول بند
    const siblings = accounts.filter((a) => a.parent_id === p.id).map((a) => String(a.code)).filter((c) => /^\d+$/.test(c));
    let code = siblings.length ? String(BigInt(siblings.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))[siblings.length - 1]) + 1n) : `${p.code}01`;
    while (accounts.some((a) => String(a.code) === code)) code = String(BigInt(code) + 1n);
    setBusy(true);
    const id = uuid();
    await saveMaster('account', id, { code, name: n, parent_id: p.id, type, is_group: false, active: true });
    ui.toast(`اتضاف البند «${n}» (${code}) واتختار`);
    onSaved(id);
    onClose();
  };

  return (
    <Sheet
      title={TITLE[type]}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={busy} onClick={save}>حفظ واختيار</button>
        </>
      }
    >
      <div className="stack" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void save())}>
        {err && <Banner kind="err">{err}</Banner>}
        <Field label="اسم البند" required hint={HINT[type]}>
          <input className="input" style={{ fontSize: 17, height: 52 }} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {groups.length > 1 && (
          <Field label="تحت مجموعة" hint="بيتحدد تلقائيًا؛ غيّره بس لو عايز البند في مجموعة تانية في دليل الحسابات">
            <select className="select" value={parentId} onChange={(e) => setParent(e.target.value)}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
            </select>
          </Field>
        )}
        <div className="footnote">البند بيتحفظ في دليل الحسابات وبيظهر في كل السندات والتقارير، وتقدر تعدله أو توقفه من «دليل الحسابات».</div>
      </div>
    </Sheet>
  );
}
