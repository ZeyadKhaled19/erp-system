import { formatMoney, formatQty } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { PackageSearch } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Empty, SearchBox, SyncBadge } from '../components/ui';
import { db } from '../lib/db';
import { ItemInsights } from '../components/Insights';
import { useDebounced, usePerm } from '../lib/hooks';

/** استعلام عن صنف: بحث بالكود أو الاسم أو الباركود ويعرض الأسعار والأرصدة في كل مخزن (يعمل دون اتصال) */
export function ItemInquiry() {
  const [params, setParams] = useSearchParams();
  const can = usePerm();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 150);
  const id = params.get('id');

  const matches = useLiveQuery(async () => {
    const s = dq.trim().toLowerCase();
    if (!s) return [];
    const unitHit = await db.item_units.where('barcode').equals(dq.trim()).first();
    if (unitHit) return [await db.items.get(unitHit.item_id)].filter(Boolean) as any[];
    return db.items.filter((i) => [i.name, i.code, i.barcode].some((v) => v?.toLowerCase().includes(s))).limit(30).toArray();
  }, [dq]) ?? [];

  const detail = useLiveQuery(async () => {
    if (!id) return null;
    const item = await db.items.get(id);
    if (!item) return null;
    const units = (await db.item_units.where('item_id').equals(id).toArray()).filter((u) => u.active !== false);
    const bal = await db.stock_balances.where('item_id').equals(id).toArray();
    const whs = new Map((await db.warehouses.toArray()).map((w) => [w.id, w]));
    const cat = item.category_id ? await db.categories.get(item.category_id) : null;
    return { item, units, bal: bal.map((b) => ({ ...b, wh: whs.get(b.warehouse_id)?.name ?? '' })), cat };
  }, [id]);

  const total = useMemo(() => (detail?.bal ?? []).reduce((s, b) => s + b.qty, 0), [detail]);

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHeader title="استعلام عن صنف" sub="ابحث بالاسم أو الكود أو امسح الباركود" />
      <SearchBox
        value={q}
        onChange={setQ}
        autoFocus
        placeholder="اسم الصنف أو الكود أو الباركود"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) {
            setParams({ id: matches[0].id });
            setQ('');
          }
        }}
      />
      {dq && (
        <div className="list" style={{ marginTop: 10 }}>
          {matches.length === 0 && <div className="list-row muted">لا نتائج</div>}
          {matches.map((m) => (
            <div key={m.id} className="list-row tappable" onClick={() => { setParams({ id: m.id }); setQ(''); }}>
              <div className="title">
                {m.name}
                <div className="sub num">{m.code}{m.barcode ? ` · ${m.barcode}` : ''}</div>
              </div>
              <div className="num">{formatMoney(m.sale_price)}</div>
            </div>
          ))}
        </div>
      )}

      {!dq && !detail && (
        <div className="card" style={{ marginTop: 16 }}>
          <Empty icon={<PackageSearch />} title="ابحث عن صنف">يمكنك استخدام ماسح الباركود مباشرة في خانة البحث.</Empty>
        </div>
      )}

      {!dq && detail && (
        <>
          <div className="group-header">بيانات الصنف</div>
          <div className="list">
            <Row k="الاسم" v={<span className="bold">{detail.item.name} <SyncBadge sync={detail.item._sync} error={detail.item._error} /></span>} />
            <Row k="الكود" v={<span className="num">{detail.item.code}</span>} />
            {detail.item.barcode && <Row k="الباركود" v={<span className="num">{detail.item.barcode}</span>} />}
            <Row k="التصنيف" v={detail.cat?.name ?? '—'} />
            <Row k="الوحدة الأساسية" v={detail.item.base_unit} />
            <Row k="سعر البيع" v={<span className="num">{formatMoney(detail.item.sale_price)}</span>} />
            <Row k="سعر الجملة" v={<span className="num">{formatMoney(detail.item.wholesale_price)}</span>} />
            {can('costs.view') && <Row k="متوسط التكلفة" v={<span className="num">{formatMoney(detail.item.avg_cost ?? 0)}</span>} />}
            {can('costs.view') && <Row k="آخر سعر شراء" v={<span className="num">{formatMoney(detail.item.last_cost ?? 0)}</span>} />}
            <Row k="حد إعادة الطلب" v={<span className="num">{formatQty(detail.item.reorder_level)}</span>} />
          </div>

          {detail.units.length > 0 && (
            <>
              <div className="group-header">الوحدات</div>
              <div className="list">
                {detail.units.map((u) => (
                  <Row key={u.id} k={`${u.name} = ${formatQty(u.factor)} ${detail.item.base_unit}`} v={<span className="num">{formatMoney(u.sale_price)}</span>} />
                ))}
              </div>
            </>
          )}

          <div className="group-header">الرصيد حسب المخزن</div>
          <div className="list">
            {detail.bal.length === 0 && <div className="list-row muted">لا يوجد رصيد</div>}
            {detail.bal.map((b) => (
              <Row key={b.warehouse_id} k={b.wh} v={<span className={`num bold ${b.qty < 0 ? 'red' : ''}`}>{formatQty(b.qty)} {detail.item.base_unit}</span>} />
            ))}
            <Row k={<span className="bold">الإجمالي</span>} v={<span className="num bold">{formatQty(total)}</span>} />
          </div>
          <div className="group-footer">الأرصدة حسب آخر مزامنة مع الخادم.</div>

          <ItemInsights item={detail.item} />
          {can('inventory.view') && (
            <button className="btn block" style={{ marginTop: 16 }} onClick={() => nav(`/reports/item?id=${detail.item.id}`)}>
              عرض حركة الصنف
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="list-row">
      <div className="title">{k}</div>
      <div>{v}</div>
    </div>
  );
}
