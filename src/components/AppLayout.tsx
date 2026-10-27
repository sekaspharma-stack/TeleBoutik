import { useState } from 'react';
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
  LogOut,
  Store,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { roleLabel, canSeeExpenses, canManageUsers, canSeeMargin } from '../lib/utils';

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
  { to: '/audit', label: 'Audit', icon: ScrollText, roles: ['owner'] },
  { to: '/settings', label: 'Paramètres', icon: Settings, roles: ['owner', 'manager'] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, store, logout } = useAuth();
  const { isOnline, pendingCount, isSyncing } = useSync();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!user) return null;

  const syncBarVisible = !isOnline || pendingCount > 0 || isSyncing;

  const navItems = ALL_NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile top bar */}
      <header className={`lg:hidden fixed ${syncBarVisible ? 'top-7' : 'top-0'} inset-x-0 z-40 bg-white border-b border-slate-200 px-4 h-14 flex items-center justify-between no-select transition-all`}>
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 -ml-2 rounded-lg hover:bg-slate-100 transition-colors"
          aria-label="Ouvrir le menu"
        >
          <Menu className="w-5 h-5 text-slate-600" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-primary-600 rounded-lg flex items-center justify-center">
            <Store className="w-4 h-4 text-white" />
          </div>
          <p className="font-bold text-slate-800 text-sm">TeleBoutik</p>
        </div>
        <div className="w-9" />
      </header>

      {/* Backdrop overlay (mobile only) */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          w-60 bg-white border-r border-slate-200 flex flex-col fixed inset-y-0 left-0 z-50 no-select
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        <div className="px-4 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-primary-600 rounded-lg flex items-center justify-center">
              <Store className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-bold text-slate-800 text-sm">TeleBoutik</p>
              <p className="text-xs text-slate-400">{store?.name ?? 'POS'}</p>
            </div>
          </div>
          <button
            onClick={closeSidebar}
            className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Fermer le menu"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={closeSidebar}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary-50 text-primary-700 border-r-2 border-primary-600'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`
                }
              >
                <Icon className="w-5 h-5 shrink-0" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="flex items-center gap-3 mb-2 px-1">
            <div className="w-9 h-9 bg-slate-200 rounded-full flex items-center justify-center text-sm font-semibold text-slate-600">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 truncate">{user.name}</p>
              <p className="text-xs text-slate-400">{roleLabel(user.role)}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Déconnexion
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className={`lg:ml-60 min-h-screen ${syncBarVisible ? 'pt-[84px]' : 'pt-14'} lg:pt-0`}>
        <div className="p-4 sm:p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
