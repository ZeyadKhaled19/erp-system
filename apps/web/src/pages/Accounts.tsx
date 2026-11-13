import { ACCOUNT_TYPE_LABEL, formatMoney, uuid } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Lock, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { PageTabs, TREASURY_TABS } from '../components/ListParts';
import { Banner, Field, SearchBox, Sheet, Switch, SyncBadge, useUi } from '../components/ui';
import { saveMaster } from '../lib/actions';
import { db } from '../lib/db';
import { usePerm, useRemote } from '../lib/hooks';

/** دليل الحسابات الهرمي مع الأرصدة الحالية (من ميزان المراجعة عند الاتصال) */
export function AccountsPage() {
  const can = usePerm();
  const nav = useNavigate();
  const ui = useUi();
  const accounts = useLiveQuery(() => db.accounts.orderBy('code').toArray(), []) ?? [];
  const tb = useRemote<any>(can('reports.financial') ? '/api/reports/trial-balance' : null);
  const bal = useMemo(() => new Map<string, number>((tb.data?.accounts ?? []).map((a: any) => [a.id, a.closing])), [tb.data]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<any | null>(null);

  const children = useMemo(() => {
    const m = new Map<string | null, any[]>();
    accounts.forEach((a) => m.set(a.parent_id ?? null, [...(m.get(a.parent_id ?? null) ?? []), a]));
    return m;
  }, [accounts]);

  const rows: { a: any; depth: number }[] = [];
  const s = q.trim();
  if (s) accounts.filter((a) => a.name.includes(s) || a.code.startsWith(s)).forEach((a) => rows.push({ a, depth: 0 }));
  else {
    const walk = (pid: string | null, depth: number) => {
      for (const a of children.get(pid) ?? []) {
        rows.push({ a, depth });
        if (!closed.has(a.id)) walk(a.id, depth + 1);
      }
    };
    walk(null, 0);
  }

  return (
    <div className="page">
      <PageTabs tabs={TREASURY_TABS} />
      <PageHeader
        title="دليل الحسابات"
        sub="الحسابات الرئيسية تجمع أرصدة فروعها. الحسابات المقفلة يعتمد عليها الترحيل الآلي."
        actions={can('accounts.manage') && <button className="btn primary" onClick={() => setEdit({})}><Plus /> حساب</button>}
      />
      <div style={{ marginBottom: 12 }}><SearchBox value={q} onChange={setQ} placeholder="بحث بالاسم أو الرقم" /></div>
      {tb.error && <div style={{ marginBottom: 12 }}><Banner kind="info">الأرصدة تظهر عند الاتصال بالخادم.</Banner></div>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>الرقم</th><th>اسم الحساب</th><th>النوع</th><th className="n">الرصيد (مدين +)</th><th /></tr></thead>
          <tbody>
            {rows.map(({ a, depth }) => (
              <tr key={a.id} className="click" onClick={() => (a.is_group ? setClosed((c) => { const n = new Set(c); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; }) : can('reports.financial') && nav(`/reports/ledger?account=${a.id}`))}>
                <td className="num">{a.code}</td>
                <td style={{ paddingInlineStart: 12 + depth * 20 }}>
                  <span className="row" style={{ gap: 6 }}>
                    {a.is_group && <ChevronDown style={{ width: 15, height: 15, transform: closed.has(a.id) ? 'rotate(90deg)' : undefined, color: 'var(--label-2)' }} />}
                    <span className={a.is_group ? 'bold' : ''}>{a.name}</span>
                    {a.system_key && <Lock style={{ width: 13, height: 13, color: 'var(--label-3)' }} />}
                    {a.active === false && <span className="badge">موقوف</span>}
                    <SyncBadge sync={a._sync} error={a._error} />
                  </span>
                </td>
                <td className="muted">{ACCOUNT_TYPE_LABEL[a.type]}</td>
                <td className={`n ${a.is_group ? 'bold' : ''}`}>{bal.has(a.id) ? formatMoney(bal.get(a.id)!) : ''}</td>
                <td>{can('accounts.manage') && <button className="btn sm plain" onClick={(e) => { e.stopPropagation(); setEdit(a); }}>تعديل</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <AccountEditor
          acc={edit.id ? edit : null}
          accounts={accounts}
          onClose={() => setEdit(null)}
          onSave={async (d) => {
            await saveMaster('account', edit.id ?? uuid(), d, edit.id ? edit : null);
            ui.toast('تم الحفظ');
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}

function AccountEditor({ acc, accounts, onClose, onSave }: { acc: any | null; accounts: any[]; onClose: () => void; onSave: (d: any) => void }) {
  const [f, setF] = useState({ code: acc?.code ?? '', name: acc?.name ?? '', parent_id: acc?.parent_id ?? '', type: acc?.type ?? 'expense', is_group: acc?.is_group ?? false, active: acc?.active ?? true });
  const [err, setErr] = useState<string | null>(null);
  const groups = accounts.filter((a) => a.is_group && a.id !== acc?.id);
  const pickParent = (pid: string) => {
    const p = accounts.find((a) => a.id === pid);
    let code = f.code;
    if (p && !acc) {
      const sibs = accounts.filter((a) => a.parent_id === pid).map((a) => a.code).filter((c) => /^\d+$/.test(c));
      code = sibs.length ? String(BigInt(sibs.sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1)).at(-1)!) + 1n) : `${p.code}01`;
    }
    setF({ ...f, parent_id: pid, type: p?.type ?? f.type, code });
  };
  return (
    <Sheet
      title={acc ? 'تعديل حساب' : 'حساب جديد'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button
            className="btn primary"
            onClick={() => {
              if (!f.code.trim() || !f.name.trim()) return setErr('الرقم والاسم مطلوبان');
              if (accounts.some((a) => a.code === f.code.trim() && a.id !== acc?.id)) return setErr('رقم الحساب مستخدم');
              onSave({ ...f, code: f.code.trim(), name: f.name.trim(), parent_id: f.parent_id || null });
            }}
          >
            حفظ
          </button>
        </>
      }
    >
      <div className="stack">
        {err && <Banner kind="err">{err}</Banner>}
        {acc?.system_key && <Banner kind="info">حساب نظامي: يمكن تغيير اسمه فقط.</Banner>}
        <Field label="الحساب الرئيسي">
          <select className="select" value={f.parent_id} onChange={(e) => pickParent(e.target.value)} disabled={!!acc?.system_key}>
            <option value="">— بدون (مستوى أول) —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-2">
          <Field label="رقم الحساب"><input className="input num" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} disabled={!!acc?.system_key} /></Field>
          <Field label="النوع">
            <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} disabled={!!f.parent_id || !!acc?.system_key}>
              {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
        <Field label="اسم الحساب"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <div className="row"><Switch checked={f.is_group} onChange={(v) => setF({ ...f, is_group: v })} disabled={!!acc?.system_key} /> حساب رئيسي (تجميعي، لا يُرحّل عليه مباشرة)</div>
        <div className="row"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} disabled={!!acc?.system_key} /> {f.active ? 'نشط' : 'موقوف'}</div>
      </div>
    </Sheet>
  );
}
