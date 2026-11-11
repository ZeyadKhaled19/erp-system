import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useUi } from './components/ui';
import { setToken, setUnauthorizedHandler } from './lib/api';
import { setMeta } from './lib/db';
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

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const ui = useUi();

  useEffect(() => {
    if (!session) return;
    setToken(session.token);
    void setMeta('device_short', getDeviceId().slice(0, 4).toUpperCase());
    startSync();
    return () => stopSync();
  }, [session]);

  const logout = useCallback(async () => {
    const ok = await ui.confirm({
      title: 'تسجيل الخروج؟',
      message: 'البيانات المحفوظة على الجهاز والعمليات التي لم تُرفع بعد ستبقى محفوظة وتُرفع عند الدخول مرة أخرى.',
      confirmLabel: 'خروج',
      destructive: true,
    });
    if (!ok) return;
    saveSession(null);
    setToken(null);
    setSession(null);
  }, [ui]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      // الجلسة انتهت على الخادم: نطلب الدخول مرة أخرى دون حذف البيانات المحلية
      saveSession(null);
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
          saveSession(s);
          setSession(s);
        }}
      />
    );

  return (
    <SessionContext.Provider value={ctx}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/items/inquiry" element={<ItemInquiry />} />
          <Route path="/warehouses" element={<WarehousesPage />} />
          <Route path="/parties/:kind" element={<PartiesPage />} />
          <Route path="/parties/:kind/:id" element={<PartyDetail />} />
          <Route path="/cashboxes" element={<CashboxesPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/docs/new/:type" element={<DocumentEditor />} />
          <Route path="/docs/edit/:id" element={<DocumentEditor />} />
          <Route path="/docs/view/:id" element={<DocumentView />} />
          <Route path="/docs/list/:module" element={<DocumentsList />} />
          <Route path="/reports/item" element={<ItemMovementReport />} />
          <Route path="/reports/stock" element={<StockReport />} />
          <Route path="/reports/warehouse-movement" element={<WarehouseMovementReport />} />
          <Route path="/reports/reorder" element={<ReorderReport />} />
          <Route path="/reports/trial-balance" element={<TrialBalanceReport />} />
          <Route path="/reports/ledger" element={<LedgerReport />} />
          <Route path="/reports/income" element={<IncomeReport />} />
          <Route path="/reports/balance-sheet" element={<BalanceSheetReport />} />
          <Route path="/reports/documents" element={<DocumentsReport />} />
          <Route path="/sync" element={<SyncCenter />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/backups" element={<BackupsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </SessionContext.Provider>
  );
}
