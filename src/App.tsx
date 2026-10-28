import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { initSyncWatcher, useSync } from './context/SyncContext';
import { getDb, query } from './db/localDb';
import { pullCloudData, restorePendingCloudSync } from './db/syncEngine';
import { scheduleLegacyStorageCleanup } from './db/legacyCleanup';
import { withTimeout } from './lib/async';
import FirstRunSetup from './pages/FirstRunSetup';
import LoginPage from './pages/LoginPage';
import AppLayout from './components/AppLayout';
import SyncStatusBar from './components/SyncStatusBar';

// Chargement à la demande : le démarrage ne télécharge plus tous les écrans (ni Recharts) d'un coup.
const POSPage = lazy(() => import('./pages/POSPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const StockPage = lazy(() => import('./pages/StockPage'));
const SalesPage = lazy(() => import('./pages/SalesPage'));
const CashPage = lazy(() => import('./pages/CashPage'));
const AirtelMoneyPage = lazy(() => import('./pages/AirtelMoneyPage'));
const TelecomSalesPage = lazy(() => import('./pages/TelecomSalesPage'));
const SimCardsPage = lazy(() => import('./pages/SimCardsPage'));
const CabinsPage = lazy(() => import('./pages/CabinsPage'));
const FinanceReportsPage = lazy(() => import('./pages/FinanceReportsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));

function PageFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Chargement de l'écran">
      <div className="skeleton h-8 w-56" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}
      </div>
      <div className="skeleton h-64" />
    </div>
  );
}

/**
 * Les écrans se rechargent quand des données cloud arrivent en arrière-plan, sauf sur le
 * Point de vente : on n'interrompt jamais une vente en cours de saisie.
 */
function AppRoutes() {
  const { pathname } = useLocation();
  const dataVersion = useSync((state) => state.dataVersion);
  const refreshKey = pathname === '/pos' ? 'pos' : `v${dataVersion}`;
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes key={refreshKey}>
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
    </Suspense>
  );
}

export default function App() {
  const { user, isInitialized, init } = useAuth();
  const [dbReady, setDbReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stopSync: (() => void) | undefined;
    scheduleLegacyStorageCleanup();

    (async () => {
      try {
        const database = await getDb();

        // Remove only the exact, known demo shop from older versions. Real shop data is untouched.
        const demo = await database.query<{ id: string }>("SELECT id FROM stores WHERE name = 'TeleShop Abidjan' LIMIT 1");
        if (demo.rows.length > 0) {
          await database.exec(`TRUNCATE TABLE sim_batch_sales, sim_stock_batches, telecom_stock, telecom_transactions, airtel_transactions, sim_cards, cabins, commission_rules, trade_ins, inventory_sessions, purchase_lines, purchases, credit_installments, credit_plans, settings, audit_log, journal_entries, expenses, cash_movements, cash_sessions, sale_payments, sale_lines, sales, customers, suppliers, stock_movements, imei_units, product_variants, products, users, stores, sync_ops, app_meta CASCADE;`);
        }

        // Démarrage local d'abord : l'écran s'affiche dès que la base locale répond.
        // La file hors-ligne est restaurée (protège les modifications locales), puis la
        // synchronisation cloud (envoi, puis réception) tourne en ARRIÈRE-PLAN via initSyncWatcher().
        await restorePendingCloudSync();

        let stores = await query<{ count: number | string }>('SELECT COUNT(*) AS count FROM stores');
        let users = await query<{ count: number | string }>('SELECT COUNT(*) AS count FROM users');

        // Seul cas où le cloud est attendu : appareil neuf (aucune boutique/compte local) mais en ligne.
        // Sans cela, l'assistant de première installation s'afficherait à tort. Délai borné.
        if ((Number(stores[0]?.count ?? 0) === 0 || Number(users[0]?.count ?? 0) === 0) && navigator.onLine) {
          try {
            await withTimeout(pullCloudData(), 20000, 'restauration cloud');
          } catch (cloudError) {
            console.warn('Restauration cloud indisponible au premier démarrage :', cloudError);
          }
          stores = await query<{ count: number | string }>('SELECT COUNT(*) AS count FROM stores');
          users = await query<{ count: number | string }>('SELECT COUNT(*) AS count FROM users');
        }
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
      <div className="boot-screen" role="status" aria-live="polite">
        <div className="boot-mark"><span /></div>
        <p className="boot-title">TeleBoutik</p>
        <p className="boot-sub">Ouverture de votre boutique…</p>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="card max-w-sm p-6 text-center">
          <p className="mb-2 text-base font-bold text-error-600">Impossible d'ouvrir la base locale</p>
          <p className="mb-4 text-sm text-slate-500">{initError}</p>
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
        <AppRoutes />
      </AppLayout>
    </BrowserRouter>
  );
}
