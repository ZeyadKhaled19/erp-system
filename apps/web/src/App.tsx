import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { PrintPage } from './pages/Print';
import { Layout } from './components/Layout';
import { useUi } from './components/ui';
import { api, setToken, setUnauthorizedHandler } from './lib/api';
import { db, setLocalIdentity, setMeta } from './lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { DOC_TYPES, type DocType } from '@erp/shared';
import { SessionContext } from './lib/hooks';
import { getDeviceId, loadSession, saveSession, type Session } from './lib/session';
import { startSync, stopSync } from './lib/sync';
import { AccountsPage } from './pages/Accounts';
import { AuditPage } from './pages/Audit';
import { BackupsPage } from './pages/Backups';
import { CashboxesPage } from './pages/Cashboxes';
import { Dashboard } from './pages/Dashboard';
import { DocumentEditor } from './pages/DocumentEditor';
import { DocumentsList } from './pages/DocumentsList';
import { DocumentView } from './pages/DocumentView';
import { ExpensesPage, ExpenseModal } from './pages/Expenses';
import { CashMovementsPage } from './pages/CashMovements';
import { CashTransfersPage } from './pages/CashTransfers';
import { StockCountsPage } from './pages/StockCounts';
import { StockTransfersPage } from './pages/StockTransfers';
import { ItemInquiry } from './pages/ItemInquiry';
import { ItemsPage } from './pages/Items';
import { Login } from './pages/Login';
import { PartiesPage, PartyDetail } from './pages/Parties';
import {
  BalanceSheetReport, DocumentsReport, IncomeReport, ItemMovementReport, LedgerReport, ReorderReport, StockReport, TrialBalanceReport, WarehouseMovementReport,
} from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { SyncCenter } from './pages/SyncCenter';
import { IntegrityPage } from './pages/Integrity';
import { DesktopAppPage } from './pages/DesktopApp';
import { UsersPage } from './pages/Users';
import { WarehousesPage } from './pages/Warehouses';
import { CreditInvoicesPage, InstrumentsPage } from './pages/Followup';
import { ListsPage } from './pages/Lists';
import { PartnersPage } from './pages/Partners';
import { ShiftPage } from './pages/Shift';
import { DeliveriesPage } from './pages/Deliveries';
import { HubPage } from './pages/Hub';
import { PosPage } from './pages/Pos';
import { InvoicesPage } from './pages/Invoices';
import { SimpleSalePage } from './pages/SimpleSale';
import { BusinessInsightsPage } from './pages/BusinessInsights';
import { AdvancesPage, AttendancePage, AttendanceReportPage, EmployeesPage, PayrollPage } from './pages/Employees';
import { OrgStructurePage } from './pages/OrgStructure';
import { DocGuard, HomeRoute, HubGuard, NewDocGuard, RequirePerm } from './components/Guard';
import { clearLanded } from './lib/home';
import { CommissionsPage, YearEndPage } from './pages/YearEnd';
import { DailyMovementReport, ExpiryReport, NegativeStockReport, SalesAnalysisReport, SerialSearchReport, TreasuryAnalysisReport } from './pages/Reports';
import { CustomerFieldsReport } from './pages/reports/customerFields';
import { SignupPage } from './pages/Signup';
import { LicensesPage } from './pages/Licenses';
import { OwnerDashboard } from './pages/Owner';
import { LockScreen, RegisterScreen, TrialPill } from './components/LicenseGate';
import { useLicenseInfo } from './lib/license';

export function App() {
  const [session, setSession] = useState<Session | null>(() => {
    // الرمز يُجهز قبل أول رسم حتى لا تُرسل الشاشات طلبات بدون رمز
    const s = loadSession();
    setLocalIdentity(s?.user.id ?? null);
    setToken(s?.token ?? null);
    return s;
  });
  const ui = useUi();
  const loc = useLocation();
  const backgroundLocation = (loc.state as { backgroundLocation?: typeof loc } | null)?.backgroundLocation;
  const lic = useLicenseInfo();

  useEffect(() => {
    if (!session) return;
    setLocalIdentity(session.user.id);
    setToken(session.token);
    void setMeta('device_short', getDeviceId().slice(0, 4).toUpperCase());
    startSync();
    return () => stopSync();
  }, [session]);

  // تحديث صلاحيات المستخدم من الخادم عند توفر الاتصال (قد تكون تغيرت منذ آخر دخول)
  // ويُعاد التحقق عند الرجوع للنافذة أو عودة الاتصال وكل 5 دقائق، فتُطبق تغييرات الصلاحيات دون إعادة دخول
  useEffect(() => {
    if (!session) return;
    let alive = true;
    const refresh = () =>
      api<{ user: Session['user'] }>('/api/auth/me')
        .then((r) => {
          if (!alive) return;
          setSession((cur) => {
            if (!cur || cur.token !== session.token || JSON.stringify(r.user) === JSON.stringify(cur.user)) return cur;
            const next = { ...cur, user: r.user };
            saveSession(next);
            return next;
          });
        })
        .catch(() => {
          /* دون اتصال: نستخدم الصلاحيات المحفوظة */
        });
    void refresh();
    const onFocus = () => document.visibilityState === 'visible' && void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const t = window.setInterval(refresh, 5 * 60 * 1000);
    return () => {
      alive = false;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  const logout = useCallback(async () => {
    const ok = await ui.confirm({
      title: 'تسجيل الخروج؟',
      message: 'البيانات والعمليات غير المرفوعة تظل مرتبطة بحسابك، وتُرفع عند دخولك بالحساب نفسه مع توفر الاتصال.',
      confirmLabel: 'خروج',
      destructive: true,
    });
    if (!ok) return;
    saveSession(null);
    setLocalIdentity(null);
    setToken(null);
    setSession(null);
    clearLanded();
  }, [ui]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      // الجلسة انتهت على الخادم: نطلب الدخول مرة أخرى دون حذف البيانات المحلية
      saveSession(null);
    setLocalIdentity(null);
      setToken(null);
      setSession(null);
      ui.toast('انتهت الجلسة، سجّل الدخول مرة أخرى', 'warn');
    });
  }, [ui]);

  useEffect(() => {
    const h = (e: Event) => {
      const update = (e as CustomEvent).detail as (reload?: boolean) => Promise<void>;
      void ui
        .confirm({ title: 'تحديث جديد متاح', message: 'يوجد إصدار أحدث من البرنامج. تحديث الآن؟ لن تُفقد أي بيانات.', confirmLabel: 'تحديث' })
        .then((ok) => { if (ok) void update(true); });
    };
    window.addEventListener('erp:update-ready', h);
    return () => window.removeEventListener('erp:update-ready', h);
  }, [ui]);

  const ctx = useMemo(() => (session ? { session, logout } : null), [session, logout]);

  // صفحة «جرّب مجانًا» (من غير دخول، على موقع صاحب السيستم بس)
  if (loc.pathname === '/signup') {
    if (!lic) return null; // لسه بنسأل الخادم: ما نفتحش حاجة تانية تغيّر الرابط
    if (lic.vendor) return <SignupPage />;
  }
  // برنامج الويندوز بعد ما التجربة أو الاشتراك يخلص: شاشة التفعيل بدل أي حاجة
  if (lic?.license?.status === 'expired') return <LockScreen license={lic.license} contact={lic.contact} />;
  // أول مرة: تسجيل التجربة برقم الموبايل
  if (lic?.license?.status === 'unregistered') return <RegisterScreen license={lic.license} contact={lic.contact} />;

  if (!session || !ctx)
    return (
      <Login
        onLogin={(s) => {
          clearLanded();
          saveSession(s);
          setToken(s.token);
          setSession(s);
        }}
      />
    );

  if (loc.pathname.startsWith('/print/'))
    return (
      <SessionContext.Provider value={ctx}>
        <Routes>
          <Route path="/print/:id" element={<PrintPage />} />
        </Routes>
      </SessionContext.Provider>
    );

  return (
    <SessionContext.Provider value={ctx}>
      {lic?.license?.status === 'trial' && <TrialPill license={lic.license} contact={lic.contact} />}
      <Layout>
        <Routes location={backgroundLocation ?? loc}>
          <Route path="/" element={<HomeRoute><Dashboard /></HomeRoute>} />
          <Route path="/insights" element={<RequirePerm any={['reports.view', 'sales.view', 'purchases.view', 'inventory.view', 'treasury.view', 'parties.view', 'employees.view']}><BusinessInsightsPage /></RequirePerm>} />
          <Route path="/hub/:key" element={<HubGuard><HubPage /></HubGuard>} />
          <Route path="/pos" element={<RequirePerm any={['sales.create']}><PosPage /></RequirePerm>} />
          <Route path="/invoices" element={<RequirePerm any={['sales.view', 'purchases.view']}><InvoicesPage backgroundActive={!!backgroundLocation} /></RequirePerm>} />
          <Route path="/purchases" element={<RequirePerm any={['purchases.view']}><InvoicesPage purchaseOnly backgroundActive={!!backgroundLocation} /></RequirePerm>} />
          <Route path="/returns/sales" element={<RequirePerm any={['sales.view']}><InvoicesPage key="sales-returns" returnsOnly="sales" backgroundActive={!!backgroundLocation} /></RequirePerm>} />
          <Route path="/returns/purchases" element={<RequirePerm any={['purchases.view']}><InvoicesPage key="purchase-returns" returnsOnly="purchases" backgroundActive={!!backgroundLocation} /></RequirePerm>} />
          <Route path="/treasury/receipt" element={<RequirePerm any={['treasury.view']}><CashMovementsPage key="receipt" kind="receipt" /></RequirePerm>} />
          <Route path="/treasury/payment" element={<RequirePerm any={['treasury.view']}><CashMovementsPage key="payment" kind="payment" /></RequirePerm>} />
          <Route path="/treasury/transfers" element={<RequirePerm any={['treasury.view']}><CashTransfersPage /></RequirePerm>} />
          <Route path="/inventory/counts" element={<RequirePerm any={['inventory.view']}><StockCountsPage /></RequirePerm>} />
          <Route path="/inventory/transfers" element={<RequirePerm any={['inventory.view']}><StockTransfersPage /></RequirePerm>} />
          <Route path="/reports/commissions" element={<RequirePerm any={['reports.view']}><CommissionsPage /></RequirePerm>} />
          <Route path="/year-end" element={<RequirePerm any={['period.lock']}><YearEndPage /></RequirePerm>} />
          <Route path="/items" element={<RequirePerm any={['items.view']}><ItemsPage /></RequirePerm>} />
          <Route path="/items/inquiry" element={<RequirePerm any={['items.view']}><ItemInquiry /></RequirePerm>} />
          <Route path="/warehouses" element={<RequirePerm any={['inventory.view']}><WarehousesPage /></RequirePerm>} />
          <Route path="/parties/:kind" element={<RequirePerm any={['parties.view']}><PartiesPage key={loc.pathname} /></RequirePerm>} />
          <Route path="/parties/:kind/:id" element={<RequirePerm any={['parties.view']}><PartyDetail key={loc.pathname} /></RequirePerm>} />
          <Route path="/cashboxes" element={<RequirePerm any={['treasury.view']}><CashboxesPage /></RequirePerm>} />
          <Route path="/expenses" element={<RequirePerm any={['treasury.view']}><ExpensesPage /></RequirePerm>} />
          <Route path="/accounts" element={<RequirePerm any={['accounts.view']}><AccountsPage /></RequirePerm>} />
          <Route path="/docs/new/:type" element={<NewDocGuard><NewDocRoute /></NewDocGuard>} />
          <Route path="/docs/edit/:id" element={<DocGuard><DocumentEditor /></DocGuard>} />
          <Route path="/docs/view/:id" element={<DocGuard><DocumentView /></DocGuard>} />
          <Route path="/docs/list/:module" element={<ModuleListGuard><DocumentsList /></ModuleListGuard>} />
          <Route path="/reports/item" element={<RequirePerm any={['inventory.view']}><ItemMovementReport /></RequirePerm>} />
          <Route path="/reports/stock" element={<RequirePerm any={['inventory.view']}><StockReport /></RequirePerm>} />
          <Route path="/reports/warehouse-movement" element={<RequirePerm any={['inventory.view']}><WarehouseMovementReport /></RequirePerm>} />
          <Route path="/reports/reorder" element={<RequirePerm any={['inventory.view']}><ReorderReport /></RequirePerm>} />
          <Route path="/reports/trial-balance" element={<RequirePerm any={['reports.financial']}><TrialBalanceReport /></RequirePerm>} />
          <Route path="/reports/ledger" element={<RequirePerm any={['reports.financial']}><LedgerReport /></RequirePerm>} />
          <Route path="/reports/income" element={<RequirePerm any={['reports.profit']}><IncomeReport /></RequirePerm>} />
          <Route path="/reports/balance-sheet" element={<RequirePerm any={['reports.financial']}><BalanceSheetReport /></RequirePerm>} />
          <Route path="/reports/documents" element={<RequirePerm any={['reports.view']}><DocumentsReport /></RequirePerm>} />
          <Route path="/sync" element={<SyncCenter />} />
          <Route path="/desktop" element={<DesktopAppPage />} />
          <Route path="/integrity" element={<RequirePerm any={['reports.financial']}><IntegrityPage /></RequirePerm>} />
          <Route path="/instruments" element={<RequirePerm any={['treasury.view', 'treasury.instruments']}><InstrumentsPage /></RequirePerm>} />
          <Route path="/receivables" element={<RequirePerm any={['sales.view', 'purchases.view']}><CreditInvoicesPage /></RequirePerm>} />
          <Route path="/partners" element={<RequirePerm any={['partners.view']}><PartnersPage /></RequirePerm>} />
          <Route path="/shift" element={<RequirePerm any={['treasury.shift']}><ShiftPage /></RequirePerm>} />
          <Route path="/deliveries" element={<RequirePerm any={['sales.view', 'sales.deliver']}><DeliveriesPage /></RequirePerm>} />
          <Route path="/lists" element={<ListsPage />} />
          <Route path="/reports/analysis" element={<RequirePerm any={['reports.view']}><SalesAnalysisReport /></RequirePerm>} />
          <Route path="/reports/customer-fields" element={<RequirePerm any={['reports.view']}><CustomerFieldsReport /></RequirePerm>} />
          <Route path="/reports/scooter-brands" element={<Navigate to="/reports/customer-fields?field=pf-scooter-brand" replace />} />
          <Route path="/reports/negative" element={<RequirePerm any={['inventory.view']}><NegativeStockReport /></RequirePerm>} />
          <Route path="/reports/daily" element={<RequirePerm any={['reports.view']}><DailyMovementReport /></RequirePerm>} />
          <Route path="/reports/treasury" element={<RequirePerm any={['treasury.view']}><TreasuryAnalysisReport /></RequirePerm>} />
          <Route path="/reports/serial" element={<RequirePerm any={['inventory.view']}><SerialSearchReport /></RequirePerm>} />
          <Route path="/reports/expiry" element={<RequirePerm any={['inventory.view']}><ExpiryReport /></RequirePerm>} />
          <Route path="/employees" element={<RequirePerm any={['employees.view']}><EmployeesPage /></RequirePerm>} />
          <Route path="/employees/org" element={<RequirePerm any={['employees.view']}><OrgStructurePage /></RequirePerm>} />
          <Route path="/employees/attendance" element={<RequirePerm any={['employees.view', 'employees.attendance']}><AttendancePage /></RequirePerm>} />
          <Route path="/employees/attendance-report" element={<RequirePerm any={['employees.view']}><AttendanceReportPage /></RequirePerm>} />
          <Route path="/employees/advances" element={<RequirePerm any={['employees.view']}><AdvancesPage /></RequirePerm>} />
          <Route path="/employees/payroll" element={<RequirePerm any={['employees.view']}><PayrollPage /></RequirePerm>} />
          <Route path="/users" element={<RequirePerm any={['users.manage']}><UsersPage /></RequirePerm>} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/licenses" element={<RequirePerm any={['settings.manage']}><LicensesPage /></RequirePerm>} />
          <Route path="/owner" element={<RequirePerm any={['settings.manage']}><OwnerDashboard /></RequirePerm>} />
          <Route path="/backups" element={<RequirePerm any={['backup.manage']}><BackupsPage /></RequirePerm>} />
          <Route path="/audit" element={<RequirePerm any={['audit.view']}><AuditPage /></RequirePerm>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {backgroundLocation && (
          <Routes>
            <Route path="/docs/new/:type" element={<NewDocGuard><NewDocumentModal key={loc.key} /></NewDocGuard>} />
            <Route path="/docs/edit/:id" element={<DocGuard><EditDocumentModal key={loc.key} /></DocGuard>} />
          </Routes>
        )}
      </Layout>
    </SessionContext.Provider>
  );
}

/** فاتورة البيع الجديدة تفتح الشاشة البسيطة، و?advanced=1 يفتح المحرر الكامل */
function NewDocRoute() {
  const { type } = useParams();
  const [sp] = useSearchParams();
  const loc = useLocation();
  if (type === 'stock_transfer' && !(loc.state as { backgroundLocation?: unknown } | null)?.backgroundLocation)
    return <Navigate to={`${loc.pathname}${loc.search}`} replace state={{ backgroundLocation: { pathname: '/inventory/transfers' } }} />;
  if (type === 'stock_adjustment' && !(loc.state as { backgroundLocation?: unknown } | null)?.backgroundLocation)
    return <Navigate to={`${loc.pathname}${loc.search}`} replace state={{ backgroundLocation: { pathname: '/inventory/counts' } }} />;
  if (type === 'purchase_invoice' && !(loc.state as { backgroundLocation?: unknown } | null)?.backgroundLocation)
    return <Navigate to={`${loc.pathname}${loc.search}`} replace state={{ backgroundLocation: { pathname: '/purchases' } }} />;
  if ((type === 'sale_return' || type === 'purchase_return') && !(loc.state as { backgroundLocation?: unknown } | null)?.backgroundLocation)
    return <Navigate to={`${loc.pathname}${loc.search}`} replace state={{ backgroundLocation: { pathname: type === 'sale_return' ? '/returns/sales' : '/returns/purchases' } }} />;
  if (type === 'expense' || type === 'partner_withdrawal' || type === 'receipt' || type === 'payment' || type === 'cash_transfer') {
    const backgroundLocation = (loc.state as { backgroundLocation?: unknown } | null)?.backgroundLocation;
    if (!backgroundLocation) return <Navigate to={`${loc.pathname}${loc.search}`} replace state={{ backgroundLocation: { pathname: type === 'cash_transfer' ? '/treasury/transfers' : type === 'receipt' || type === 'payment' ? `/treasury/${type}` : type === 'expense' ? '/expenses' : '/hub/partners' } }} />;
    return null;
  }
  if (type === 'sale_invoice' && !sp.get('advanced') && !sp.get('quotation') && !sp.get('ref')) return <SimpleSalePage key="sale" />;
  if (type === 'purchase_invoice' && !sp.get('advanced') && !sp.get('ref')) return <SimpleSalePage key="purchase" kind="purchase" />;
  return <DocumentEditor key={type} />;
}

function NewDocumentModal() {
  const { type } = useParams();
  if (type === 'stock_transfer') return <ExpenseModal title="تحويل البضاعة بين المخازن" variant="return"><DocumentEditor /></ExpenseModal>;
  if (type === 'stock_adjustment') return <ExpenseModal title="جرد وتسوية المخزون" variant="return"><DocumentEditor /></ExpenseModal>;
  if (type === 'purchase_invoice') return <ExpenseModal title="فاتورة شراء جديدة" variant="purchase"><NewDocRoute /></ExpenseModal>;
  if (type === 'receipt' || type === 'payment') return <ExpenseModal title={type === 'receipt' ? 'قبض من عميل' : 'صرف لمورد'} variant="cash"><DocumentEditor /></ExpenseModal>;
  if (type === 'sale_return' || type === 'purchase_return') return <ExpenseModal title={type === 'sale_return' ? 'مرتجع بيع' : 'مرتجع شراء'} variant="return"><DocumentEditor /></ExpenseModal>;
  if (type === 'cash_transfer') return <ExpenseModal title="تحويل بين الخزائن" variant="cash"><DocumentEditor /></ExpenseModal>;
  return <ExpenseModal><DocumentEditor /></ExpenseModal>;
}

function EditDocumentModal() {
  const { id } = useParams();
  const doc = useLiveQuery(() => id ? db.documents.get(id) : undefined, [id]);
  if (doc === undefined) return null;
  return <ExpenseModal title={doc.doc_type === 'stock_adjustment' ? 'تعديل الجرد' : `تعديل ${DOC_TYPES[doc.doc_type as DocType]?.label ?? 'المستند'}`} variant={['stock_adjustment', 'stock_transfer'].includes(doc.doc_type) ? 'return' : undefined}><DocumentEditor /></ExpenseModal>;
}

/** سجل مستندات وحدة: يحتاج صلاحية مشاهدة الوحدة */
function ModuleListGuard({ children }: { children: ReactNode }) {
  const { module = '' } = useParams();
  return <RequirePerm any={[`${module}.view`]}>{children}</RequirePerm>;
}
