'use client';

/**
 * Admin Reports — report hub with 8 report types:
 *  1. Sales & Profit (chart + top products, as before)
 *  2. Category Report (stock overview per category)
 *  3. Category-wise Quantity (stock vs purchased vs sold per category)
 *  4. Category-wise Profit (revenue / cost / profit per category)
 *  5. Low Stock Summary (out-of-stock + below threshold products)
 *  6. Recent Purchases (latest stock-in transactions)
 *  7. Expense Report (list + by-category, period filtered)
 *  8. Staff Payment Report (list + per-staff totals, period filtered)
 * Every table is printable / PDF-able through the generic report printer.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  PiggyBank,
  Wallet,
  Award,
  Printer,
  Layers,
  Hash,
  AlertTriangle,
  ShoppingCart,
  ReceiptText,
  UserCog,
  BarChart3,
} from 'lucide-react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  getTransactionsOffline,
  getExpensesOffline,
  getProductsOffline,
  getCategoriesOffline,
  getStaffPaymentsOffline,
  localDateStr,
  isSaleType,
} from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import { printGenericReport, escHtml } from './print';
import {
  AdminCard,
  Badge,
  Btn,
  EmptyState,
  Field,
  PageHeader,
  StatCard,
  Td,
  Th,
  TextInput,
  fmtMoney,
  fmtDate,
  ADMIN_COLORS,
} from './admin-ui';
import type { Transaction, Product, Category, Expense, StaffPayment } from '@/lib/types';

type Period = 'today' | 'week' | 'month' | 'custom';

type ReportTab = 'sales' | 'category' | 'catqty' | 'catprofit' | 'lowstock' | 'purchases' | 'expense' | 'staff';

const TABS: { key: ReportTab; icon: React.ComponentType<{ size?: number | string }>; labelKey: string }[] = [
  { key: 'sales', icon: TrendingUp, labelKey: 'rep.tab.sales' },
  { key: 'category', icon: Layers, labelKey: 'rep.tab.category' },
  { key: 'catqty', icon: Hash, labelKey: 'rep.tab.catqty' },
  { key: 'catprofit', icon: PiggyBank, labelKey: 'rep.tab.catprofit' },
  { key: 'lowstock', icon: AlertTriangle, labelKey: 'rep.tab.lowstock' },
  { key: 'purchases', icon: ShoppingCart, labelKey: 'rep.tab.purchases' },
  { key: 'expense', icon: ReceiptText, labelKey: 'rep.tab.expense' },
  { key: 'staff', icon: UserCog, labelKey: 'rep.tab.staff' },
];

/** Tabs that ignore the period selector (they show current/recent state). */
const PERIODLESS: ReportTab[] = ['lowstock', 'purchases'];

function rangeFor(period: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const today = localDateStr();
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return { from: localDateStr(d), to: today };
  }
  if (period === 'month') {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return { from: localDateStr(d), to: today };
  }
  return customFrom <= customTo ? { from: customFrom, to: customTo } : { from: customTo, to: customFrom };
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export default function AdminReports() {
  const lang = useAdminStore((s) => s.language);
  const dark = useAdminStore((s) => s.theme === 'dark');
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [tab, setTab] = useState<ReportTab>('sales');
  const [period, setPeriod] = useState<Period>('week');
  const [customFrom, setCustomFrom] = useState(localDateStr(new Date(Date.now() - 29 * 86400000)));
  const [customTo, setCustomTo] = useState(localDateStr());
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [allTxns, setAllTxns] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [staffPayments, setStaffPayments] = useState<StaffPayment[]>([]);
  const [expenseTotal, setExpenseTotal] = useState(0);

  const range = rangeFor(period, customFrom, customTo);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [ts, ats, prods, cats, ex, sp] = await Promise.all([
        getTransactionsOffline(DEFAULT_USER_ID, { from: range.from, to: range.to }),
        getTransactionsOffline(DEFAULT_USER_ID),
        getProductsOffline(DEFAULT_USER_ID),
        getCategoriesOffline(DEFAULT_USER_ID),
        getExpensesOffline(DEFAULT_USER_ID, { from: range.from, to: range.to }),
        getStaffPaymentsOffline(DEFAULT_USER_ID, { from: range.from, to: range.to }),
      ]);
      if (!alive) return;
      setTxns(ts);
      setAllTxns(ats);
      setProducts(prods);
      setCategories(cats);
      setExpenses(ex.expenses);
      setExpenseTotal(ex.summary.totalExpense);
      setStaffPayments(sp.staffPayments);
    })();
    return () => {
      alive = false;
    };
  }, [tick, range.from, range.to]);

  const catName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);
  const prodCat = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) m.set(p.id, catName.get(p.categoryId) || '');
    return m;
  }, [products, catName]);

  // ── shared sales math (per-transaction profit via FIFO cost snapshot) ──
  const salesStats = useMemo(() => {
    const sales = txns.filter((x) => isSaleType(x.type));
    let totalSales = 0;
    let totalProfit = 0;
    const dayMap = new Map<string, { day: string; sales: number; profit: number }>();
    const prodMap = new Map<string, { name: string; qty: number; revenue: number }>();

    for (const x of sales) {
      const cost = (x.quantity || 0) * (x.product?.purchasePrice ?? 0);
      const profit = (x.totalAmount || 0) - cost;
      totalSales += x.totalAmount || 0;
      totalProfit += profit;

      const d = dayMap.get(x.date) || { day: dayLabel(x.date), sales: 0, profit: 0 };
      d.sales += x.totalAmount || 0;
      d.profit += profit;
      dayMap.set(x.date, d);

      const key = x.productId;
      const p = prodMap.get(key) || { name: x.product?.name || '—', qty: 0, revenue: 0 };
      p.qty += x.quantity || 0;
      p.revenue += x.totalAmount || 0;
      prodMap.set(key, p);
    }

    const byDay = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
    const topProducts = [...prodMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
    const maxRevenue = Math.max(1, ...topProducts.map((p) => p.revenue));
    return { totalSales, totalProfit, byDay, topProducts, maxRevenue };
  }, [txns]);

  // ── category aggregation (stock + period sold/purchased + profit) ──
  const catAgg = useMemo(() => {
    interface CatRow {
      name: string;
      products: number;
      stockQty: number;
      buyValue: number;
      saleValue: number;
      inQty: number;
      soldQty: number;
      revenue: number;
      cost: number;
      profit: number;
    }
    const rows = new Map<string, CatRow>();
    const ensure = (name: string): CatRow => {
      let row = rows.get(name);
      if (!row) {
        row = {
          name,
          products: 0,
          stockQty: 0,
          buyValue: 0,
          saleValue: 0,
          inQty: 0,
          soldQty: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
        };
        rows.set(name, row);
      }
      return row;
    };

    const unknown = ensure(t('rep.unknownCat'));
    for (const p of products) {
      const name = prodCat.get(p.id) || '';
      const row = name ? ensure(name) : unknown;
      row.products += 1;
      row.stockQty += p.quantity || 0;
      row.buyValue += (p.quantity || 0) * (p.purchasePrice || 0);
      row.saleValue += (p.quantity || 0) * (p.sellingPrice || 0);
    }

    for (const x of allTxns) {
      if (x.type === 'STOCK_IN') {
        const name = prodCat.get(x.productId) || '';
        const row = name ? ensure(name) : unknown;
        row.inQty += x.quantity || 0;
      }
    }
    for (const x of txns) {
      if (!isSaleType(x.type)) continue;
      const name = prodCat.get(x.productId) || '';
      const row = name ? ensure(name) : unknown;
      const revenue = x.totalAmount || 0;
      const cost = (x.quantity || 0) * (x.product?.purchasePrice ?? 0);
      row.soldQty += x.quantity || 0;
      row.revenue += revenue;
      row.cost += cost;
      row.profit += revenue - cost;
    }

    const list = [...rows.values()].filter((r) => r.products > 0 || r.soldQty > 0 || r.inQty > 0);
    list.sort((a, b) => b.revenue - a.revenue || b.stockQty - a.stockQty || a.name.localeCompare(b.name));
    return list;
  }, [products, prodCat, allTxns, txns, t]);

  const chartData = useMemo(() => {
    if (salesStats.byDay.length <= 15) return salesStats.byDay;
    return salesStats.byDay.filter((_, i) => i % 2 === 0 || i === salesStats.byDay.length - 1);
  }, [salesStats.byDay]);

  const periodLabel = `${fmtDate(range.from)} → ${fmtDate(range.to)}`;

  // ── per-tab print builders ────────────────────────────────────────
  const printTab = () => {
    const tabLabel = t(TABS.find((x) => x.key === tab)?.labelKey || 'rep.title');
    if (tab === 'category') {
      const totalBuy = catAgg.reduce((s, r) => s + r.buyValue, 0);
      const totalSale = catAgg.reduce((s, r) => s + r.saleValue, 0);
      void printGenericReport({
        title: `${tabLabel} — ${t('rep.tab.categorySub')}`,
        periodLabel: `${t('rep.asOn')}: ${fmtDate(localDateStr())}`,
        lang,
        chips: [
          { k: t('rep.categories'), v: String(catAgg.length) },
          { k: t('prod.products'), v: String(products.length) },
          { k: t('rep.stockValueBuy'), v: fmtMoney(totalBuy) },
          { k: t('rep.stockValueSale'), v: fmtMoney(totalSale) },
        ],
        tables: [
          {
            columns: [
              { label: '#', width: '34px' },
              { label: t('prod.category') },
              { label: t('prod.products'), right: true },
              { label: t('prod.qty'), right: true },
              { label: t('rep.stockValueBuy'), right: true },
              { label: t('rep.stockValueSale'), right: true },
            ],
            rows: catAgg.map((r, i) => [
              String(i + 1),
              escHtml(r.name),
              String(r.products),
              String(r.stockQty),
              fmtMoney(r.buyValue),
              fmtMoney(r.saleValue),
            ]),
            totalRow: [t('bills.grandTotal'), '', String(products.length), String(catAgg.reduce((s, r) => s + r.stockQty, 0)), fmtMoney(totalBuy), fmtMoney(totalSale)],
          },
        ],
      });
      return;
    }
    if (tab === 'catqty') {
      void printGenericReport({
        title: tabLabel,
        periodLabel,
        lang,
        chips: [
          { k: t('rep.categories'), v: String(catAgg.length) },
          { k: t('rep.soldQty'), v: String(catAgg.reduce((s, r) => s + r.soldQty, 0)) },
          { k: t('rep.inQty'), v: String(catAgg.reduce((s, r) => s + r.inQty, 0)) },
        ],
        tables: [
          {
            columns: [
              { label: '#', width: '34px' },
              { label: t('prod.category') },
              { label: t('rep.stockQty'), right: true },
              { label: t('rep.inQty'), right: true },
              { label: t('rep.soldQty'), right: true },
            ],
            rows: catAgg.map((r, i) => [String(i + 1), escHtml(r.name), String(r.stockQty), String(r.inQty), String(r.soldQty)]),
            totalRow: [t('bills.grandTotal'), '', String(catAgg.reduce((s, r) => s + r.stockQty, 0)), String(catAgg.reduce((s, r) => s + r.inQty, 0)), String(catAgg.reduce((s, r) => s + r.soldQty, 0))],
          },
        ],
      });
      return;
    }
    if (tab === 'catprofit') {
      const totalRevenue = catAgg.reduce((s, r) => s + r.revenue, 0);
      const totalCost = catAgg.reduce((s, r) => s + r.cost, 0);
      void printGenericReport({
        title: tabLabel,
        periodLabel,
        lang,
        chips: [
          { k: t('rep.totalSales'), v: fmtMoney(totalRevenue) },
          { k: t('rep.totalCost'), v: fmtMoney(totalCost) },
          { k: t('rep.totalProfit'), v: fmtMoney(totalRevenue - totalCost) },
        ],
        tables: [
          {
            columns: [
              { label: '#', width: '34px' },
              { label: t('prod.category') },
              { label: t('rep.soldQty'), right: true },
              { label: t('rep.revenue'), right: true },
              { label: t('rep.totalCost'), right: true },
              { label: t('rep.totalProfit'), right: true },
            ],
            rows: catAgg
              .filter((r) => r.revenue > 0 || r.cost > 0)
              .map((r, i) => [String(i + 1), escHtml(r.name), String(r.soldQty), fmtMoney(r.revenue), fmtMoney(r.cost), fmtMoney(r.profit)]),
            totalRow: [t('bills.grandTotal'), '', String(catAgg.reduce((s, r) => s + r.soldQty, 0)), fmtMoney(totalRevenue), fmtMoney(totalCost), fmtMoney(totalRevenue - totalCost)],
          },
        ],
      });
      return;
    }
    if (tab === 'lowstock') {
      const low = products.filter((p) => (p.quantity || 0) <= (p.lowStockThreshold ?? 0));
      const out = low.filter((p) => (p.quantity || 0) === 0);
      void printGenericReport({
        title: tabLabel,
        periodLabel: `${t('rep.asOn')}: ${fmtDate(localDateStr())}`,
        lang,
        chips: [
          { k: t('rep.outOfStock'), v: String(out.length) },
          { k: t('rep.lowStock'), v: String(low.length - out.length) },
          { k: t('prod.products'), v: String(products.length) },
        ],
        tables: [
          {
            columns: [
              { label: '#', width: '34px' },
              { label: t('prod.name') },
              { label: t('prod.category') },
              { label: t('prod.qty'), right: true },
              { label: t('rep.threshold'), right: true },
              { label: t('rep.status') },
            ],
            rows: low
              .slice()
              .sort((a, b) => (a.quantity || 0) - (b.quantity || 0))
              .map((p, i) => [
                String(i + 1),
                escHtml(p.name),
                escHtml(prodCat.get(p.id) || '—'),
                String(p.quantity || 0),
                String(p.lowStockThreshold ?? 0),
                escHtml((p.quantity || 0) === 0 ? t('rep.outOfStock') : t('rep.lowStock')),
              ]),
          },
        ],
      });
      return;
    }
    if (tab === 'purchases') {
      const ins = allTxns
        .filter((x) => x.type === 'STOCK_IN')
        .sort((a, b) => (a.date === b.date ? String(b.createdAt).localeCompare(String(a.createdAt)) : b.date.localeCompare(a.date)))
        .slice(0, 50);
      const total = ins.reduce((s, x) => s + (x.totalAmount || 0), 0);
      void printGenericReport({
        title: tabLabel,
        periodLabel: t('rep.recentN'),
        lang,
        chips: [
          { k: t('rep.purchases'), v: String(ins.length) },
          { k: t('rep.totalPurchase'), v: fmtMoney(total) },
        ],
        tables: [
          {
            columns: [
              { label: '#', width: '34px' },
              { label: t('exp.date') },
              { label: t('prod.name') },
              { label: t('prod.qty'), right: true },
              { label: t('prod.rate'), right: true },
              { label: t('bills.total'), right: true },
            ],
            rows: ins.map((x, i) => [
              String(i + 1),
              fmtDate(x.date),
              escHtml(x.product?.name || '—'),
              String(x.quantity || 0),
              fmtMoney(x.unitPrice || 0),
              fmtMoney(x.totalAmount || 0),
            ]),
            totalRow: [t('bills.grandTotal'), '', '', '', '', fmtMoney(total)],
          },
        ],
      });
      return;
    }
    if (tab === 'expense') {
      const byCat = new Map<string, number>();
      for (const e of expenses) byCat.set(e.category || '—', (byCat.get(e.category || '—') || 0) + (e.amount || 0));
      void printGenericReport({
        title: tabLabel,
        periodLabel,
        lang,
        chips: [
          { k: t('rep.expenseTotal'), v: fmtMoney(expenseTotal) },
          { k: t('staff.paidCount'), v: String(expenses.length) },
        ],
        tables: [
          {
            sectionTitle: t('rep.byCategory'),
            columns: [
              { label: '#', width: '34px' },
              { label: t('exp.category') },
              { label: t('exp.amount'), right: true },
            ],
            rows: [...byCat.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([c, v], i) => [String(i + 1), escHtml(c), fmtMoney(v)]),
            totalRow: [t('bills.grandTotal'), '', fmtMoney(expenseTotal)],
          },
          {
            sectionTitle: t('rep.detailList2'),
            columns: [
              { label: '#', width: '34px' },
              { label: t('exp.date') },
              { label: t('exp.category') },
              { label: t('exp.description') },
              { label: t('exp.amount'), right: true },
            ],
            rows: expenses.map((e, i) => [
              String(i + 1),
              fmtDate(e.date),
              escHtml(e.category || '—'),
              escHtml(e.description || '—'),
              fmtMoney(e.amount),
            ]),
            totalRow: [t('bills.grandTotal'), '', '', '', fmtMoney(expenseTotal)],
          },
        ],
      });
      return;
    }
    if (tab === 'staff') {
      const byStaff = new Map<string, number>();
      for (const p of staffPayments) byStaff.set(p.staffName, (byStaff.get(p.staffName) || 0) + (p.amount || 0));
      const total = staffPayments.reduce((s, p) => s + (p.amount || 0), 0);
      void printGenericReport({
        title: tabLabel,
        periodLabel,
        lang,
        chips: [
          { k: t('staff.total'), v: fmtMoney(total) },
          { k: t('staff.paidCount'), v: String(staffPayments.length) },
          { k: t('staff.staffCount'), v: String(byStaff.size) },
        ],
        tables: [
          {
            sectionTitle: t('staff.byStaff'),
            columns: [
              { label: '#', width: '34px' },
              { label: t('staff.name') },
              { label: t('staff.total'), right: true },
            ],
            rows: [...byStaff.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([n, v], i) => [String(i + 1), escHtml(n), fmtMoney(v)]),
            totalRow: [t('bills.grandTotal'), '', fmtMoney(total)],
          },
          {
            sectionTitle: t('rep.detailList2'),
            columns: [
              { label: '#', width: '34px' },
              { label: t('exp.date') },
              { label: t('staff.name') },
              { label: t('staff.kind') },
              { label: t('exp.description') },
              { label: t('exp.amount'), right: true },
            ],
            rows: staffPayments.map((p, i) => [
              String(i + 1),
              fmtDate(p.date),
              escHtml(p.staffName),
              escHtml(t(`staff.kind.${p.kind}`)),
              escHtml(p.note || '—'),
              fmtMoney(p.amount),
            ]),
            totalRow: [t('bills.grandTotal'), '', '', '', '', fmtMoney(total)],
          },
        ],
      });
      return;
    }
    // sales tab
    void printGenericReport({
      title: t('bills.soldReport'),
      periodLabel,
      lang,
      chips: [
        { k: t('rep.totalSales'), v: fmtMoney(salesStats.totalSales) },
        { k: t('rep.totalProfit'), v: fmtMoney(salesStats.totalProfit) },
        { k: t('rep.expenseTotal'), v: fmtMoney(expenseTotal) },
        { k: t('rep.netProfit'), v: fmtMoney(salesStats.totalProfit - expenseTotal) },
      ],
      tables: [
        {
          sectionTitle: t('rep.topProducts'),
          columns: [
            { label: '#', width: '34px' },
            { label: t('prod.name') },
            { label: t('bills.qtySold'), right: true },
            { label: t('bills.total'), right: true },
          ],
          rows: salesStats.topProducts.map((p, i) => [String(i + 1), escHtml(p.name), String(p.qty), fmtMoney(p.revenue)]),
        },
      ],
    });
  };

  const showPeriod = !PERIODLESS.includes(tab);

  return (
    <div>
      <PageHeader
        title={t('rep.title')}
        sub={t('rep.sub')}
        action={
          <Btn variant="outline" onClick={printTab}>
            <Printer size={16} /> <span className="hidden sm:inline">{t('bills.print')}</span>
          </Btn>
        }
      />

      {/* report type tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
        {TABS.map(({ key, icon: Icon, labelKey }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex shrink-0 items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              tab === key
                ? 'bg-[var(--psa-soft-orange)] border-[#FA6E41] text-[#E8552C]'
                : 'bg-[var(--psa-card)] border-[var(--psa-field-border)] text-[var(--psa-muted)] hover:border-[#FA6E41]/50'
            }`}
          >
            <Icon size={14} /> {t(labelKey)}
          </button>
        ))}
      </div>

      {/* period selector */}
      {showPeriod && (
        <AdminCard className="mb-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="grow">
              <Field label={t('rep.period')}>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {(['today', 'week', 'month', 'custom'] as Period[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                        period === p
                          ? 'bg-[var(--psa-soft-orange)] border-[#FA6E41] text-[#E8552C]'
                          : 'bg-[var(--psa-card)] border-[var(--psa-field-border)] text-[var(--psa-muted)] hover:border-[#FA6E41]/50'
                      }`}
                    >
                      {t(p === 'today' ? 'rep.today' : p === 'week' ? 'rep.week' : p === 'month' ? 'rep.month' : 'rep.custom')}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            {period === 'custom' && (
              <>
                <Field label={t('rep.from')}>
                  <TextInput type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                </Field>
                <Field label={t('rep.to')}>
                  <TextInput type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </Field>
              </>
            )}
          </div>
          <p className="text-xs text-[var(--psa-faint)] mt-2">
            {range.from} → {range.to}
          </p>
        </AdminCard>
      )}

      {/* ── SALES & PROFIT (original view) ── */}
      {tab === 'sales' && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            <StatCard icon={<TrendingUp size={18} />} label={t('rep.totalSales')} value={fmtMoney(salesStats.totalSales)} tone="orange" />
            <StatCard icon={<PiggyBank size={18} />} label={t('rep.totalProfit')} value={fmtMoney(salesStats.totalProfit)} tone="green" />
            <StatCard icon={<Wallet size={18} />} label={t('rep.expenseTotal')} value={fmtMoney(expenseTotal)} tone="red" />
            <StatCard
              icon={<Award size={18} />}
              label={t('rep.netProfit')}
              value={fmtMoney(salesStats.totalProfit - expenseTotal)}
              tone={salesStats.totalProfit - expenseTotal >= 0 ? 'green' : 'red'}
            />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <AdminCard title={t('rep.salesProfit')} className="lg:col-span-2">
              {salesStats.byDay.length === 0 ? (
                <EmptyState icon={<TrendingUp size={22} />} title={t('rep.noData')} />
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: dark ? '#8E9AAB' : '#6B7280' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: dark ? '#8E9AAB' : '#6B7280' }} axisLine={false} tickLine={false} width={58} />
                      <RTooltip
                        formatter={(v: number, name: string) => [
                          fmtMoney(v),
                          name === 'sales' ? t('rep.totalSales') : t('rep.totalProfit'),
                        ]}
                        contentStyle={{
                          borderRadius: 10,
                          border: '1px solid var(--psa-border)',
                          background: 'var(--psa-card)',
                          color: 'var(--psa-ink)',
                          fontSize: 12,
                        }}
                      />
                      <Legend
                        formatter={(v: string) => (
                          <span className="text-xs text-[var(--psa-muted)]">{v === 'sales' ? t('rep.totalSales') : t('rep.totalProfit')}</span>
                        )}
                      />
                      <Bar dataKey="sales" fill={ADMIN_COLORS.orange} radius={[5, 5, 0, 0]} maxBarSize={26} />
                      <Line type="monotone" dataKey="profit" stroke={ADMIN_COLORS.green} strokeWidth={2.2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </AdminCard>

            <AdminCard title={t('rep.topProducts')}>
              {salesStats.topProducts.length === 0 ? (
                <EmptyState icon={<Award size={22} />} title={t('rep.noData')} />
              ) : (
                <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                  {salesStats.topProducts.map((p, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1 gap-2">
                        <span className="font-medium text-[var(--psa-sub)] truncate">
                          {i + 1}. {p.name}
                        </span>
                        <span className="text-[var(--psa-muted)] tabular-nums shrink-0">{fmtMoney(p.revenue)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--psa-soft-slate)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#FA6E41]"
                          style={{ width: `${Math.max(4, (p.revenue / salesStats.maxRevenue) * 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-[var(--psa-faint)] mt-0.5">
                        {p.qty} {t('rep.sold')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </AdminCard>
          </div>
        </>
      )}

      {/* ── CATEGORY REPORT (stock overview) ── */}
      {tab === 'category' && (
        <AdminCard title={t('rep.tab.categorySub')} bodyClass="!p-0">
          {catAgg.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={<Layers size={22} />} title={t('rep.noData')} />
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
              <table className="w-full min-w-[640px]">
                <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                  <tr>
                    <Th>#</Th>
                    <Th>{t('prod.category')}</Th>
                    <Th className="text-right">{t('prod.products')}</Th>
                    <Th className="text-right">{t('prod.qty')}</Th>
                    <Th className="text-right">{t('rep.stockValueBuy')}</Th>
                    <Th className="text-right">{t('rep.stockValueSale')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {catAgg.map((r, i) => (
                    <tr key={r.name} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                      <Td className="text-[var(--psa-faint)]">{i + 1}</Td>
                      <Td className="font-semibold text-[var(--psa-sub)]">{r.name}</Td>
                      <Td className="text-right tabular-nums">{r.products}</Td>
                      <Td className="text-right tabular-nums">{r.stockQty}</Td>
                      <Td className="text-right tabular-nums text-[var(--psa-muted)]">{fmtMoney(r.buyValue)}</Td>
                      <Td className="text-right tabular-nums font-semibold text-[#16A34A]">{fmtMoney(r.saleValue)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {/* ── CATEGORY-WISE QUANTITY ── */}
      {tab === 'catqty' && (
        <AdminCard title={t('rep.tab.catqty')} bodyClass="!p-0">
          {catAgg.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={<Hash size={22} />} title={t('rep.noData')} />
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
              <table className="w-full min-w-[560px]">
                <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                  <tr>
                    <Th>#</Th>
                    <Th>{t('prod.category')}</Th>
                    <Th className="text-right">{t('rep.stockQty')}</Th>
                    <Th className="text-right">{t('rep.inQty')}</Th>
                    <Th className="text-right">{t('rep.soldQty')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {catAgg.map((r, i) => (
                    <tr key={r.name} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                      <Td className="text-[var(--psa-faint)]">{i + 1}</Td>
                      <Td className="font-semibold text-[var(--psa-sub)]">{r.name}</Td>
                      <Td className="text-right tabular-nums">{r.stockQty}</Td>
                      <Td className="text-right tabular-nums text-[var(--psa-muted)]">{r.inQty}</Td>
                      <Td className="text-right tabular-nums font-semibold text-[#E8552C]">{r.soldQty}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {/* ── CATEGORY-WISE PROFIT ── */}
      {tab === 'catprofit' && (
        <AdminCard title={t('rep.tab.catprofit')} bodyClass="!p-0">
          {catAgg.filter((r) => r.revenue > 0 || r.cost > 0).length === 0 ? (
            <div className="p-6">
              <EmptyState icon={<PiggyBank size={22} />} title={t('rep.noData')} />
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
              <table className="w-full min-w-[640px]">
                <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                  <tr>
                    <Th>#</Th>
                    <Th>{t('prod.category')}</Th>
                    <Th className="text-right">{t('rep.soldQty')}</Th>
                    <Th className="text-right">{t('rep.revenue')}</Th>
                    <Th className="text-right">{t('rep.totalCost')}</Th>
                    <Th className="text-right">{t('rep.totalProfit')}</Th>
                    <Th className="text-right">%</Th>
                  </tr>
                </thead>
                <tbody>
                  {catAgg
                    .filter((r) => r.revenue > 0 || r.cost > 0)
                    .map((r, i) => {
                      const margin = r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0;
                      return (
                        <tr key={r.name} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                          <Td className="text-[var(--psa-faint)]">{i + 1}</Td>
                          <Td className="font-semibold text-[var(--psa-sub)]">{r.name}</Td>
                          <Td className="text-right tabular-nums">{r.soldQty}</Td>
                          <Td className="text-right tabular-nums text-[var(--psa-muted)]">{fmtMoney(r.revenue)}</Td>
                          <Td className="text-right tabular-nums text-[var(--psa-muted)]">{fmtMoney(r.cost)}</Td>
                          <Td className={`text-right tabular-nums font-semibold ${r.profit >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                            {fmtMoney(r.profit)}
                          </Td>
                          <Td className={`text-right tabular-nums ${margin >= 0 ? 'text-[var(--psa-muted)]' : 'text-[#DC2626]'}`}>
                            {margin.toFixed(1)}%
                          </Td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {/* ── LOW STOCK SUMMARY ── */}
      {tab === 'lowstock' && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            <StatCard
              icon={<AlertTriangle size={18} />}
              label={t('rep.outOfStock')}
              value={String(products.filter((p) => (p.quantity || 0) === 0).length)}
              tone="red"
            />
            <StatCard
              icon={<AlertTriangle size={18} />}
              label={t('rep.lowStock')}
              value={String(products.filter((p) => (p.quantity || 0) > 0 && (p.quantity || 0) <= (p.lowStockThreshold ?? 0)).length)}
              tone="amber"
            />
            <StatCard icon={<BarChart3 size={18} />} label={t('prod.products')} value={String(products.length)} tone="slate" />
            <StatCard
              icon={<Layers size={18} />}
              label={t('rep.categories')}
              value={String(categories.length)}
              tone="orange"
            />
          </div>
          <AdminCard title={t('rep.tab.lowstock')} bodyClass="!p-0">
            {products.filter((p) => (p.quantity || 0) <= (p.lowStockThreshold ?? 0)).length === 0 ? (
              <div className="p-6">
                <EmptyState icon={<Award size={22} />} title={t('rep.stockHealthy')} />
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
                <table className="w-full min-w-[600px]">
                  <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                    <tr>
                      <Th>#</Th>
                      <Th>{t('prod.name')}</Th>
                      <Th>{t('prod.category')}</Th>
                      <Th className="text-right">{t('prod.qty')}</Th>
                      <Th className="text-right">{t('rep.threshold')}</Th>
                      <Th className="text-right">{t('rep.status')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {products
                      .filter((p) => (p.quantity || 0) <= (p.lowStockThreshold ?? 0))
                      .sort((a, b) => (a.quantity || 0) - (b.quantity || 0))
                      .map((p, i) => {
                        const out = (p.quantity || 0) === 0;
                        return (
                          <tr key={p.id} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                            <Td className="text-[var(--psa-faint)]">{i + 1}</Td>
                            <Td className="font-semibold text-[var(--psa-sub)]">{p.name}</Td>
                            <Td className="text-[var(--psa-muted)]">{prodCat.get(p.id) || '—'}</Td>
                            <Td className={`text-right tabular-nums font-bold ${out ? 'text-[#DC2626]' : 'text-[#B45309]'}`}>
                              {p.quantity || 0}
                            </Td>
                            <Td className="text-right tabular-nums text-[var(--psa-muted)]">{p.lowStockThreshold ?? 0}</Td>
                            <Td className="text-right">
                              <Badge tone={out ? 'red' : 'amber'}>{out ? t('rep.outOfStock') : t('rep.lowStock')}</Badge>
                            </Td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </AdminCard>
        </>
      )}

      {/* ── RECENT PURCHASES ── */}
      {tab === 'purchases' && (
        <AdminCard title={t('rep.tab.purchases')} bodyClass="!p-0">
          {(() => {
            const ins = allTxns
              .filter((x) => x.type === 'STOCK_IN')
              .sort((a, b) => (a.date === b.date ? String(b.createdAt).localeCompare(String(a.createdAt)) : b.date.localeCompare(a.date)))
              .slice(0, 50);
            if (ins.length === 0)
              return (
                <div className="p-6">
                  <EmptyState icon={<ShoppingCart size={22} />} title={t('rep.noData')} />
                </div>
              );
            return (
              <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
                <table className="w-full min-w-[620px]">
                  <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                    <tr>
                      <Th>#</Th>
                      <Th>{t('exp.date')}</Th>
                      <Th>{t('prod.name')}</Th>
                      <Th className="text-right">{t('prod.qty')}</Th>
                      <Th className="text-right">{t('prod.rate')}</Th>
                      <Th className="text-right">{t('bills.total')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ins.map((x, i) => (
                      <tr key={x.id} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                        <Td className="text-[var(--psa-faint)]">{i + 1}</Td>
                        <Td className="text-[var(--psa-muted)] whitespace-nowrap">{fmtDate(x.date)}</Td>
                        <Td className="font-semibold text-[var(--psa-sub)]">{x.product?.name || '—'}</Td>
                        <Td className="text-right tabular-nums">{x.quantity || 0}</Td>
                        <Td className="text-right tabular-nums text-[var(--psa-muted)]">{fmtMoney(x.unitPrice)}</Td>
                        <Td className="text-right tabular-nums font-semibold text-[var(--psa-sub)]">{fmtMoney(x.totalAmount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </AdminCard>
      )}

      {/* ── EXPENSE REPORT ── */}
      {tab === 'expense' && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            <StatCard icon={<Wallet size={18} />} label={t('rep.expenseTotal')} value={fmtMoney(expenseTotal)} tone="red" />
            <StatCard icon={<ReceiptText size={18} />} label={t('staff.paidCount')} value={String(expenses.length)} tone="slate" />
            <StatCard icon={<PiggyBank size={18} />} label={t('rep.totalProfit')} value={fmtMoney(salesStats.totalProfit - expenseTotal)} tone={salesStats.totalProfit - expenseTotal >= 0 ? 'green' : 'red'} />
            <StatCard icon={<TrendingUp size={18} />} label={t('rep.totalSales')} value={fmtMoney(salesStats.totalSales)} tone="orange" />
          </div>
          <div className="grid lg:grid-cols-3 gap-4 items-start">
            <AdminCard title={t('rep.byCategory')}>
              {(() => {
                const byCat = new Map<string, number>();
                for (const e of expenses) byCat.set(e.category || '—', (byCat.get(e.category || '—') || 0) + (e.amount || 0));
                const list = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
                if (!list.length) return <EmptyState icon={<Wallet size={22} />} title={t('rep.noData')} />;
                const max = Math.max(1, ...list.map(([, v]) => v));
                return (
                  <div className="space-y-3">
                    {list.map(([c, v]) => (
                      <div key={c}>
                        <div className="flex justify-between text-xs mb-1 gap-2">
                          <span className="font-medium text-[var(--psa-sub)] truncate">{c}</span>
                          <span className="text-[var(--psa-muted)] tabular-nums shrink-0">{fmtMoney(v)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-[var(--psa-soft-slate)] overflow-hidden">
                          <div className="h-full rounded-full bg-[#DC2626]" style={{ width: `${Math.max(4, (v / max) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </AdminCard>
            <AdminCard title={t('rep.detailList2')} className="lg:col-span-2" bodyClass="!p-0">
              {expenses.length === 0 ? (
                <div className="p-6">
                  <EmptyState icon={<ReceiptText size={22} />} title={t('rep.noData')} />
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[56vh] overflow-y-auto">
                  <table className="w-full min-w-[520px]">
                    <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                      <tr>
                        <Th>{t('exp.date')}</Th>
                        <Th>{t('exp.category')}</Th>
                        <Th>{t('exp.description')}</Th>
                        <Th className="text-right">{t('exp.amount')}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map((e) => (
                        <tr key={e.id} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                          <Td className="text-[var(--psa-muted)] whitespace-nowrap">{fmtDate(e.date)}</Td>
                          <Td>
                            <Badge tone="orange">{e.category || '—'}</Badge>
                          </Td>
                          <Td className="text-[var(--psa-sub)] max-w-60 truncate">{e.description || '—'}</Td>
                          <Td className="text-right tabular-nums font-semibold text-[#DC2626]">− {fmtMoney(e.amount)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </AdminCard>
          </div>
        </>
      )}

      {/* ── STAFF PAYMENT REPORT ── */}
      {tab === 'staff' && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            <StatCard icon={<Wallet size={18} />} label={t('staff.total')} value={fmtMoney(staffPayments.reduce((s, p) => s + (p.amount || 0), 0))} tone="red" />
            <StatCard icon={<UserCog size={18} />} label={t('staff.staffCount')} value={String(new Set(staffPayments.map((p) => p.staffName)).size)} tone="slate" />
            <StatCard icon={<ReceiptText size={18} />} label={t('staff.paidCount')} value={String(staffPayments.length)} tone="amber" />
            <StatCard icon={<PiggyBank size={18} />} label={t('rep.totalProfit')} value={fmtMoney(salesStats.totalProfit - expenseTotal)} tone={salesStats.totalProfit - expenseTotal >= 0 ? 'green' : 'red'} />
          </div>
          <AdminCard title={t('rep.detailList2')} bodyClass="!p-0">
            {staffPayments.length === 0 ? (
              <div className="p-6">
                <EmptyState icon={<UserCog size={22} />} title={t('rep.noData')} />
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
                <table className="w-full min-w-[560px]">
                  <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                    <tr>
                      <Th>{t('exp.date')}</Th>
                      <Th>{t('staff.name')}</Th>
                      <Th>{t('staff.kind')}</Th>
                      <Th>{t('exp.description')}</Th>
                      <Th className="text-right">{t('exp.amount')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffPayments.map((p) => (
                      <tr key={p.id} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                        <Td className="text-[var(--psa-muted)] whitespace-nowrap">{fmtDate(p.date)}</Td>
                        <Td className="font-semibold text-[var(--psa-sub)]">{p.staffName}</Td>
                        <Td>
                          <Badge tone="slate">{t(`staff.kind.${p.kind}`)}</Badge>
                        </Td>
                        <Td className="text-[var(--psa-muted)] max-w-60 truncate">{p.note || '—'}</Td>
                        <Td className="text-right tabular-nums font-semibold text-[#DC2626]">− {fmtMoney(p.amount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AdminCard>
        </>
      )}
    </div>
  );
}
