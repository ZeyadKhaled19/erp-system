import { formatMoney, formatQty } from '@erp/shared';
import { CheckCircle2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { SectionCard, SectionHeader } from '../components/Section';
import { Banner } from '../components/ui';
import { useRemote } from '../lib/hooks';

interface Issue { name: string; stored: number; computed: number; id?: string }
interface Check { key: string; label: string; unit: 'money' | 'qty' | 'count'; checked: number; issues: Issue[] }
interface Report { ok: boolean; at: string; checks: Check[] }

const fmt = (unit: Check['unit'], v: number) => (unit === 'money' ? formatMoney(v) : unit === 'qty' ? formatQty(v) : String(v));

/** فحص سلامة البيانات: بيقارن الأرصدة المحفوظة بالمحسوبة من القيود وحركات المخزن (قراءة فقط) */
export function IntegrityPage() {
  const [run, setRun] = useState(0);
  const { data, error, loading, reload } = useRemote<Report>(run ? '/api/admin/integrity' : null);
  const start = () => (run ? reload() : setRun(1));
  const bad = data?.checks.filter((c) => c.issues.length) ?? [];
  return (
    <div className="page sx-page">
      <SectionHeader
        icon={<ShieldCheck />}
        color="green"
        title="فحص سلامة البيانات"
        sub="بيتأكد إن أرصدة العملاء والموردين والخزائن والمخزون مطابقة للقيود والحركات — من غير ما يعدّل أي حاجة"
        clock={false}
        tools={<button type="button" className="btn primary" onClick={start} disabled={loading}><ShieldCheck /> {loading ? 'جاري الفحص…' : data ? 'افحص تاني' : 'ابدأ الفحص'}</button>}
      />
      {error && <Banner kind="err">{error}</Banner>}
      {!data && !loading && !error && (
        <SectionCard icon={<ShieldCheck />} title="إزاي الفحص بيشتغل">
          <p className="muted" style={{ margin: 0, lineHeight: 1.8 }}>
            السيستم بيحفظ رصيد كل عميل وخزينة وصنف جاهز علشان الشاشات تفتح بسرعة. الفحص بيحسب الأرصدة دي من الأول من القيود وحركات المخزن ويقارنها،
            وبيتأكد إن كل قيد متوازن وإن المستندات الملغاة قيودها معكوسة. لو كله مطابق هيقولك «البيانات سليمة».
          </p>
        </SectionCard>
      )}
      {data && (
        <>
          {data.ok
            ? <Banner kind="ok">البيانات سليمة: كل الأرصدة مطابقة للقيود والحركات. (آخر فحص {new Date(data.at).toLocaleString('ar-EG-u-nu-latn')})</Banner>
            : <Banner kind="warn">لقينا {bad.length} {bad.length === 1 ? 'نقطة محتاجة' : 'نقاط محتاجة'} مراجعة. البيانات ما اتعدلتش؛ ابعت الصفحة دي للدعم الفني.</Banner>}
          <SectionCard icon={<ShieldCheck />} title="نتيجة الفحص">
            <div className="sx-follow-list">
              {data.checks.map((c) => (
                <div key={c.key} className="sx-follow-row" style={{ cursor: 'default' }}>
                  <span className="sx-follow-ic" style={{ color: c.issues.length ? 'var(--red)' : 'var(--green)' }}>{c.issues.length ? <TriangleAlert /> : <CheckCircle2 />}</span>
                  <span className="sx-follow-l">{c.label}</span>
                  <span className="muted small num">{c.issues.length ? `${c.issues.length} فرق` : `${c.checked} سليم`}</span>
                </div>
              ))}
            </div>
          </SectionCard>
          {bad.map((c) => (
            <SectionCard key={c.key} icon={<TriangleAlert />} color="red" title={c.label}>
              <div className="sx-table">
                <table className="table responsive">
                  <thead><tr><th>البند</th><th className="n">{c.key === 'balanced' ? 'المدين' : c.key === 'cancelled' ? 'قيود لسه شغالة' : 'الرصيد المحفوظ'}</th><th className="n">{c.key === 'balanced' ? 'الدائن' : c.key === 'cancelled' ? 'المفروض' : 'المحسوب من القيود'}</th><th className="n">الفرق</th></tr></thead>
                  <tbody>
                    {c.issues.map((i, k) => (
                      <tr key={(i.id ?? '') + k} style={{ cursor: 'default' }}>
                        <td data-label="البند" className="bold">{i.name}</td>
                        <td data-label="المحفوظ" className="n">{fmt(c.unit, i.stored)}</td>
                        <td data-label="المحسوب" className="n">{fmt(c.unit, i.computed)}</td>
                        <td data-label="الفرق" className="n bold red">{fmt(c.unit, i.stored - i.computed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ))}
        </>
      )}
    </div>
  );
}
