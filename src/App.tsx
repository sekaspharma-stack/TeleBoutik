import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { initSyncWatcher } from './context/SyncContext';
import { getDb, query } from './db/localDb';
import { flushPendingCloudTableWrites, pullCloudData, restorePendingCloudSync, syncPendingOps } from './db/syncEngine';
import FirstRunSetup from './pages/FirstRunSetup';
import LoginPage from './pages/LoginPage';
import POSPage from './pages/POSPage';
import DashboardPage from './pages/DashboardPage';
import StockPage from './pages/StockPage';
import SalesPage from './pages/SalesPage';
import CashPage from './pages/CashPage';
import AirtelMoneyPage from './pages/AirtelMoneyPage';
import TelecomSalesPage from './pages/TelecomSalesPage';
import SimCardsPage from './pages/SimCardsPage';
import CabinsPage from './pages/CabinsPage';
import FinanceReportsPage from './pages/FinanceReportsPage';
import AuditPage from './pages/AuditPage';
import SettingsPage from './pages/SettingsPage';
import CustomersPage from './pages/CustomersPage';
import AppLayout from './components/AppLayout';
import SyncStatusBar from './components/SyncStatusBar';

export default function App() {
  const { user, isInitialized, init } = useAuth();
  const [dbReady, setDbReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stopSync: (() => void) | undefined;

    (async () => {
      try {
        const database = await getDb();

        // Remove only the exact, known demo shop from older versions. Real shop data is untouched.
        const demo = await database.query<{ id: string }>("SELECT id FROM stores WHERE name = 'TeleShop Abidjan' LIMIT 1");
        if (demo.rows.length > 0) {
          await database.exec(`TRUNCATE TABLE telecom_transactions, airtel_transactions, sim_cards, cabins, commission_rules, trade_ins, inventory_sessions, purchase_lines, purchases, credit_installments, credit_plans, settings, audit_log, journal_entries, expenses, cash_movements, cash_sessions, sale_payments, sale_lines, sales, customers, suppliers, stock_movements, imei_units, product_variants, products, users, stores, sync_ops, app_meta CASCADE;`);
        }

        // Restore the persisted offline queue FIRST so local edits are protected.
        // When online, push legitimate pending offline operations, then read authoritative
        // Firestore server state before exposing the app. When offline/unavailable, keep the
        // existing local database as a fallback and retry when connectivity returns.
        await restorePendingCloudSync();
        if (navigator.onLine) {
          try {
            await flushPendingCloudTableWrites();
            await syncPendingOps();
            const cloudResult = await pullCloudData();
            if (!cloudResult.available || cloudResult.failedCollections.length > 0 || cloudResult.skippedReason) {
              console.warn('Cloud-first startup completed with limitations; local fallback may be in use:', cloudResult);
            }
          } catch (cloudError) {
            console.warn('Cloud restore unavailable; continuing with local fallback:', cloudError);
          }
        }

        const stores = await query<{ count: number | string }>('SELECT COUNT(*) AS count FROM stores');
        const users = await query<{ count: number | string }>('SELECT COUNT(*) AS count FROM users');
        if (cancelled) return;

        stopSync = initSyncWatcher();
        if (Number(stores[0]?.count ?? 0) === 0 || Number(users[0]?.count ?? 0) === 0) {
          setNeedsSetup(true);
          setDbReady(true);
          return;
        }

        await init();
        if (cancelled) return;
        setDbReady(true);
      } catch (err) {
        console.error('Init error:', err);
        if (!cancelled) {
          setInitError(err instanceof Error ? err.message : String(err));
          setDbReady(true);
        }
      }
    })();

    const interval = window.setInterval(() => useAuth.getState().checkSessionExpiry(), 60000);
    // Prolonge la session lorsqu'un utilisateur travaille réellement dans l'application.
    const refreshActivity = () => useAuth.getState().touchSession();
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, refreshActivity, { passive: true }));
    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, refreshActivity));
      cancelled = true;
      stopSync?.();
      window.clearInterval(interval);
    };
  }, [init]);

  if (!dbReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm">Chargement de TeleBoutik...</p>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4">
        <div className="text-center max-w-sm">
          <p className="text-error-600 font-semibold mb-2">Erreur d'initialisation</p>
          <p className="text-slate-500 text-sm mb-4">{initError}</p>
          <button
            onClick={() => { setInitError(null); setDbReady(false); window.location.reload(); }}
            className="btn-primary"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  if (needsSetup) {
    return <FirstRunSetup onComplete={async () => { await init(); setNeedsSetup(false); }} />;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <BrowserRouter>
      <SyncStatusBar />
      <AppLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/pos" element={<POSPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/cash" element={<CashPage />} />
          <Route path="/airtel-money" element={<AirtelMoneyPage />} />
          <Route path="/telecom-sales" element={<TelecomSalesPage />} />
          <Route path="/sim-cards" element={<SimCardsPage />} />
          <Route path="/cabins" element={<CabinsPage />} />
          <Route path="/reports-commissions" element={<FinanceReportsPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  );
}
