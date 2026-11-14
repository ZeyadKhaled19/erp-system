import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { PrintPage } from './pages/Print';
import { Layout } from './components/Layout';
import { useUi } from './components/ui';
import { api, setToken, setUnauthorizedHandler } from './lib/api';
import { setLocalIdentity, setMeta } from './lib/db';
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
import { ItemInquiry } from './pages/ItemInquiry';
import { ItemsPage } from './pages/Items';
import { Login } from './pages/Login';
import { PartiesPage, PartyDetail } from './pages/Parties';
import {
  BalanceSheetReport, DocumentsReport, IncomeReport, ItemMovementReport, LedgerReport, ReorderReport, StockReport, TrialBalanceReport, WarehouseMovementReport,
} from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { SyncCenter } from './pages/SyncCenter';
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
import { AdvancesPage, AttendancePage, AttendanceReportPage, EmployeesPage, PayrollPage } from './pages/Employees';
import { DocGuard, HomeRoute, HubGuard, NewDocGuard, RequirePerm } from './components/Guard';
import { clearLanded } from './lib/home';
import { CommissionsPage, YearEndPage } from './pages/YearEnd';
import { DailyMovementReport, ExpiryReport, NegativeStockReport, SalesAnalysisReport, SerialSearchReport, TreasuryAnalysisReport } from './pages/Reports';

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
      <Layout>
        <Routes>
          <Route path="/" element={<HomeRoute><Dashboard /></HomeRoute>} />
          <Route path="/hub/:key" element={<HubGuard><HubPage /></HubGuard>} />
          <Route path="/pos" element={<RequirePerm any={['sales.create']}><PosPage /></RequirePerm>} />
          <Route path="/invoices" element={<RequirePerm any={['sales.view', 'purchases.view']}><InvoicesPage /></RequirePerm>} />
          <Route path="/reports/commissions" element={<RequirePerm any={['reports.view']}><CommissionsPage /></RequirePerm>} />
          <Route path="/year-end" element={<RequirePerm any={['period.lock']}><YearEndPage /></RequirePerm>} />
          <Route path="/items" element={<RequirePerm any={['items.view']}><ItemsPage /></RequirePerm>} />
          <Route path="/items/inquiry" element={<RequirePerm any={['items.view']}><ItemInquiry /></RequirePerm>} />
          <Route path="/warehouses" element={<RequirePerm any={['inventory.view']}><WarehousesPage /></RequirePerm>} />
          <Route path="/parties/:kind" element={<RequirePerm any={['parties.view']}><PartiesPage /></RequirePerm>} />
          <Route path="/parties/:kind/:id" element={<RequirePerm any={['parties.view']}><PartyDetail /></RequirePerm>} />
          <Route path="/cashboxes" element={<RequirePerm any={['treasury.view']}><CashboxesPage /></RequirePerm>} />
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
          <Route path="/instruments" element={<RequirePerm any={['treasury.view', 'treasury.instruments']}><InstrumentsPage /></RequirePerm>} />
          <Route path="/receivables" element={<RequirePerm any={['sales.view', 'purchases.view']}><CreditInvoicesPage /></RequirePerm>} />
          <Route path="/partners" element={<RequirePerm any={['partners.view']}><PartnersPage /></RequirePerm>} />
          <Route path="/shift" element={<RequirePerm any={['treasury.shift']}><ShiftPage /></RequirePerm>} />
          <Route path="/deliveries" element={<RequirePerm any={['sales.view', 'sales.deliver']}><DeliveriesPage /></RequirePerm>} />
          <Route path="/lists" element={<ListsPage />} />
          <Route path="/reports/analysis" element={<RequirePerm any={['reports.view']}><SalesAnalysisReport /></RequirePerm>} />
          <Route path="/reports/negative" element={<RequirePerm any={['inventory.view']}><NegativeStockReport /></RequirePerm>} />
          <Route path="/reports/daily" element={<RequirePerm any={['reports.view']}><DailyMovementReport /></RequirePerm>} />
          <Route path="/reports/treasury" element={<RequirePerm any={['treasury.view']}><TreasuryAnalysisReport /></RequirePerm>} />
          <Route path="/reports/serial" element={<RequirePerm any={['inventory.view']}><SerialSearchReport /></RequirePerm>} />
          <Route path="/reports/expiry" element={<RequirePerm any={['inventory.view']}><ExpiryReport /></RequirePerm>} />
          <Route path="/employees" element={<RequirePerm any={['employees.view']}><EmployeesPage /></RequirePerm>} />
          <Route path="/employees/attendance" element={<RequirePerm any={['employees.view', 'employees.attendance']}><AttendancePage /></RequirePerm>} />
          <Route path="/employees/attendance-report" element={<RequirePerm any={['employees.view']}><AttendanceReportPage /></RequirePerm>} />
          <Route path="/employees/advances" element={<RequirePerm any={['employees.view']}><AdvancesPage /></RequirePerm>} />
          <Route path="/employees/payroll" element={<RequirePerm any={['employees.view']}><PayrollPage /></RequirePerm>} />
          <Route path="/users" element={<RequirePerm any={['users.manage']}><UsersPage /></RequirePerm>} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/backups" element={<RequirePerm any={['backup.manage']}><BackupsPage /></RequirePerm>} />
          <Route path="/audit" element={<RequirePerm any={['audit.view']}><AuditPage /></RequirePerm>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </SessionContext.Provider>
  );
}

/** فاتورة البيع الجديدة تفتح الشاشة البسيطة، و?advanced=1 يفتح المحرر الكامل */
function NewDocRoute() {
  const { type } = useParams();
  const [sp] = useSearchParams();
  if (type === 'sale_invoice' && !sp.get('advanced') && !sp.get('quotation') && !sp.get('ref')) return <SimpleSalePage key="sale" />;
  if (type === 'purchase_invoice' && !sp.get('advanced') && !sp.get('ref')) return <SimpleSalePage key="purchase" kind="purchase" />;
  return <DocumentEditor key={type} />;
}

/** سجل مستندات وحدة: يحتاج صلاحية مشاهدة الوحدة */
function ModuleListGuard({ children }: { children: ReactNode }) {
  const { module = '' } = useParams();
  return <RequirePerm any={[`${module}.view`]}>{children}</RequirePerm>;
}
