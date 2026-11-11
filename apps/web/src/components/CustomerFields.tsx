import { uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm } from '../lib/hooks';
import { PartyEditor } from '../pages/Parties';
import { QuickPartySheet } from './QuickParty';
import { Banner, Field, Picker, Sheet, Switch, useUi } from './ui';

export const CASH_CUSTOMER = 'party-cash-customer';

/** أنواع العملاء/الموردين الفعالة مرتبة */
export function usePartyGroups(kind: 'customer' | 'supplier' = 'customer', withInactive = false) {
  return (
    useLiveQuery(async () => (await db.party_groups.where('kind').equals(kind).toArray()).filter((g) => withInactive || g.active !== false).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name), 'ar')), [kind, withInactive]) ?? []
  );
}

/** إضافة أو تعديل نوع عميل/مورد */
export function PartyGroupSheet({ kind = 'customer', group, onClose, onSaved }: { kind?: 'customer' | 'supplier'; group: any | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const ui = useUi();
  const [name, setName] = useState(group?.name ?? '');
  const [active, setActive] = useState(group?.active ?? true);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    const n = name.trim();
    if (!n) return setErr('اكتب اسم النوع');
    const all = await db.party_groups.where('kind').equals(kind).toArray();
    if (all.some((g) => g.name.trim() === n && g.id !== group?.id)) return setErr('هذا النوع موجود بالفعل');
    const id = group?.id ?? uuid();
    await saveMaster('party_group', id, { name: n, kind, sort: group?.sort ?? Math.max(0, ...all.map((g) => g.sort ?? 0)) + 1, active }, group);
    ui.toast(group ? 'تم تعديل النوع' : `أُضيف النوع «${n}»`);
    onSaved?.(id);
    onClose();
  };
  return (
    <Sheet
      title={group ? 'تعديل نوع العميل' : 'نوع عميل جديد'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn primary" onClick={save}>حفظ</button>
        </>
      }
    >
      <div className="stack" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void save())}>
        {err && <Banner kind="err">{err}</Banner>}
        <Field label="اسم النوع" required hint="مثال: نقدي، آجل، أون لاين، جملة، شركات">
          <input className="input" style={{ fontSize: 17, height: 52 }} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {group && (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>نشط</span>
            <Switch checked={active} onChange={setActive} />
          </div>
        )}
        {group && <div className="footnote">تغيير الاسم يظهر فورًا على كل العملاء من هذا النوع.</div>}
      </div>
    </Sheet>
  );
}

/**
 * خانتان منفصلتان: «نوع العميل» (نقدي/آجل/أون لاين...) و«العميل».
 * النوع يصفّي قائمة العملاء، ولكل خانة زر إضافة وزر تعديل من نفس المكان.
 */
export function CustomerFields({ partyId, onChange, layout = 'stack' }: { partyId: string | null | undefined; onChange: (id: string) => void; layout?: 'stack' | 'row' }) {
  const can = usePerm();
  const groups = usePartyGroups('customer');
  const customers = useLiveQuery(async () => (await db.parties.where('kind').equals('customer').toArray()).filter((p) => p.active !== false), []) ?? [];
  const party = customers.find((p) => p.id === partyId);
  const [groupId, setGroupId] = useState<string>('');
  const [groupSheet, setGroupSheet] = useState<any | undefined>(undefined);
  const [newParty, setNewParty] = useState(false);
  const [editParty, setEditParty] = useState(false);

  // اختيار عميل يضبط النوع على نوعه
  useEffect(() => {
    if (party && party.id !== CASH_CUSTOMER && party.group_id) setGroupId(party.group_id);
  }, [party?.id, party?.group_id]);

  const shown = customers.filter((p) => !groupId || p.group_id === groupId);
  const group = groups.find((g) => g.id === groupId);
  const pickGroup = (id: string) => {
    setGroupId(id);
    if (party && party.id !== CASH_CUSTOMER && id && party.group_id !== id) onChange(CASH_CUSTOMER);
  };

  return (
    <div className={layout === 'row' ? 'grid grid-2' : 'stack'} style={{ gap: 10 }}>
      <div className="field">
        <label>نوع العميل</label>
        <div className="row" style={{ gap: 6 }}>
          <select className="select" style={{ flex: 1 }} value={groupId} onChange={(e) => pickGroup(e.target.value)}>
            <option value="">كل الأنواع</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {can('parties.edit') && group && <button type="button" className="icon-btn" title="تعديل النوع" onClick={() => setGroupSheet(group)}><Pencil /></button>}
          {can('parties.create') && <button type="button" className="icon-btn" title="نوع جديد" onClick={() => setGroupSheet(null)}><Plus /></button>}
        </div>
      </div>
      <div className="field">
        <label>العميل</label>
        <div className="row" style={{ gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Picker
              value={partyId}
              options={shown.map((p) => ({ id: p.id, label: p.name, sub: p.phone ?? p.code, search: `${p.name} ${p.code} ${p.phone ?? ''}` }))}
              onChange={(v) => onChange(v ?? CASH_CUSTOMER)}
              placeholder={group ? `ابحث في عملاء «${group.name}»` : 'عميل نقدي'}
            />
          </div>
          {can('parties.edit') && party && party.id !== CASH_CUSTOMER && <button type="button" className="icon-btn" title="تعديل بيانات العميل" onClick={() => setEditParty(true)}><Pencil /></button>}
          {can('parties.create') && <button type="button" className="icon-btn" title="عميل جديد" onClick={() => setNewParty(true)}><UserPlus /></button>}
        </div>
      </div>

      {groupSheet !== undefined && <PartyGroupSheet group={groupSheet} onClose={() => setGroupSheet(undefined)} onSaved={(id) => setGroupId(id)} />}
      {newParty && <QuickPartySheet groupId={groupId || null} onClose={() => setNewParty(false)} onSaved={(id) => onChange(id)} />}
      {editParty && party && <PartyEditor kind="customer" party={party} onClose={() => setEditParty(false)} onSaved={(id) => onChange(id)} />}
    </div>
  );
}
