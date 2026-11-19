import { Boxes, FileText, IdCard, ShoppingBag, ShoppingCart, Sparkles, Users, Wallet } from 'lucide-react';
import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { HomeKpis } from '../components/HomeKpis';
import { db } from '../lib/db';
import { setDocTitle } from '../lib/brand';
import { usePerm, useSession } from '../lib/hooks';

type InsightQuestion = { text: string; to: string; perm: string };
type InsightGroup = { title: string; description: string; icon: ReactNode; tone: string; questions: InsightQuestion[] };

const GROUPS: InsightGroup[] = [
  {
    title: 'صورة المحل', description: 'تابع الأرقام الكبيرة واعرف اتجاه النشاط.', icon: <Sparkles />, tone: 'violet', questions: [
      { text: 'هل المبيعات بتزيد ولا بتقل؟', to: '/reports/analysis', perm: 'reports.view' },
      { text: 'هل الربح متناسب مع حجم البيع؟', to: '/reports/income', perm: 'reports.profit' },
      { text: 'إيه حركة القبض والصرف؟', to: '/reports/treasury', perm: 'treasury.view' },
      { text: 'إيه آخر الفواتير والعمليات؟', to: '/invoices', perm: 'sales.view' },
    ],
  },
  {
    title: 'المبيعات', description: 'اعرف الأصناف والفترات التي تحرك البيع.', icon: <ShoppingCart />, tone: 'green', questions: [
      { text: 'إيه الأصناف الأكثر مبيعًا؟', to: '/reports/analysis', perm: 'reports.view' },
      { text: 'إيه حركة المبيعات يوم بيوم؟', to: '/reports/daily', perm: 'reports.view' },
      { text: 'هل في فواتير آجلة محتاجة متابعة؟', to: '/receivables', perm: 'sales.view' },
      { text: 'إيه تفاصيل فواتير البيع؟', to: '/docs/list/sales', perm: 'sales.view' },
    ],
  },
  {
    title: 'الأصناف والمخزون', description: 'راقب الرصيد والطلب وحركة البضاعة.', icon: <Boxes />, tone: 'orange', questions: [
      { text: 'إيه الأصناف اللي وصلت لحد الطلب؟', to: '/reports/reorder', perm: 'inventory.view' },
      { text: 'إيه أرصدة وقيمة المخزون؟', to: '/reports/stock', perm: 'inventory.view' },
      { text: 'إيه حركة الأصناف بين المخازن؟', to: '/reports/warehouse-movement', perm: 'inventory.view' },
      { text: 'هل في رصيد مخزون بالسالب؟', to: '/reports/negative', perm: 'inventory.view' },
      { text: 'إيه الأصناف القريبة من انتهاء الصلاحية؟', to: '/reports/expiry', perm: 'inventory.view' },
    ],
  },
  {
    title: 'المشتريات والموردون', description: 'راجع الفواتير والمبالغ المستحقة للموردين.', icon: <ShoppingBag />, tone: 'purple', questions: [
      { text: 'إيه آخر فواتير المشتريات؟', to: '/docs/list/purchases', perm: 'purchases.view' },
      { text: 'إيه المبالغ المستحقة للموردين؟', to: '/parties/supplier', perm: 'parties.view' },
      { text: 'إيه تفاصيل حركة الموردين؟', to: '/parties/supplier', perm: 'parties.view' },
    ],
  },
  {
    title: 'العملاء والتحصيل', description: 'اعرف أرصدة العملاء وما يحتاج متابعة.', icon: <Users />, tone: 'blue', questions: [
      { text: 'مين العملاء اللي عليهم مستحقات؟', to: '/parties/customer', perm: 'parties.view' },
      { text: 'إيه الفواتير المتأخرة في السداد؟', to: '/receivables', perm: 'sales.view' },
      { text: 'إيه تفاصيل تعاملات العملاء؟', to: '/parties/customer', perm: 'parties.view' },
    ],
  },
  {
    title: 'الخزينة والمصروفات', description: 'راجع المقبوضات والمدفوعات والمصروفات.', icon: <Wallet />, tone: 'teal', questions: [
      { text: 'إيه أرصدة الخزائن والحسابات؟', to: '/cashboxes', perm: 'treasury.view' },
      { text: 'إيه ملخص حركة الخزينة؟', to: '/reports/treasury', perm: 'treasury.view' },
      { text: 'إيه سندات الصرف والمصروفات؟', to: '/docs/list/treasury', perm: 'treasury.view' },
      { text: 'هل المصروفات مأثرة على الربح؟', to: '/reports/income', perm: 'reports.profit' },
    ],
  },
  {
    title: 'الموظفون', description: 'تابع الحضور وسجلات الفريق.', icon: <IdCard />, tone: 'indigo', questions: [
      { text: 'إيه سجل الحضور والانصراف؟', to: '/employees/attendance-report', perm: 'employees.view' },
      { text: 'مين فريق العمل المسجل؟', to: '/employees', perm: 'employees.view' },
      { text: 'إيه تفاصيل الأجور والسلف؟', to: '/employees/payroll', perm: 'employees.view' },
    ],
  },
];

export function BusinessInsightsPage() {
  const can = usePerm();
  const nav = useNavigate();
  const { session } = useSession();
  const [warehouseId, setWarehouseId] = useState('');
  const canInventory = can('inventory.view');
  const warehouseScopeKey = (session.user.warehouse_ids ?? []).join(',');
  const warehouses = useLiveQuery(async () => {
    if (!canInventory) return [];
    const allowed = session.user.warehouse_ids == null ? null : new Set(session.user.warehouse_ids);
    return (await db.warehouses.toArray())
      .filter((warehouse) => warehouse.active !== false && (!allowed || allowed.has(warehouse.id)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
  }, [canInventory, warehouseScopeKey]);

  useEffect(() => {
    const slot = document.getElementById('nav-title-slot');
    if (slot) slot.textContent = 'نبض المحل';
    setDocTitle('نبض المحل');
  }, []);

  const visibleGroups = GROUPS.map((group) => ({ ...group, questions: group.questions.filter((question) => can(question.perm)) }))
    .filter((group) => group.questions.length > 0);

  return (
    <div className="page bi-page">
      <div className="bi-hero">
        <span className="bi-hero-icon"><Sparkles /></span>
        <div>
          <h1>نبض المحل</h1>
          <p>افهم اللي بيحصل في نشاطك من أرقامك الفعلية، وافتح التقرير المناسب لأي سؤال.</p>
        </div>
      </div>

      <div className="bi-filterbar">
        <div><b>ملخص نشاطك</b><span>اختار الفترة من الأزرار، والمخزن من هنا.</span></div>
        {canInventory && <label>المخزن
          <select className="select" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            <option value="">كل المخازن المسموحة</option>
            {(warehouses ?? []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
        </label>}
      </div>
      <HomeKpis warehouseId={canInventory ? (warehouseId || undefined) : undefined} />

      <div className="bi-section-head">
        <div><h2>تدور على إجابة لإيه؟</h2><p>اختار السؤال عشان تفتح البيانات والتقرير المرتبط بيه.</p></div>
        <span className="bi-live"><i /> بيانات الجهاز</span>
      </div>
      <div className="bi-grid">
        {visibleGroups.map((group) => (
          <section className={`bi-card ${group.tone}`} key={group.title}>
            <div className="bi-card-head">
              <span className="bi-card-icon">{group.icon}</span>
              <div><h3>{group.title}</h3><p>{group.description}</p></div>
            </div>
            <div className="bi-questions">
              {group.questions.map((question) => (
                <button type="button" className="bi-question" key={`${question.to}-${question.text}`} onClick={() => nav(question.to)}>
                  <span>{question.text}</span><span className="bi-arrow" aria-hidden="true">‹</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="bi-note"><FileText /> النتائج بتعتمد على بيانات جهازك وصلاحيات حسابك. المسودات والمستندات الملغاة لا تدخل في ملخص الأداء.</div>
    </div>
  );
}
