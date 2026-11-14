import { formatMoney, formatQty, parseMoney, parseQty, todayISO, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, FileSpreadsheet, Plus, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { saveDocument, saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm, useSettings } from '../lib/hooks';
import { Banner, Field, MoneyInput, QtyInput, Sheet, useUi } from './ui';
import { CategoryField } from './Categories';
import { normalizeAr } from '../lib/search';

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
export function QuickItemSheet({ onClose, onSaved, onAdvanced, initialName = '' }: { onClose: () => void; onSaved?: (id: string) => void; onAdvanced?: () => void; initialName?: string }) {
  const ui = useUi();
  const can = usePerm();
  const settings = useSettings();
  const cats = useLiveQuery(async () => (await db.categories.toArray()).filter((c) => c.active !== false), []) ?? [];
  const warehouses = useLiveQuery(async () => (await db.warehouses.toArray()).filter((w) => w.active !== false), []) ?? [];
  const empty = { name: '', price: 0, cost: 0, qty: 0, barcode: '', cat: 'cat-general', unit: 'قطعة' };
  const [f, setF] = useState({ ...empty, name: initialName });
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
        <CategoryField value={f.cat} onChange={(id) => setF({ ...f, cat: id })} />
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

/** الحقول التي يمكن ربط أعمدة الشيت بها */
const FIELDS = [
  { key: '', label: 'تجاهل هذا العمود' },
  { key: 'name', label: 'اسم الصنف' },
  { key: 'code', label: 'الكود' },
  { key: 'barcode', label: 'الباركود' },
  { key: 'price', label: 'سعر البيع' },
  { key: 'wholesale', label: 'سعر الجملة' },
  { key: 'cost', label: 'سعر التكلفة' },
  { key: 'qty', label: 'الكمية' },
  { key: 'unit', label: 'الوحدة' },
  { key: 'cat', label: 'التصنيف' },
] as const;
type FieldKey = (typeof FIELDS)[number]['key'];

/** أسماء العناوين المعروفة لكل حقل (عربي وإنجليزي) لتمييزها تلقائيًا */
const ALIASES: Record<Exclude<FieldKey, ''>, string[]> = {
  name: ['اسم الصنف', 'الصنف', 'الاسم', 'اسم المنتج', 'المنتج', 'البيان', 'الوصف', 'name', 'item', 'item name', 'product', 'product name', 'description'],
  code: ['الكود', 'كود الصنف', 'رقم الصنف', 'كود', 'code', 'item code', 'sku', 'id'],
  barcode: ['الباركود', 'باركود', 'barcode', 'ean', 'upc'],
  price: ['سعر البيع', 'السعر', 'سعر', 'سعر القطاعي', 'سعر المستهلك', 'price', 'sale price', 'selling price', 'retail price'],
  wholesale: ['سعر الجملة', 'الجملة', 'جملة', 'wholesale', 'wholesale price'],
  cost: ['سعر التكلفة', 'التكلفة', 'سعر الشراء', 'الشراء', 'تكلفة', 'cost', 'cost price', 'purchase price'],
  qty: ['الكمية', 'كمية', 'الرصيد', 'رصيد', 'المخزون', 'العدد', 'qty', 'quantity', 'stock', 'balance'],
  unit: ['الوحدة', 'وحدة', 'unit', 'uom'],
  cat: ['التصنيف', 'تصنيف', 'المجموعة', 'مجموعة', 'القسم', 'الفئة', 'category', 'group', 'department'],
};
const POSITIONAL: FieldKey[] = ['name', 'price', 'cost', 'qty', 'barcode', 'unit', 'cat'];

const cellText = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();
function guessField(header: string): FieldKey {
  const h = normalizeAr(header).replace(/[:*()]/g, '').trim();
  if (!h) return '';
  for (const [k, list] of Object.entries(ALIASES)) if (list.some((a) => normalizeAr(a) === h)) return k as FieldKey;
  for (const [k, list] of Object.entries(ALIASES)) if (list.some((a) => a.length > 2 && h.includes(normalizeAr(a)))) return k as FieldKey;
  return '';
}
/** رقم من خلية: يقبل الأرقام العربية والفواصل ويتجاهل رموز العملة */
const num = (v: string, parse: (x: string) => number) => {
  const s = v.replace(/[^\d٠-٩.,٫٬-]/g, '');
  return s ? parse(s) : 0;
};

/**
 * استيراد أصناف من ملف Excel (.xlsx) أو CSV أو بلصق جدول:
 * يتعرف على العناوين تلقائيًا بأي ترتيب، ويمكن تعديل معنى كل عمود قبل الاستيراد.
 */
export function ImportItemsSheet({ onClose }: { onClose: () => void }) {
  const ui = useUi();
  const can = usePerm();
  const settings = useSettings();
  const warehouses = useLiveQuery(async () => (await db.warehouses.toArray()).filter((w) => w.active !== false), []) ?? [];
  const existing = useLiveQuery(async () => {
    const all = await db.items.toArray();
    return { names: new Set(all.map((i) => i.name.trim())), barcodes: new Set(all.map((i) => i.barcode).filter(Boolean)), codes: new Set(all.map((i) => String(i.code))) };
  }, []);
  const cats = useLiveQuery(async () => (await db.categories.toArray()).filter((c) => c.active !== false), []) ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ name: string; sheets: { sheet: string; data: unknown[][] }[] } | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [map, setMap] = useState<FieldKey[] | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [wh, setWh] = useState('');
  const [defCat, setDefCat] = useState('cat-general');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [readErr, setReadErr] = useState<string | null>(null);

  // الجدول الخام (كل الصفوف كنصوص) من الملف أو من اللصق
  const raw: string[][] = useMemo(() => {
    const src: unknown[][] = file ? file.sheets[sheetIdx]?.data ?? [] : text.split(/\r?\n/).map((l) => l.split(/\t|;/));
    return src.map((r) => r.map(cellText)).filter((r) => r.some(Boolean));
  }, [file, sheetIdx, text]);
  const width = Math.max(0, ...raw.slice(0, 50).map((r) => r.length));

  // تخمين الربط من سطر العناوين عند تغيّر البيانات
  const guessed = useMemo(() => {
    const first = raw[0] ?? [];
    const g = first.map(guessField);
    const header = g.filter(Boolean).length >= 1 && g.includes('name');
    return { header, map: header ? g : Array.from({ length: width }, (_, i) => POSITIONAL[i] ?? '') };
  }, [raw, width]);
  const sig = `${file?.name ?? 'paste'}:${sheetIdx}:${raw[0]?.join('|') ?? ''}:${width}`;
  const [sigSeen, setSigSeen] = useState('');
  if (sig !== sigSeen) {
    setSigSeen(sig);
    setMap(guessed.map);
    setHasHeader(guessed.header);
  }
  const m = map ?? guessed.map;
  const col = (k: FieldKey) => m.indexOf(k);

  const rows = useMemo(() => {
    const out: { name: string; code: string; barcode: string; price: number; wholesale: number; cost: number; qty: number; unit: string; cat: string; error?: string }[] = [];
    const seen = new Set<string>();
    const seenCodes = new Set<string>();
    const get = (r: string[], k: FieldKey) => (col(k) >= 0 ? r[col(k)] ?? '' : '');
    for (const r of raw.slice(hasHeader ? 1 : 0)) {
      const name = get(r, 'name');
      if (!name) continue;
      let price = 0, wholesale = 0, cost = 0, qty = 0;
      let error: string | undefined;
      try {
        price = num(get(r, 'price'), parseMoney);
        wholesale = num(get(r, 'wholesale'), parseMoney);
        cost = num(get(r, 'cost'), parseMoney);
        qty = num(get(r, 'qty'), parseQty);
      } catch {
        error = 'رقم غير صالح';
      }
      if (price < 0 || cost < 0 || wholesale < 0) error = 'سعر بالسالب';
      const code = get(r, 'code');
      const barcode = get(r, 'barcode');
      if (!error && (existing?.names.has(name) || seen.has(name))) error = 'الاسم موجود';
      else if (!error && code && (existing?.codes.has(code) || seenCodes.has(code))) error = 'الكود مستخدم';
      else if (!error && barcode && existing?.barcodes.has(barcode)) error = 'الباركود مستخدم';
      seen.add(name);
      if (code) seenCodes.add(code);
      out.push({ name: name.slice(0, 200), code: code.slice(0, 50), barcode: barcode.slice(0, 64), price, wholesale, cost, qty, unit: (get(r, 'unit') || 'قطعة').slice(0, 30), cat: get(r, 'cat').slice(0, 100), error });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, m.join(','), hasHeader, existing]);
  const ok = rows.filter((r) => !r.error);

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setReadErr(null);
    try {
      if (/\.csv$|\.txt$/i.test(f.name)) {
        const t = await f.text();
        const sep = (t.split('\n')[0].match(/\t/g)?.length ?? 0) > 0 ? '\t' : (t.split('\n')[0].match(/;/g)?.length ?? 0) > (t.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
        const data = t.split(/\r?\n/).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '')));
        setFile({ name: f.name, sheets: [{ sheet: 'CSV', data }] });
      } else if (/\.xlsx$/i.test(f.name)) {
        const { default: readXlsxFile } = await import('read-excel-file/browser');
        const sheets = await readXlsxFile(f);
        setFile({ name: f.name, sheets: sheets.map((s) => ({ sheet: s.sheet, data: s.data as unknown[][] })) });
      } else if (/\.xls$/i.test(f.name)) {
        setReadErr('هذا ملف Excel قديم (.xls). افتحه في Excel واحفظه باسم «Excel Workbook (.xlsx)» ثم اختره مرة أخرى.');
        return;
      } else {
        setReadErr('اختر ملف Excel بصيغة .xlsx أو ملف .csv');
        return;
      }
      setSheetIdx(0);
      setText('');
    } catch (e) {
      setReadErr(`تعذّرت قراءة الملف: ${(e as Error).message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const run = async () => {
    setBusy(true);
    setProgress(0);
    const opening: { item_id: string; unit: string; qty: number; cost: number }[] = [];
    let n = 0;
    // التصنيف بالاسم: يُستخدم الموجود أو يُنشأ تصنيف جديد مرة واحدة
    const catIds = new Map(cats.map((c) => [normalizeAr(c.name), c.id]));
    const catFor = async (name: string) => {
      const k = normalizeAr(name);
      if (!k) return defCat || 'cat-general';
      let id = catIds.get(k);
      if (!id) {
        id = uuid();
        await saveMaster('category', id, { name: name.trim(), active: true });
        catIds.set(k, id);
      }
      return id;
    };
    try {
      for (const r of ok) {
        const id = uuid();
        await saveMaster('item', id, {
          code: r.code || (await nextCode()), name: r.name, barcode: r.barcode || null, category_id: await catFor(r.cat), base_unit: r.unit,
          sale_price: r.price, wholesale_price: r.wholesale, reorder_level: 0, tax_rate_bp: settings.default_tax_rate_bp ?? 0, active: true, notes: null, units: [], prices: [],
        });
        if (r.qty > 0 && can('inventory.create')) opening.push({ item_id: id, unit: r.unit, qty: r.qty, cost: r.cost });
        n++;
        if (n % 10 === 0) setProgress(n);
      }
      // رصيد أول المدة على دفعات حتى لا يكون المستند ضخمًا جدًا
      for (let i = 0; i < opening.length; i += 200) await postOpening(wh || warehouses[0]?.id, opening.slice(i, i + 200));
      ui.toast(`تم استيراد ${n} صنف${opening.length ? ` ورصيد ${opening.length} منها` : ''}`);
      onClose();
    } catch (e) {
      ui.toast(`توقف الاستيراد بعد ${n} صنف: ${(e as Error).message}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const sample = raw.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + 1)[0] ?? [];
  return (
    <Sheet
      title="استيراد أصناف من Excel"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="footnote" style={{ flex: 1 }}>
            {busy ? `جارٍ الاستيراد… ${progress} / ${ok.length}` : rows.length ? `${ok.length} جاهز للاستيراد${rows.length - ok.length ? ` · ${rows.length - ok.length} لن تُستورد (موضح السبب)` : ''}` : ''}
          </span>
          <button className="btn" onClick={onClose} disabled={busy}>إلغاء</button>
          <button className="btn primary" disabled={!ok.length || busy || col('name') < 0} onClick={run}>استيراد {ok.length || ''} صنف</button>
        </>
      }
    >
      <div className="stack">
        <div className="imp-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pickFile(e.dataTransfer.files?.[0]); }}>
          <FileSpreadsheet />
          <div style={{ flex: 1 }}>
            <b>{file ? file.name : 'اختر ملف Excel أو اسحبه هنا'}</b>
            <div className="muted small">ملف ‎.xlsx أو ‎.csv — يتعرف البرنامج على أسماء الأعمدة تلقائيًا بأي ترتيب (اسم الصنف، السعر، الكمية، التصنيف…)</div>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.xls" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
          {file && <button className="btn plain" onClick={() => { setFile(null); setSheetIdx(0); }}>إزالة</button>}
          <button className="btn primary" onClick={() => fileRef.current?.click()}><Upload /> {file ? 'ملف آخر' : 'اختر ملف'}</button>
        </div>
        {readErr && <Banner kind="err">{readErr}</Banner>}
        {!file && (
          <details className="imp-paste">
            <summary>أو الصق الصفوف من Excel مباشرة</summary>
            <textarea className="textarea num" style={{ minHeight: 120, direction: 'rtl', marginTop: 8 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'اسم الصنف\tسعر البيع\tالكمية\tالتصنيف\nشاي العروسة 250 جم\t15\t100\tمشروبات'} />
          </details>
        )}
        {file && file.sheets.length > 1 && (
          <Field label="الورقة (Sheet)">
            <select className="select" value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.target.value))}>
              {file.sheets.map((s, i) => <option key={i} value={i}>{s.sheet} ({s.data.filter((r) => r.some((c) => cellText(c))).length} صف)</option>)}
            </select>
          </Field>
        )}

        {raw.length > 0 && (
          <>
            <div className="imp-map-h">
              <b>معنى كل عمود</b>
              <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> الصف الأول عناوين</label>
            </div>
            <div className="imp-map">
              {Array.from({ length: width }, (_, i) => (
                <div key={i} className={`imp-col ${m[i] ? 'on' : ''}`}>
                  <div className="imp-col-h" title={raw[0]?.[i]}>{hasHeader ? raw[0]?.[i] || `عمود ${i + 1}` : `عمود ${i + 1}`}</div>
                  <select className="select" value={m[i] ?? ''} onChange={(e) => { const n = [...m]; const v = e.target.value as FieldKey; if (v) n.forEach((x, j) => { if (x === v) n[j] = ''; }); n[i] = v; setMap(n); }}>
                    {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                  <div className="imp-col-s muted small" title={sample[i]}>{sample[i] || '—'}</div>
                </div>
              ))}
            </div>
            {col('name') < 0 && <Banner kind="warn">حدد أي عمود فيه «اسم الصنف» حتى يمكن الاستيراد.</Banner>}
          </>
        )}

        {rows.length > 0 && (
          <>
            <div className="grid grid-2">
              {col('cat') < 0 || rows.some((r) => !r.cat) ? (
                <Field label={col('cat') < 0 ? 'تصنيف كل الأصناف المستوردة' : 'تصنيف الأصناف التي ليس لها تصنيف في الشيت'}>
                  <select className="select" value={defCat} onChange={(e) => setDefCat(e.target.value)}>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              ) : <div />}
              {warehouses.length > 1 && rows.some((r) => r.qty > 0) && (
                <Field label="الكميات تُضاف إلى مخزن">
                  <select className="select" value={wh || warehouses[0]?.id} onChange={(e) => setWh(e.target.value)}>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="table">
                <thead><tr><th>الاسم</th><th>الكود</th><th className="n">سعر البيع</th><th className="n">الجملة</th><th className="n">التكلفة</th><th className="n">الكمية</th><th>الوحدة</th><th>التصنيف</th><th /></tr></thead>
                <tbody>
                  {rows.slice(0, 500).map((r, i) => (
                    <tr key={i} style={r.error ? { opacity: 0.6 } : undefined}>
                      <td className="bold">{r.name}</td>
                      <td className="num muted">{r.code || 'تلقائي'}</td>
                      <td className="n">{formatMoney(r.price)}</td>
                      <td className="n">{r.wholesale ? formatMoney(r.wholesale) : '—'}</td>
                      <td className="n">{formatMoney(r.cost)}</td>
                      <td className="n">{formatQty(r.qty)}</td>
                      <td>{r.unit}</td>
                      <td>{r.cat || <span className="muted">{cats.find((c) => c.id === defCat)?.name}</span>}</td>
                      <td>{r.error ? <span className="badge red">{r.error}</span> : <span className="badge green"><Check style={{ width: 12, height: 12 }} /> جاهز</span>}</td>
                    </tr>
                  ))}
                  {rows.length > 500 && <tr><td colSpan={9} className="muted">… و{rows.length - 500} صف آخر</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
