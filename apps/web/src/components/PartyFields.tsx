import { uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, ListChecks, Pencil, Plus, Trash2, Type } from 'lucide-react';
import { useState } from 'react';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm } from '../lib/hooks';
import { Banner, Field, Segmented, Sheet, Switch, useUi } from './ui';

/**
 * خانات حرة لبيانات العملاء والموردين: المسئول بيضيف أي خانة بالاسم اللي هو عايزه
 * (ماركة، موديل، نوع العربية، المقاس...). كل خانة يا إما قائمة اختيارات بيحددها هو، يا إما كلام حر.
 * قيمة كل عميل محفوظة في party.custom = { id الخانة: id الاختيار أو النص }.
 */
export type FieldOption = { id: string; name: string; active?: boolean };
export type PartyField = { id: string; name: string; kind: 'list' | 'text'; applies_to: 'customer' | 'supplier' | 'both'; options: FieldOption[]; sort?: number; active?: boolean; version?: number };
type Kind = 'customer' | 'supplier';

const parseOptions = (o: unknown): FieldOption[] => (Array.isArray(o) ? o : typeof o === 'string' ? (() => { try { return JSON.parse(o); } catch { return []; } })() : []);
const norm = (f: any): PartyField => ({ ...f, kind: f.kind === 'text' ? 'text' : 'list', applies_to: f.applies_to ?? 'customer', options: parseOptions(f.options) });
const appliesTo = (f: PartyField, kind?: Kind) => !kind || f.applies_to === 'both' || f.applies_to === kind;

/** قيم الخانات الحرة لعميل (بتقبل نص JSON أو object) */
export function customOf(p: any): Record<string, string> {
  const c = p?.custom;
  if (!c) return {};
  if (typeof c === 'string') { try { return JSON.parse(c) ?? {}; } catch { return {}; } }
  return c;
}

/** الخانات مرتبة؛ kind بيفلتر على العملاء أو الموردين */
export function usePartyFields(kind?: Kind, withInactive = false): PartyField[] {
  return (
    useLiveQuery(async () => (await db.party_fields.toArray()).map(norm).filter((f) => (withInactive || f.active !== false) && appliesTo(f, kind)).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name, 'ar')), [kind, withInactive]) ?? []
  );
}

/** النص اللي يتعرض لقيمة خانة عند عميل */
export function fieldValueText(f: PartyField, v: string | null | undefined): string {
  if (!v) return '';
  if (f.kind === 'text') return v;
  return f.options.find((o) => o.id === v)?.name ?? '';
}

/** خانات العميل في نموذج الإضافة/التعديل */
export function PartyFieldInputs({ kind, value, onChange }: { kind: Kind; value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const fields = usePartyFields(kind);
  const can = usePerm();
  const ui = useUi();
  const [adding, setAdding] = useState<{ field: PartyField; name: string } | null>(null);
  if (!fields.length) return null;
  const set = (id: string, v: string) => {
    const next = { ...value };
    if (v.trim()) next[id] = v; else delete next[id];
    onChange(next);
  };
  const addOption = async () => {
    if (!adding) return;
    const n = adding.name.trim();
    if (!n) return;
    const f = adding.field;
    const same = f.options.find((o) => o.name.trim().toLowerCase() === n.toLowerCase());
    if (same) { set(f.id, same.id); setAdding(null); return; }
    const opt = { id: uuid(), name: n, active: true };
    const row = await db.party_fields.get(f.id);
    await saveMaster('party_field', f.id, { name: f.name, kind: f.kind, applies_to: f.applies_to, options: [...f.options, opt], sort: f.sort ?? 0, active: f.active !== false }, row);
    set(f.id, opt.id);
    ui.toast(`أُضيف «${n}» إلى ${f.name}`);
    setAdding(null);
  };
  return (
    <>
      {fields.map((f) => {
        const v = value[f.id] ?? '';
        if (f.kind === 'text') {
          return (
            <Field key={f.id} label={f.name}>
              <input className="input" value={v} maxLength={300} onChange={(e) => set(f.id, e.target.value)} />
            </Field>
          );
        }
        const opts = f.options.filter((o) => o.active !== false || o.id === v);
        return (
          <Field key={f.id} label={f.name}>
            {adding?.field.id === f.id ? (
              <div className="row" style={{ gap: 6 }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void addOption(); } if (e.key === 'Escape') { e.stopPropagation(); setAdding(null); } }}>
                <input className="input" style={{ flex: 1 }} autoFocus placeholder={`اختيار جديد في «${f.name}»`} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
                <button type="button" className="btn primary" onClick={() => void addOption()}>إضافة</button>
                <button type="button" className="btn" onClick={() => setAdding(null)}>إلغاء</button>
              </div>
            ) : (
              <div className="row" style={{ gap: 6 }}>
                <select className="select" style={{ flex: 1 }} value={v} onChange={(e) => set(f.id, e.target.value)} aria-label={f.name}>
                  <option value="">{opts.length ? '— اختار —' : 'لسه مفيش اختيارات'}</option>
                  {opts.map((o) => <option key={o.id} value={o.id}>{o.name}{o.active === false ? ' (موقوف)' : ''}</option>)}
                </select>
                {can('settings.manage') && <button type="button" className="btn" title="اختيار جديد" aria-label={`إضافة اختيار جديد في ${f.name}`} onClick={() => setAdding({ field: f, name: '' })}><Plus /></button>}
              </div>
            )}
          </Field>
        );
      })}
    </>
  );
}

/** إضافة أو تعديل خانة: الاسم، النوع، لمين، والاختيارات */
export function PartyFieldSheet({ field, defaultKind = 'customer', onClose }: { field: PartyField | null; defaultKind?: Kind; onClose: () => void }) {
  const ui = useUi();
  const all = usePartyFields(undefined, true);
  const [name, setName] = useState(field?.name ?? '');
  const [kind, setKind] = useState<'list' | 'text'>(field?.kind ?? 'list');
  const [applies, setApplies] = useState<PartyField['applies_to']>(field?.applies_to ?? defaultKind);
  const [options, setOptions] = useState<(FieldOption & { _new?: boolean })[]>(field?.options ?? []);
  const [active, setActive] = useState(field?.active !== false);
  const [newOpt, setNewOpt] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addOpt = () => {
    const n = newOpt.trim();
    if (!n) return;
    if (options.some((o) => o.name.trim().toLowerCase() === n.toLowerCase())) return setErr(`«${n}» موجود بالفعل`);
    setErr(null);
    setOptions([...options, { id: uuid(), name: n, active: true, _new: true }]);
    setNewOpt('');
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= options.length) return;
    const n = [...options];
    [n[i], n[j]] = [n[j], n[i]];
    setOptions(n);
  };
  const save = async () => {
    setErr(null);
    const n = name.trim();
    if (!n) return setErr('اكتب اسم الخانة، مثلًا: الماركة أو الموديل');
    if (all.some((f) => f.id !== field?.id && f.name.trim() === n)) return setErr('فيه خانة بنفس الاسم');
    const clean = options.map(({ _new, ...o }) => ({ ...o, name: o.name.trim() }));
    if (clean.some((o) => !o.name)) return setErr('فيه اختيار من غير اسم');
    const names = clean.map((o) => o.name.toLowerCase());
    if (new Set(names).size !== names.length) return setErr('فيه اختيارين بنفس الاسم');
    if (kind === 'list' && !clean.length) return setErr('ضيف اختيار واحد على الأقل، أو خلّي الخانة «كلام حر»');
    setBusy(true);
    const id = field?.id ?? `pf-${uuid()}`;
    const row = field ? await db.party_fields.get(field.id) : null;
    const sort = field?.sort ?? Math.max(0, ...all.map((f) => f.sort ?? 0)) + 1;
    await saveMaster('party_field', id, { name: n, kind, applies_to: applies, options: clean, sort, active }, row);
    ui.toast(field ? 'تم حفظ الخانة' : `أُضيفت خانة «${n}»`);
    onClose();
  };

  return (
    <Sheet
      title={field ? `تعديل خانة «${field.name}»` : 'خانة جديدة'}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn primary" disabled={busy} onClick={save}>حفظ</button></>}
    >
      <div className="stack">
        {err && <Banner kind="err">{err}</Banner>}
        <Field label="اسم الخانة" required hint="ده اللي هيظهر في بيانات العميل، مثلًا: الماركة، الموديل، نوع العربية، المقاس">
          <input className="input" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="نوع الخانة">
          <Segmented<'list' | 'text'>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'list', label: <><ListChecks style={{ width: 15, height: 15, verticalAlign: -3 }} /> قائمة اختيارات</> },
              { value: 'text', label: <><Type style={{ width: 15, height: 15, verticalAlign: -3 }} /> كلام حر</> },
            ]}
          />
        </Field>
        <Field label="تظهر في بيانات">
          <select className="select" value={applies} onChange={(e) => setApplies(e.target.value as PartyField['applies_to'])}>
            <option value="customer">العملاء</option>
            <option value="supplier">الموردين</option>
            <option value="both">العملاء والموردين</option>
          </select>
        </Field>
        {kind === 'list' && (
          <>
            <div className="bold">الاختيارات</div>
            {options.length === 0 && <div className="footnote">لسه مفيش اختيارات. اكتب أول اختيار تحت واضغط «إضافة».</div>}
            {options.map((o, i) => (
              <div key={o.id} className="row" style={{ gap: 6 }}>
                <input className="input" style={{ flex: 1, opacity: o.active === false ? 0.55 : 1 }} value={o.name} maxLength={80} aria-label={`اسم الاختيار ${i + 1}`} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <button type="button" className="icon-btn" aria-label="لفوق" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></button>
                <button type="button" className="icon-btn" aria-label="لتحت" disabled={i === options.length - 1} onClick={() => move(i, 1)}><ArrowDown /></button>
                {o._new ? (
                  <button type="button" className="icon-btn" aria-label="حذف" style={{ color: 'var(--red-text)' }} onClick={() => setOptions(options.filter((_, j) => j !== i))}><Trash2 /></button>
                ) : (
                  <label className="row small" style={{ gap: 4 }} title="الموقوف ما بيظهرش في الاختيار، والعملاء القدام بيفضلوا عليه">
                    <Switch checked={o.active !== false} onChange={(v) => setOptions(options.map((x, j) => (j === i ? { ...x, active: v } : x)))} />
                  </label>
                )}
              </div>
            ))}
            <div className="row" style={{ gap: 6 }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addOpt(); } }}>
              <input className="input" style={{ flex: 1 }} placeholder="اختيار جديد" value={newOpt} maxLength={80} onChange={(e) => setNewOpt(e.target.value)} />
              <button type="button" className="btn" onClick={addOpt}><Plus /> إضافة</button>
            </div>
          </>
        )}
        {field && (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>الخانة {active ? 'شغالة' : 'موقوفة'}</span>
            <Switch checked={active} onChange={setActive} />
          </div>
        )}
        {field && <div className="footnote">تغيير اسم الخانة أو أي اختيار بيظهر فورًا على كل العملاء. الإيقاف بيخفي من غير ما يمسح بيانات العملاء.</div>}
      </div>
    </Sheet>
  );
}

/** إدارة الخانات كلها: إضافة وتعديل وترتيب، ومعاها عدد العملاء اللي مالين كل خانة */
export function PartyFieldsManager({ kind = 'customer', onClose }: { kind?: Kind; onClose: () => void }) {
  const fields = usePartyFields(undefined, true);
  const filled = useLiveQuery(async () => {
    const m = new Map<string, number>();
    (await db.parties.toArray()).forEach((p) => Object.entries(customOf(p)).forEach(([k, v]) => v && m.set(k, (m.get(k) ?? 0) + 1)));
    return m;
  }, []) ?? new Map<string, number>();
  const [edit, setEdit] = useState<PartyField | null | undefined>(undefined);
  const label = { customer: 'العملاء', supplier: 'الموردين', both: 'العملاء والموردين' } as const;
  return (
    <Sheet title="خانات بيانات العملاء" onClose={onClose} footer={<button className="btn primary" onClick={() => setEdit(null)}><Plus /> خانة جديدة</button>}>
      <div className="stack">
        <div className="footnote">ضيف أي خانة محتاجها لبيانات العملاء أو الموردين، زي «الماركة» أو «الموديل» أو «نوع العربية». الموظفين بيملوها في بيانات العميل، وتقدر تفلتر بيها وتطلع تقرير «العملاء حسب خانة».</div>
        {fields.length === 0 ? (
          <div className="card pad muted">لسه مفيش خانات. اضغط «خانة جديدة» وضيف أول خانة.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الخانة</th><th>النوع</th><th>تظهر في</th><th className="n">متسجلة عند</th><th>الحالة</th><th /></tr></thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id} className="click" onClick={() => setEdit(f)}>
                    <td className="bold">{f.name}</td>
                    <td className="muted">{f.kind === 'list' ? `قائمة (${f.options.filter((o) => o.active !== false).length} اختيار)` : 'كلام حر'}</td>
                    <td className="muted">{label[f.applies_to]}</td>
                    <td className="n">{filled.get(f.id) ?? 0}</td>
                    <td><span className={`badge ${f.active !== false ? 'green' : 'red'}`}>{f.active !== false ? 'شغالة' : 'موقوفة'}</span></td>
                    <td className="lp-act-cell"><button type="button" className="lp-act" aria-label={`تعديل ${f.name}`} onClick={(e) => { e.stopPropagation(); setEdit(f); }}><Pencil /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit !== undefined && <PartyFieldSheet field={edit} defaultKind={kind} onClose={() => setEdit(undefined)} />}
    </Sheet>
  );
}
