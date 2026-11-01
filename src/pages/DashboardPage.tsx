import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, ShoppingBag, Wallet, Banknote, Package, Users, AlertTriangle, Receipt } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { query } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, canSeeMargin, paymentLabel } from '../lib/utils';
import { MoneyCard, KpiCard } from '../components/MoneyCard';

interface KpiData {
  todayRevenue: number;
  todayTickets: number;
  todayMargin: number;
  monthRevenue: number;
  monthMargin: number;
  stockValue: number;
  activeCredits: number;
  lowStockCount: number;
  soldPhones: number;
  soldItems: number;
  collectedUSD: number;
  collectedCDF: number;
  revenueUSD: number;
  revenueCDF: number;
  marginUSD: number;
  marginCDF: number;
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
  const [period, setPeriod] = useState<'yesterday' | 'today' | 'week' | 'month' | 'year' | 'custom'>('today');
  const [chartCurrency, setChartCurrency] = useState<'USD' | 'CDF'>('USD');
  const [customStart, setCustomStart] = useState(new Date().toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));

  const loadData = useCallback(async () => {
    const localDate = (d: Date) => { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}`; };
    const nowDate = new Date();
    const today = localDate(nowDate);
    const monthStart = today.substring(0, 7) + '-01';
    const startDate = new Date(nowDate); let rangeStart = today; let rangeEnd = today;
    if (period === 'yesterday') { startDate.setDate(startDate.getDate() - 1); rangeStart = rangeEnd = localDate(startDate); }
    else if (period === 'week') { startDate.setDate(startDate.getDate() - 6); rangeStart = localDate(startDate); }
    else if (period === 'month') rangeStart = monthStart;
    else if (period === 'year') rangeStart = `${nowDate.getFullYear()}-01-01`;
    else if (period === 'custom') { rangeStart = customStart || today; rangeEnd = customEnd || today; }
    const rangeStartTs = `${rangeStart} 00:00:00`;
    const rangeEndTs = `${rangeEnd} 23:59:59`;

    const todayRow = await query<{ total: number; count: number; margin: number }>(
      `SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count, COALESCE(SUM(total - total_cost), 0) as margin
       FROM sales WHERE status = 'completed' AND sale_date >= $1 AND sale_date <= $2`,
      [rangeStartTs, rangeEndTs]
    );
    const soldRow = await query<{ phones: number; items: number }>(
      `SELECT COALESCE(SUM(CASE WHEN p.is_serialized THEN sl.quantity ELSE 0 END), 0) AS phones,
              COALESCE(SUM(sl.quantity), 0) AS items
       FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
       LEFT JOIN product_variants pv ON pv.id = sl.variant_id
       LEFT JOIN products p ON p.id = pv.product_id
       WHERE s.status = 'completed' AND s.sale_date >= $1 AND s.sale_date <= $2`, [rangeStartTs, rangeEndTs]
    );
    const collectedRows = await query<{ currency_code: string; total: number }>(
      `SELECT COALESCE(sp.currency_code, s.currency_code, 'USD') AS currency_code,
              COALESCE(SUM(CASE WHEN sp.original_amount > 0 THEN sp.original_amount ELSE sp.amount END), 0) AS total
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
       WHERE s.status = 'completed' AND s.sale_date >= $1 AND s.sale_date <= $2 AND sp.payment_method NOT IN ('credit','voucher')
       GROUP BY COALESCE(sp.currency_code, s.currency_code, 'USD')`, [rangeStartTs, rangeEndTs]
    );
    const revenueRows = await query<{ currency_code: string; total: number; margin: number }>(
      `SELECT COALESCE(currency_code, 'USD') AS currency_code, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(total - total_cost), 0) AS margin FROM sales
       WHERE status = 'completed' AND sale_date >= $1 AND sale_date <= $2 GROUP BY COALESCE(currency_code, 'USD')`, [rangeStartTs, rangeEndTs]
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
      soldPhones: Number(soldRow[0]?.phones ?? 0),
      soldItems: Number(soldRow[0]?.items ?? 0),
      collectedUSD: Number(collectedRows.filter((r) => r.currency_code === 'USD').reduce((sum, r) => sum + Number(r.total || 0), 0)),
      collectedCDF: Number(collectedRows.filter((r) => r.currency_code === 'CDF').reduce((sum, r) => sum + Number(r.total || 0), 0)),
      revenueUSD: Number(revenueRows.filter((r) => r.currency_code === 'USD').reduce((sum, r) => sum + Number(r.total || 0), 0)),
      revenueCDF: Number(revenueRows.filter((r) => r.currency_code === 'CDF').reduce((sum, r) => sum + Number(r.total || 0), 0)),
      marginUSD: Number(revenueRows.filter((r) => r.currency_code === 'USD').reduce((sum, r) => sum + Number(r.margin || 0), 0)),
      marginCDF: Number(revenueRows.filter((r) => r.currency_code === 'CDF').reduce((sum, r) => sum + Number(r.margin || 0), 0)),
    });

    const last30 = new Date();
    last30.setDate(last30.getDate() - 29);
    const dailyRows = await query<{ date: string; revenue: number; margin: number }>(
      `SELECT DATE(sale_date) as date, SUM(total) as revenue, SUM(total - total_cost) as margin
       FROM sales WHERE status = 'completed' AND sale_date >= $1 AND currency_code = $2
       GROUP BY DATE(sale_date) ORDER BY date`,
      [last30.toISOString().split('T')[0] + ' 00:00:00', chartCurrency]
    );
    setDailyRevenue(dailyRows.map((r) => ({
      date: r.date,
      revenue: r.revenue,
      margin: r.margin,
    })));

    const payRows = await query<{ method: string; amount: number }>(
      `SELECT payment_method as method, SUM(amount) as amount
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
       WHERE s.status = 'completed' AND s.sale_date >= $1 AND s.currency_code = $2
       GROUP BY payment_method ORDER BY amount DESC`,
      [monthStart + ' 00:00:00', chartCurrency]
    );
    setPaymentBreakdown(payRows.map((r) => ({ method: paymentLabel(r.method), amount: r.amount })));

    const topRows = await query<{ name: string; qty: number; revenue: number }>(
      `SELECT sl.product_name as name, SUM(sl.quantity) as qty, SUM(sl.line_total) as revenue
       FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
       WHERE s.status = 'completed' AND s.sale_date >= $1 AND s.currency_code = $2
       GROUP BY sl.product_name ORDER BY revenue DESC LIMIT 10`,
      [monthStart + ' 00:00:00', chartCurrency]
    );
    setTopProducts(topRows.map((r) => ({ name: r.name, qty: r.qty, revenue: r.revenue })));

    const recentRows = await query<{ ticket: string; total: number; date: string }>(
      `SELECT ticket_number as ticket, total, sale_date as date FROM sales
       WHERE status = 'completed' ORDER BY sale_date DESC LIMIT 10`
    );
    setRecentSales(recentRows.map((r) => ({ ticket: r.ticket, total: r.total, date: r.date })));
  }, [period, customStart, customEnd, chartCurrency]);

  useEffect(() => { loadData(); }, [loadData]);

  if (!user || !store || !kpi) return null;
  const showMargin = canSeeMargin(user.role);
  const currency = store.currency;
  const decimals = store.currency_decimals;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Tableau de Bord</h1>
        <p className="text-sm text-slate-500">Vue d'ensemble de la boutique</p>
      </div>
      <div className="card p-3 mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1"><label className="label">Période du tableau de bord</label><select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="input"><option value="yesterday">Hier</option><option value="today">Aujourd’hui</option><option value="week">Hebdomadaire (7 jours)</option><option value="month">Mensuel</option><option value="year">Annuel</option><option value="custom">Période personnalisée</option></select></div>
        {period === 'custom' && <><div><label className="label">Du</label><input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="input" /></div><div><label className="label">Au</label><input type="date" min={customStart} value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="input" /></div></>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <MoneyCard
          className="col-span-2"
          title="Chiffre d'affaires de la période"
          subtitle="Ventes terminées, par devise"
          icon={Wallet}
          usd={kpi.revenueUSD}
          cdf={kpi.revenueCDF}
          from="#0F766E"
          to="#2DD4BF"
        />
        <MoneyCard
          className="col-span-2"
          title="Encaissé"
          subtitle="Argent réellement reçu (hors crédit)"
          icon={Banknote}
          usd={kpi.collectedUSD}
          cdf={kpi.collectedCDF}
          from="#1D4ED8"
          to="#38BDF8"
        />
        {showMargin && (
          <MoneyCard
            className="col-span-2"
            title="Marge de la période"
            subtitle="Prix de vente − coût d'achat"
            icon={TrendingUp}
            usd={kpi.marginUSD}
            cdf={kpi.marginCDF}
            from="#6D28D9"
            to="#A78BFA"
          />
        )}
        <KpiCard label="Tickets de la période" value={kpi.todayTickets.toString()} icon={Receipt} color="#3B82F6" />
        <KpiCard label="Téléphones vendus" value={kpi.soldPhones.toString()} icon={ShoppingBag} color="#8B5CF6" />
        <KpiCard label="Articles vendus" value={kpi.soldItems.toString()} icon={Package} color="#F59E0B" />
        <KpiCard label="Crédits actifs" value={kpi.activeCredits.toString()} icon={Users} color="#F97316" />
        <KpiCard label="Stock bas" value={kpi.lowStockCount.toString()} icon={AlertTriangle} color="#EF4444" hint={kpi.lowStockCount > 0 ? 'À réapprovisionner' : 'Tout est en ordre'} />
      </div>

      <div className="flex justify-end mb-2"><label className="text-sm text-slate-500 flex items-center gap-2">Devise des graphiques <select className="input !w-auto" value={chartCurrency} onChange={(e) => setChartCurrency(e.target.value as 'USD' | 'CDF')}><option value="USD">USD</option><option value="CDF">CDF</option></select></label></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="card p-4">
          <h3 className="font-semibold text-slate-700 text-sm mb-3">CA et marge — 30 derniers jours ({chartCurrency})</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={dailyRevenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: unknown) => { const text = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ''); return text.length >= 6 ? text.slice(5) : text; }} />
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
          <h3 className="font-semibold text-slate-700 text-sm mb-3">Mix de paiements (mois en cours, {chartCurrency})</h3>
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
          <h3 className="font-semibold text-slate-700 text-sm mb-3">Top 10 produits (mois, {chartCurrency})</h3>
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
                    <span className="text-xs text-slate-400 ml-2">{String(s.date ?? '').slice(11, 16)}</span>
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
