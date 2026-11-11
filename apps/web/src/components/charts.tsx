import { formatMoney } from '@erp/shared';

/** أعمدة شهرية بسيطة بتسميات */
export function MonthBars({ data, height = 140 }: { data: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, paddingTop: 18 }}>
      {data.map((d, i) => {
        const h = Math.max(3, (Math.abs(d.value) / max) * (height - 38));
        const last = i === data.length - 1;
        return (
          <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }} title={`${d.label}: ${formatMoney(d.value)}`}>
            <div style={{ width: '70%', maxWidth: 34, height: h, borderRadius: 6, background: last ? 'var(--grad-accent)' : 'var(--tint-soft)', boxShadow: last ? '0 6px 14px var(--tint-glow)' : undefined }} />
            <div className="caption" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

/** قائمة أشرطة أفقية (أعلى الأصناف / العملاء) */
export function HBarList({ rows, money = true }: { rows: { label: string; value: number; sub?: string }[]; money?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="muted small">لا توجد بيانات</div>;
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} className="hbar">
          <div className="hb-label" title={r.label}>{r.label}</div>
          <div className="hb-track"><div className="hb-fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <div className="hb-val">{money ? formatMoney(r.value) : r.sub ?? r.value}</div>
        </div>
      ))}
    </div>
  );
}

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
/** آخر N شهر بمفتاح YYYY-MM واسم مختصر */
export function lastMonths(n: number) {
  const out: { key: string; label: string }[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`, label: AR_MONTHS[x.getMonth()].slice(0, 5) });
  }
  return out;
}
