import { formatMoney, formatQty, parseMoney, parseQty, todayISO, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ClipboardPaste, Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { saveDocument, saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm, useSettings } from '../lib/hooks';
import { Banner, Field, MoneyInput, QtyInput, Sheet, useUi } from './ui';
import { CategoryField } from './Categories';

async function nextCode(offset = 0) {
  const all = await db.items.toArray();
  const nums = all.map((i) => Number(i.code)).filter((n) => Number.isInteger(n));
  return String((nums.length ? Math.max(...nums) : 1000) + 1 + offset);
}

async function postOpening(warehouseId: string, lines: { item_id: string; unit: string; qty: number; cost: number }[]) {
  if (!lines.length) return;
  await saveDocument(
    {
      id: uuid(), doc_type: 'opening_stock', date: todayISO(), warehouse_id: warehouseId, notes: 'رصيد عند إضافة الصنف',
      lines: lines.map((l) => ({ id: uuid(), item_id: l.item_id, unit_name: l.unit, unit_factor: 1000, qty: l.qty, price: l.cost, discount: 0, tax_rate_bp: 0, serials: [], expiry: null, ref_line_id: null, notes: null })),
      journal_lines: [], payments: [], instruments: [], charges: [], paid: 0, amount: 0, discount: 0, reserve: false, deliver_later: false, retained_bp: 0,
    } as any,
    'post',
    null,
  );
}

/**
 * إضافة صنف سريعة: الاسم والسعر فقط إلزاميان، والكمية الحالية تُسجل تلقائيًا كرصيد أول المدة.
 * «حفظ وأضف التالي» يبقي النافذة مفتوحة لإدخال أصناف كثيرة بسرعة.
 */
export function QuickItemSheet({ onClose, onSaved, onAdvanced }: { onClose: () => void; onSaved?: (id: string) => void; onAdvanced?: () => void }) {
  const ui = useUi();
  const can = usePerm();
  const settings = useSettings();
  const cats = useLiveQuery(async () => (await db.categories.toArray()).filter((c) => c.active !== false), []) ?? [];
  const warehouses = useLiveQuery(async () => (await db.warehouses.toArray()).filter((w) => w.active !== false), []) ?? [];
  const empty = { name: '', price: 0, cost: 0, qty: 0, barcode: '', cat: 'cat-general', unit: 'قطعة' };
  const [f, setF] = useState(empty);
  const [wh, setWh] = useState('');
  const [added, setAdded] = useState<{ id: string; name: string; price: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const canStock = can('inventory.create');

  const save = async (andNext: boolean) => {
    setErr(null);
    const name = f.name.trim();
    if (!name) return setErr('اكتب اسم الصنف');
    if ((await db.items.where('name').equals(name).count()) > 0) return setErr('يوجد صنف بنفس الاسم');
    if (f.barcode.trim() && ((await db.items.where('barcode').equals(f.barcode.trim()).count()) || (await db.item_units.where('barcode').equals(f.barcode.trim()).count()))) {
      return setErr('الباركود مستخدم لصنف آخر');
    }
    const id = uuid();
    await saveMaster('item', id, {
      code: await nextCode(),
      name,
      barcode: f.barcode.trim() || null,
      category_id: f.cat || null,
      base_unit: f.unit.trim() || 'قطعة',
      sale_price: f.price,
      wholesale_price: 0,
      reorder_level: 0,
      tax_rate_bp: settings.default_tax_rate_bp ?? 0,
      active: true,
      notes: null,
      units: [],
      prices: [],
    });
    if (canStock && f.qty > 0) await postOpening(wh || warehouses[0]?.id, [{ item_id: id, unit: f.unit.trim() || 'قطعة', qty: f.qty, cost: f.cost }]);
    onSaved?.(id);
    setAdded((a) => [{ id, name, price: f.price }, ...a]);
    if (andNext) {
      setF({ ...empty, cat: f.cat, unit: f.unit });
      ui.toast(`أُضيف «${name}»`);
      setTimeout(() => nameRef.current?.focus(), 30);
    } else {
      ui.toast(`أُضيف «${name}»`);
      onClose();
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void save(true);
    }
  };

  return (
    <Sheet
      title="صنف جديد"
      onClose={onClose}
      footer={
        <>
          {onAdvanced && <button className="btn plain" onClick={onAdvanced}>خيارات متقدمة</button>}
          <span className="spacer" />
          <button className="btn" onClick={() => save(false)}>حفظ وإغلاق</button>
          <button className="btn primary" onClick={() => save(true)}><Plus /> حفظ وأضف التالي</button>
        </>
      }
    >
      <div className="stack" onKeyDown={onKey}>
        {err && <Banner kind="err">{err}</Banner>}
        <Field label="اسم الصنف" required>
          <input ref={nameRef} className="input" style={{ fontSize: 17, height: 52 }} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus placeholder="مثال: شاي العروسة 250 جم" />
        </Field>
        <div className="grid grid-3">
          <Field label="سعر البيع" required><MoneyInput value={f.price} onChange={(v) => setF({ ...f, price: v })} /></Field>
          {canStock && <Field label="الكمية الموجودة الآن" hint="اختياري"><QtyInput value={f.qty} onChange={(v) => setF({ ...f, qty: v })} /></Field>}
          {canStock && <Field label="سعر التكلفة" hint="للكمية الموجودة"><MoneyInput value={f.cost} onChange={(v) => setF({ ...f, cost: v })} /></Field>}
        </div>
        <div className="grid grid-3">
          <Field label="الباركود" hint="امسحه بالماسح"><input className="input num" value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} /></Field>
          <Field label="الوحدة"><input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} list="unit-presets" /></Field>
          {canStock && warehouses.length > 1 && f.qty > 0 ? (
            <Field label="في مخزن">
              <select className="select" value={wh || warehouses[0]?.id} onChange={(e) => setWh(e.target.value)}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
          ) : <div />}
        </div>
        <datalist id="unit-presets">{['قطعة', 'كرتونة', 'علبة', 'كيلو', 'جرام', 'لتر', 'متر', 'دستة', 'عبوة'].map((u) => <option key={u} value={u} />)}</datalist>
        <CategoryField value={f.cat} onChange={(id) => setF({ ...f, cat: id })} />
        <div className="footnote">اضغط Enter للحفظ وإضافة الصنف التالي مباشرة. الكود يُولّد تلقائيًا.</div>
        {added.length > 0 && (
          <div className="list" style={{ background: 'var(--card-2)' }}>
            {added.slice(0, 6).map((a) => (
              <div key={a.id} className="list-row" style={{ background: 'transparent' }}>
                <Check style={{ width: 18, height: 18, color: 'var(--green)' }} />
                <div className="title">{a.name}</div>
                <span className="num muted">{formatMoney(a.price)}</span>
              </div>
            ))}
            <div className="list-row muted small" style={{ background: 'transparent' }}>أُضيف {added.length} صنف في هذه الجلسة</div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** استيراد أصناف بلصق جدول من Excel: الاسم | سعر البيع | التكلفة | الكمية | الباركود | الوحدة */
export function ImportItemsSheet({ onClose }: { onClose: () => void }) {
  const ui = useUi();
  const can = usePerm();
  const settings = useSettings();
  const warehouses = useLiveQuery(async () => (await db.warehouses.toArray()).filter((w) => w.active !== false), []) ?? [];
  const existing = useLiveQuery(async () => {
    const all = await db.items.toArray();
    return { names: new Set(all.map((i) => i.name.trim())), barcodes: new Set(all.map((i) => i.barcode).filter(Boolean)) };
  }, []);
  const [text, setText] = useState('');
  const [wh, setWh] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const out: { name: string; price: number; cost: number; qty: number; barcode: string; unit: string; error?: string }[] = [];
    const seen = new Set<string>();
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const c = raw.split(/\t|;|,(?=\s*\d)/).map((x) => x.trim());
      const name = c[0];
      if (!name || /^(الاسم|اسم الصنف|name)$/i.test(name)) continue;
      let price = 0, cost = 0, qty = 0;
      let error: string | undefined;
      try {
        price = c[1] ? parseMoney(c[1]) : 0;
        cost = c[2] ? parseMoney(c[2]) : 0;
        qty = c[3] ? parseQty(c[3]) : 0;
      } catch {
        error = 'رقم غير صالح';
      }
      const barcode = c[4] ?? '';
      if (existing?.names.has(name) || seen.has(name)) error = 'الاسم مكرر';
      else if (barcode && existing?.barcodes.has(barcode)) error = 'الباركود مستخدم';
      seen.add(name);
      out.push({ name, price, cost, qty, barcode, unit: c[5] || 'قطعة', error });
    }
    return out;
  }, [text, existing]);
  const ok = rows.filter((r) => !r.error);

  const run = async () => {
    setBusy(true);
    const opening: { item_id: string; unit: string; qty: number; cost: number }[] = [];
    let n = 0;
    for (const r of ok) {
      const id = uuid();
      await saveMaster('item', id, {
        code: await nextCode(), name: r.name, barcode: r.barcode || null, category_id: 'cat-general', base_unit: r.unit, sale_price: r.price, wholesale_price: 0,
        reorder_level: 0, tax_rate_bp: settings.default_tax_rate_bp ?? 0, active: true, notes: null, units: [], prices: [],
      });
      if (r.qty > 0 && can('inventory.create')) opening.push({ item_id: id, unit: r.unit, qty: r.qty, cost: r.cost });
      n++;
    }
    await postOpening(wh || warehouses[0]?.id, opening);
    ui.toast(`تم استيراد ${n} صنف${opening.length ? ` ورصيد ${opening.length} منها` : ''}`);
    setBusy(false);
    onClose();
  };

  return (
    <Sheet
      title="استيراد أصناف من Excel"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="footnote" style={{ flex: 1 }}>{rows.length ? `${ok.length} جاهز للاستيراد${rows.length - ok.length ? ` · ${rows.length - ok.length} به مشكلة` : ''}` : ''}</span>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={!ok.length || busy} onClick={run}>استيراد {ok.length || ''} صنف</button>
        </>
      }
    >
      <div className="stack">
        <Banner kind="info">
          في Excel رتّب الأعمدة: <b>الاسم · سعر البيع · التكلفة · الكمية · الباركود · الوحدة</b> (الاسم فقط إلزامي)، حدد الصفوف وانسخها ثم الصقها هنا.
        </Banner>
        <textarea className="textarea num" style={{ minHeight: 160, direction: 'rtl' }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'شاي العروسة 250 جم\t15\t10\t100\t6221234567890\tقطعة\nسكر الأسرة 1 كيلو\t32\t28\t50'} autoFocus />
        {warehouses.length > 1 && rows.some((r) => r.qty > 0) && (
          <Field label="الكميات تُضاف إلى مخزن">
            <select className="select" value={wh || warehouses[0]?.id} onChange={(e) => setWh(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
        )}
        {rows.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>الاسم</th><th className="n">سعر البيع</th><th className="n">التكلفة</th><th className="n">الكمية</th><th>الباركود</th><th>الوحدة</th><th /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={r.error ? { opacity: 0.6 } : undefined}>
                    <td className="bold">{r.name}</td>
                    <td className="n">{formatMoney(r.price)}</td>
                    <td className="n">{formatMoney(r.cost)}</td>
                    <td className="n">{formatQty(r.qty)}</td>
                    <td className="num">{r.barcode}</td>
                    <td>{r.unit}</td>
                    <td>{r.error ? <span className="badge red">{r.error}</span> : <span className="badge green"><ClipboardPaste style={{ width: 12, height: 12 }} /> جاهز</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Sheet>
  );
}
