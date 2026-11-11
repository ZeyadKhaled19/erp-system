import { uuid } from '@erp/shared';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { Banner, Field, MoneyInput, Sheet, useUi } from './ui';

/**
 * إضافة عميل/مورد سريعة من داخل الفاتورة أو البيع السريع:
 * الاسم (إلزامي) والهاتف، والحد الائتماني اختياري. يُختار تلقائيًا بعد الحفظ.
 */
export function QuickPartySheet({ kind = 'customer', initialName = '', onClose, onSaved }: { kind?: 'customer' | 'supplier'; initialName?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const ui = useUi();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [limit, setLimit] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = kind === 'customer' ? 'عميل' : 'مورد';

  const save = async () => {
    setErr(null);
    const n = name.trim();
    if (!n) return setErr('اكتب الاسم');
    const same = (await db.parties.where('kind').equals(kind).toArray()).find((p) => p.name.trim() === n || (phone.trim() && p.phone === phone.trim()));
    if (same) {
      // موجود بالفعل: نختاره بدل إنشاء مكرر
      ui.toast(`«${same.name}» موجود بالفعل وتم اختياره`, 'info');
      onSaved(same.id);
      onClose();
      return;
    }
    setBusy(true);
    const all = await db.parties.where('kind').equals(kind).toArray();
    const nums = all.map((p) => Number(p.code)).filter((x) => Number.isInteger(x));
    const id = uuid();
    await saveMaster('party', id, {
      kind,
      code: String((nums.length ? Math.max(...nums) : 0) + 1),
      name: n,
      phone: phone.trim() || null,
      address: null,
      tax_no: null,
      credit_limit: limit,
      price_list: 'retail',
      price_list_id: 'pl-retail',
      discount_bp: 0,
      due_days: 0,
      review_date: null,
      notes: null,
      active: true,
    });
    ui.toast(`أُضيف ${label} «${n}»`);
    onSaved(id);
    onClose();
  };

  return (
    <Sheet
      title={`${label} جديد`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={busy} onClick={save}><UserPlus /> حفظ واختيار</button>
        </>
      }
    >
      <div className="stack" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void save())}>
        {err && <Banner kind="err">{err}</Banner>}
        <Field label={`اسم ال${label}`} required>
          <input className="input" style={{ fontSize: 18, height: 52 }} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="رقم الموبايل">
          <input className="input num" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" />
        </Field>
        {kind === 'customer' && (
          <Field label="الحد الأقصى للدين" hint="اختياري — 0 يعني بدون حد">
            <MoneyInput value={limit} onChange={setLimit} />
          </Field>
        )}
        <div className="footnote">باقي البيانات (العنوان، الرقم الضريبي، قائمة الأسعار…) تقدر تكملها بعدين من صفحة {kind === 'customer' ? 'العملاء' : 'الموردين'}.</div>
      </div>
    </Sheet>
  );
}
