import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, ShoppingBag, DollarSign, Package, Users, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { query } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, canSeeMargin, paymentLabel } from '../lib/utils';

interface KpiData {
  todayRevenue: number;
  todayTickets: number;
  todayMargin: number;
  monthRevenue: number;
  monthMargin: number;
  stockValue: number;
  activeCredits: number;
  lowStockCount: number;
}

interface DayRevenue {
  date: string;
  revenue: number;
  margin: number;
}

interface PaymentBreakdown {
  method: string;
  amount: number;
}

const COLORS = ['#0f766e', '#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];

export default function DashboardPage() {
  const { user, store } = useAuth();
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [dailyRevenue, setDailyRevenue] = useState<DayRevenue[]>([]);
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentBreakdown[]>([]);
  const [topProducts, setTopProducts] = useState<Array<{ name: string; qty: number; revenue: number }>>([]);
  const [recentSales, setRecentSales] = useState<Array<{ ticket: string; total: number; date: string }>>([]);

  const loadData = useCallback(async () => {
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.substring(0, 7) + '-01';

    const todayRow = await query<{ total: number; count: number; margin: number }>(
      `SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count, COALESCE(SUM(total - total_cost), 0) as margin
       FROM sales WHERE status = 'completed' AND sale_date >= $1`,
      [today + ' 00:00:00']
    );
    const monthRow = await query<{ total: number; margin: number }>(
      `SELECT COALESCE(SUM(total), 0) as total, COALESCE(SUM(total - total_cost), 0) as margin
       FROM sales WHERE status = 'completed' AND sale_date >= $1`,
      [monthStart + ' 00:00:00']
    );
    const stockRow = await query<{ value: number }>(
      `SELECT COALESCE(SUM(
        (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN quantity ELSE -quantity END), 0)
         FROM stock_movements WHERE variant_id = pv.id) * pv.purchase_price
      ), 0) as value
      FROM product_variants pv`
    );
    const creditRow = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM credit_plans WHERE status IN ('active', 'late')`
    );
    const lowStockRow = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM (
        SELECT pv.id,
          COALESCE((SELECT SUM(CASE WHEN direction='in' THEN quantity ELSE -quantity END) FROM stock_movements WHERE variant_id = pv.id), 0) as qty,
          (SELECT COUNT(*) FROM imei_units WHERE variant_id = pv.id AND lifecycle_status = 'in_stock') as imei
        FROM product_variants pv
        WHERE COALESCE((SELECT SUM(CASE WHEN direction='in' THEN quantity ELSE -quantity END) FROM stock_movements WHERE variant_id = pv.id), 0) <= pv.min_stock
           OR ((SELECT COUNT(*) FROM imei_units WHERE variant_id = pv.id AND lifecycle_status = 'in_stock') <= pv.min_stock
               AND EXISTS (SELECT 1 FROM products p WHERE p.id = pv.product_id AND p.is_serialized = true))
      ) as sub`
    );

    setKpi({
      todayRevenue: todayRow[0]?.total ?? 0,
      todayTickets: todayRow[0]?.count ?? 0,
      todayMargin: todayRow[0]?.margin ?? 0,
      monthRevenue: monthRow[0]?.total ?? 0,
      monthMargin: monthRow[0]?.margin ?? 0,
      stockValue: stockRow[0]?.value ?? 0,
      activeCredits: creditRow[0]?.count ?? 0,
      lowStockCount: lowStockRow[0]?.count ?? 0,
    });

    const last30 = new Date();
    last30.setDate(last30.getDate() - 29);
    const dailyRows = await query<{ date: string; revenue: number; margin: number }>(
      `SELECT DATE(sale_date) as date, SUM(total) as revenue, SUM(total - total_cost) as margin
       FROM sales WHERE status = 'completed' AND sale_date >= $1
       GROUP BY DATE(sale_date) ORDER BY date`,
      [last30.toISOString().split('T')[0] + ' 00:00:00']
    );
    setDailyRevenue(dailyRows.map((r) => ({
      date: r.date,
      revenue: r.revenue,
      margin: r.margin,
    })));

    const payRows = await query<{ method: string; amount: number }>(
      `SELECT payment_method as method, SUM(amount) as amount
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
       WHERE s.status = 'completed' AND s.sale_date >= $1
       GROUP BY payment_method ORDER BY amount DESC`,
      [monthStart + ' 00:00:00']
    );
    setPaymentBreakdown(payRows.map((r) => ({ method: paymentLabel(r.method), amount: r.amount })));

    const topRows = await query<{ name: string; qty: number; revenue: number }>(
      `SELECT sl.product_name as name, SUM(sl.quantity) as qty, SUM(sl.line_total) as revenue
       FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
       WHERE s.status = 'completed' AND s.sale_date >= $1
       GROUP BY sl.product_name ORDER BY revenue DESC LIMIT 10`,
      [monthStart + ' 00:00:00']
    );
    setTopProducts(topRows.map((r) => ({ name: r.name, qty: r.qty, revenue: r.revenue })));

    const recentRows = await query<{ ticket: string; total: number; date: string }>(
      `SELECT ticket_number as ticket, total, sale_date as date FROM sales
       WHERE status = 'completed' ORDER BY sale_date DESC LIMIT 10`
    );
    setRecentSales(recentRows.map((r) => ({ ticket: r.ticket, total: r.total, date: r.date })));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (!user || !store || !kpi) return null;
  const showMargin = canSeeMargin(user.role);
  const currency = store.currency;
  const decimals = store.currency_decimals;

  const kpiCards = [
    { label: 'CA du jour', value: formatCurrency(kpi.todayRevenue, currency, decimals), icon: DollarSign, color: 'text-primary-600', bg: 'bg-primary-50' },
    { label: 'Tickets du jour', value: kpi.todayTickets.toString(), icon: ShoppingBag, color: 'text-blue-600', bg: 'bg-blue-50' },
    ...(showMargin ? [{ label: 'Marge du jour', value: formatCurrency(kpi.todayMargin, currency, decimals), icon: TrendingUp, color: 'text-success-600', bg: 'bg-success-50' }] : []),
    { label: 'CA du mois', value: formatCurrency(kpi.monthRevenue, currency, decimals), icon: DollarSign, color: 'text-accent-600', bg: 'bg-accent-50' },
    ...(showMargin ? [{ label: 'Marge du mois', value: formatCurrency(kpi.monthMargin, currency, decimals), icon: TrendingUp, color: 'text-success-600', bg: 'bg-success-50' }] : []),
    { label: 'Valeur stock', value: showMargin ? formatCurrency(kpi.stockValue, currency, decimals) : '—', icon: Package, color: 'text-slate-600', bg: 'bg-slate-100' },
    { label: 'Crédits actifs', value: kpi.activeCredits.toString(), icon: Users, color: 'text-warning-600', bg: 'bg-warning-50' },
    { label: 'Stock bas', value: kpi.lowStockCount.toString(), icon: AlertTriangle, color: 'text-error-600', bg: 'bg-error-50' },
  ];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Tableau de Bord</h1>
        <p className="text-sm text-slate-500">Vue d'ensemble de la boutique</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {kpiCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} className="card p-3">
              <div className={`w-8 h-8 ${card.bg} rounded-lg flex items-center justify-center mb-2`}>
                <Icon className={`w-4 h-4 ${card.color}`} />
              </div>
              <p className="text-xs text-slate-400">{card.label}</p>
              <p className="text-lg font-bold text-slate-800">{card.value}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="card p-4">
          <h3 className="font-semibold text-slate-700 text-sm mb-3">CA et Marge (30 derniers jours)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={dailyRevenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.substring(5)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(value: number) => formatCurrency(value, currency, decimals)}
                labelFormatter={(label: string) => label}
              />
              <Bar dataKey="revenue" fill="#0f766e" radius={[4, 4, 0, 0]} />
              {showMargin && <Bar dataKey="margin" fill="#22c55e" radius={[4, 4, 0, 0]} />}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <h3 className="font-semibold text-slate-700 text-sm mb-3">Mix de paiements (mois en cours)</h3>
          {paymentBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={paymentBreakdown} dataKey="amount" nameKey="method" cx="50%" cy="50%" outerRadius={80} label={(entry) => entry.method}>
                  {paymentBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value, currency, decimals)} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-slate-300 text-sm">Aucune donnée</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="font-semibold text-slate-700 text-sm mb-3">Top 10 produits (mois)</h3>
          {topProducts.length > 0 ? (
            <div className="space-y-2">
              {topProducts.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 bg-slate-100 rounded text-xs flex items-center justify-center text-slate-500">{i + 1}</span>
                    <span className="text-slate-700 truncate">{p.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-400">{p.qty} vendus</span>
                    <span className="ml-2 font-medium text-slate-800">{formatCurrency(p.revenue, currency, decimals)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-300 text-sm text-center py-8">Aucune donnée</p>
          )}
        </div>

        <div className="card p-4">
          <h3 className="font-semibold text-slate-700 text-sm mb-3">Dernières ventes</h3>
          {recentSales.length > 0 ? (
            <div className="space-y-2">
              {recentSales.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-slate-50 pb-1.5">
                  <div>
                    <span className="font-mono text-xs text-slate-500">{s.ticket}</span>
                    <span className="text-xs text-slate-400 ml-2">{s.date.substring(11, 16)}</span>
                  </div>
                  <span className="font-medium text-slate-800">{formatCurrency(s.total, currency, decimals)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-300 text-sm text-center py-8">Aucune vente</p>
          )}
        </div>
      </div>
    </div>
  );
}
