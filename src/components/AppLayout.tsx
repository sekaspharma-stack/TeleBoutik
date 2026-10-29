import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ShoppingCart,
  LayoutDashboard,
  Package,
  Receipt,
  Wallet,
  Smartphone,
  RadioTower,
  CreditCard,
  BarChart3,
  Building2,
  Users,
  ScrollText,
  Settings,
  ShieldCheck,
  LogOut,
  Store,
  RefreshCw,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { queryOne } from '../db/localDb';
import { useSync } from '../context/SyncContext';
import { roleLabel, canSeeExpenses, canManageUsers, canSeeMargin } from '../lib/utils';
import HelpInfo from './HelpInfo';
import ThemeToggle from './ThemeToggle';

const ALL_NAV_ITEMS = [
  { to: '/dashboard', label: 'Tableau de Bord', icon: LayoutDashboard, roles: ['owner', 'manager', 'seller', 'accountant'] },
  { to: '/pos', label: 'Point de Vente', icon: ShoppingCart, roles: ['owner', 'manager', 'seller'] },
  { to: '/stock', label: 'Stock', icon: Package, roles: ['owner', 'manager', 'seller'] },
  { to: '/sales', label: 'Ventes', icon: Receipt, roles: ['owner', 'manager', 'seller', 'accountant'] },
  { to: '/cash', label: 'Caisse', icon: Wallet, roles: ['owner', 'manager', 'seller'] },
  { to: '/airtel-money', label: 'Shop Airtel Money', icon: Smartphone, roles: ['owner', 'manager', 'seller'] },
  { to: '/telecom-sales', label: 'Unités & Megas', icon: RadioTower, roles: ['owner', 'manager', 'seller'] },
  { to: '/sim-cards', label: 'Cartes SIM', icon: CreditCard, roles: ['owner', 'manager', 'seller'] },
  { to: '/cabins', label: 'Cabines & agents', icon: Building2, roles: ['owner', 'manager'] },
  { to: '/reports-commissions', label: 'Rapports & commissions', icon: BarChart3, roles: ['owner', 'manager', 'accountant'] },
  { to: '/customers', label: 'Clients', icon: Users, roles: ['owner', 'manager', 'seller'] },
  { to: '/operations', label: 'Gestion avancée', icon: ShieldCheck, roles: ['owner', 'manager', 'seller', 'accountant'] },
  { to: '/audit', label: 'Audit', icon: ScrollText, roles: ['owner'] },
  { to: '/settings', label: 'Paramètres', icon: Settings, roles: ['owner', 'manager'] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, store, logout } = useAuth();
  const { isOnline, pendingCount, isSyncing, refreshData, isRefreshing, refreshMessage } = useSync();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [storeLogo, setStoreLogo] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const onLogoUpdated = (event: Event) => setStoreLogo((event as CustomEvent<string>).detail || null);
    window.addEventListener('teleboutik:store-logo-updated', onLogoUpdated);
    queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'store_logo_data_url' LIMIT 1")
      .then((row) => { if (active) setStoreLogo(row?.value || null); })
      .catch((error) => console.warn('Logo boutique indisponible :', error));
    return () => { active = false; window.removeEventListener('teleboutik:store-logo-updated', onLogoUpdated); };
  }, [store?.id]);

  const refreshApplication = () => { void refreshData(); };

  if (!user) return null;

  const syncBarVisible = !isOnline || pendingCount > 0 || isSyncing;

  const navItems = ALL_NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="min-h-screen">
      {refreshMessage && (
        <div role="status" aria-live="polite" className={`fixed bottom-4 left-4 right-4 z-[80] mx-auto max-w-xl rounded-xl border px-4 py-3 text-sm shadow-lg ${refreshMessage.startsWith('Données actualisées') ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
          <div className="flex items-start justify-between gap-3">
            <span>{refreshMessage}</span>
            <button type="button" onClick={() => useSync.setState({ refreshMessage: null })} aria-label="Fermer le message" className="font-bold">×</button>
          </div>
        </div>
      )}
      {/* Barre supérieure mobile / tablette */}
      <header className={`lg:hidden fixed ${syncBarVisible ? 'top-7' : 'top-0'} inset-x-0 z-40 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/85 px-3 backdrop-blur-md no-select transition-all`}>
        <button
          onClick={() => setSidebarOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 active:bg-slate-200/70"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button type="button" onClick={refreshApplication} disabled={isRefreshing} title={refreshMessage || 'Actualiser les données'} aria-label="Actualiser les données TeleBoutik" className="flex items-center gap-2 rounded-lg p-1 hover:bg-slate-100 active:scale-95 disabled:opacity-60">
          {isRefreshing ? <RefreshCw className="h-5 w-5 animate-spin text-primary-700" /> : (storeLogo ? <img src={storeLogo} alt="Logo de la boutique" className="h-8 w-8 rounded-lg object-contain" /> : <div className="grid h-7 w-7 place-items-center rounded-lg bg-ink-900"><Store className="h-4 w-4 text-primary-300" /></div>)}
          <p className="text-sm font-extrabold tracking-tight text-slate-900">TeleBoutik</p>
        </button>
        <ThemeToggle />
      </header>

      {/* Fond sombre derrière le menu (mobile) */}
      <div
        className={`lg:hidden fixed inset-0 z-40 bg-ink-950/50 backdrop-blur-[3px] transition-opacity duration-300 ${sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* Menu latéral */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-ink-900 text-slate-200 no-select
          shadow-2xl lg:shadow-none transition-transform duration-300 ease-smooth
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        <div className="flex items-center justify-between px-5 pb-4 pt-5">
          <button type="button" onClick={refreshApplication} disabled={isRefreshing} title={refreshMessage || 'Actualiser les données'} aria-label="Actualiser les données TeleBoutik" className="flex min-w-0 items-center gap-3 rounded-xl text-left hover:opacity-90 active:scale-[.99] disabled:opacity-60">
            {isRefreshing ? <RefreshCw className="h-8 w-8 shrink-0 animate-spin text-primary-300" /> : (storeLogo ? <img src={storeLogo} alt="Logo de la boutique" className="h-10 w-10 shrink-0 rounded-xl bg-white object-contain p-0.5" /> : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-600 shadow-lg shadow-primary-900/40"><Store className="h-5 w-5 text-white" /></div>)}
            <div className="min-w-0">
              <p className="text-[15px] font-extrabold leading-tight tracking-tight text-white">TeleBoutik</p>
              <p className="max-w-[9.5rem] truncate text-xs text-slate-400">{isRefreshing ? 'Actualisation…' : (store?.name ?? 'Point de vente')}</p>
            </div>
          </button>
          <button
            onClick={closeSidebar}
            className="lg:hidden grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white active:bg-white/15"
            aria-label="Fermer le menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} onClick={closeSidebar} className="nav-link">
                <Icon />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="mb-2 flex items-center justify-between rounded-xl px-2 py-1 text-slate-300">
            <ThemeToggle showLabel className="w-full justify-between" />
          </div>
          <div className="mb-1 flex items-center gap-3 rounded-xl px-2 py-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-600/25 text-sm font-bold text-primary-200 ring-1 ring-primary-400/30">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{user.name}</p>
              <p className="text-xs text-slate-400">{roleLabel(user.role)}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-[13.5px] font-semibold text-slate-300 hover:bg-white/10 hover:text-white active:bg-white/15"
          >
            <LogOut className="h-[18px] w-[18px]" />
            Déconnexion
          </button>
        </div>
      </aside>

      {/* Contenu principal */}
      <main className={`lg:ml-64 min-h-screen ${syncBarVisible ? 'pt-[84px]' : 'pt-14'} lg:pt-0`}>
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:px-10 lg:py-8">
          <HelpInfo />
          {children}
        </div>
      </main>
    </div>
  );
}
