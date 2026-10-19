'use client';

/**
 * Admin Party Details — every customer you sell to, saved AUTOMATICALLY.
 *
 * The party book is DERIVED from bills (no extra bookkeeping): on every sale
 * the bill already carries customer name/mobile + items, so parties appear,
 * update and grow their date-wise purchase history by themselves.
 * Per party: name, mobile, which categories they buy from (joined through
 * the product list), and the full purchase history date-wise with totals.
 */

import { useEffect, useMemo, useState } from 'react';
import { Users, Phone, MessageCircle, Printer, CalendarDays, ShoppingBag, IndianRupee, Wallet, Search } from 'lucide-react';
import {
  getBillsOffline,
  getProductsOffline,
  getCategoriesOffline,
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
  Modal,
  PageHeader,
  StatCard,
  adminToast,
  fmtMoney,
  fmtDate,
} from './admin-ui';
import type { Bill, Product, Category } from '@/lib/types';

interface PartyBillRow {
  bill: Bill;
  categories: string[]; // resolved category names for the items in this bill
}

interface Party {
  key: string;
  name: string;
  mobile: string;
  bills: PartyBillRow[];
  categories: string[];
  totalSpent: number;
  totalDue: number;
  lastDate: string;
  firstDate: string;
}

/** Mobile first (one person = one number); fall back to the name itself. */
function partyKey(name: string, mobile: string): string {
  const m = (mobile || '').replace(/\D/g, '');
  if (m.length >= 6) return `m:${m}`;
  const n = (name || '').trim();
  return n ? `n:${n.toLowerCase()}` : '';
}

function buildParties(bills: Bill[], products: Product[], categories: Category[]): Party[] {
  const catNameById = new Map(categories.map((c) => [c.id, c.name]));
  const prodCatById = new Map(products.map((p) => [p.id, catNameById.get(p.categoryId) || '']));

  const map = new Map<string, Party>();
  const sorted = [...bills].sort((a, b) =>
    a.date === b.date ? String(a.createdAt).localeCompare(String(b.createdAt)) : a.date.localeCompare(b.date)
  );

  for (const bill of sorted) {
    const name = (bill.customerName || '').trim();
    const mobile = (bill.customerMobile || '').trim();
    const key = partyKey(name, mobile);
    if (!key) continue; // no customer info at all → not a party

    const catSet = new Set<string>();
    for (const it of bill.items || []) {
      const c = prodCatById.get(it.productId);
      if (c) catSet.add(c);
    }

    const existing = map.get(key);
    const p: Party =
      existing ||
      {
        key,
        name: name || mobile,
        mobile,
        bills: [],
        categories: [],
        totalSpent: 0,
        totalDue: 0,
        lastDate: bill.date,
        firstDate: bill.date,
      };
    if (!existing) map.set(key, p);
    // Prefer the non-empty name if an earlier bill had none
    if (!p.name && name) p.name = name;
    if (!p.mobile && mobile) p.mobile = mobile;

    p.bills.push({ bill, categories: [...catSet] });
    for (const c of catSet) p.categories.push(c);
    p.totalSpent += bill.total || 0;
    p.totalDue += bill.dueAmount || 0;
    if (bill.date > p.lastDate) p.lastDate = bill.date;
    if (bill.date < p.firstDate) p.firstDate = bill.date;
  }

  for (const p of map.values()) {
    p.categories = [...new Set(p.categories)].filter(Boolean).sort((a, b) => a.localeCompare(b));
    p.bills.reverse(); // newest first
  }

  return [...map.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

export default function AdminParties() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [parties, setParties] = useState<Party[]>([]);
  const [search, setSearch] = useState('');
  // The open dialog is DERIVED from the live list — when bills refresh
  // (mark-paid, new sales), the open party updates without an effect.
  const [openPartyKey, setOpenPartyKey] = useState<string | null>(null);
  const openParty = openPartyKey ? parties.find((p) => p.key === openPartyKey) || null : null;

  useEffect(() => {
    let alive = true;
    (async () => {
      const [bills, products, categories] = await Promise.all([
        getBillsOffline(DEFAULT_USER_ID),
        getProductsOffline(DEFAULT_USER_ID),
        getCategoriesOffline(DEFAULT_USER_ID),
      ]);
      if (!alive) return;
      setParties(buildParties(bills, products, categories));
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter(
      (p) => p.name.toLowerCase().includes(q) || p.mobile.includes(q) || p.categories.some((c) => c.toLowerCase().includes(q))
    );
  }, [parties, search]);

  const totalSpent = useMemo(() => parties.reduce((s, p) => s + p.totalSpent, 0), [parties]);
  const totalDue = useMemo(() => parties.reduce((s, p) => s + p.totalDue, 0), [parties]);

  const openWhats = (party: Party) => {
    const phone = (party.mobile || '').replace(/\D/g, '');
    if (phone.length < 10) {
      adminToast(t('parties.noMobile'), 'err');
      return;
    }
    window.open(`https://wa.me/${phone.length === 10 ? '91' : ''}${phone}`, '_blank');
  };

  const printPartyStatement = (party: Party) => {
    const historyRows = party.bills.flatMap(({ bill, categories }) => [
      [
        fmtDate(bill.date),
        escHtml(bill.billNumber || '—'),
        escHtml((bill.items || []).map((i) => `${i.name} ×${i.quantity}`).join(', ')),
        escHtml(categories.length ? categories.join(', ') : '—'),
        fmtMoney(bill.total || 0),
        fmtMoney(bill.paidAmount || 0),
        fmtMoney(bill.dueAmount || 0),
      ],
    ]);
    void printGenericReport({
      title: t('parties.statementTitle'),
      periodLabel: `${fmtDate(party.firstDate)} → ${fmtDate(party.lastDate)}`,
      lang,
      chips: [
        { k: t('parties.party'), v: party.name },
        { k: t('parties.mobile'), v: party.mobile || '—' },
        { k: t('parties.bills'), v: String(party.bills.length) },
        { k: t('parties.totalSpent'), v: fmtMoney(party.totalSpent) },
        { k: t('parties.totalDue'), v: fmtMoney(party.totalDue) },
      ],
      tables: [
        {
          sectionTitle: t('parties.historyTitle'),
          columns: [
            { label: t('exp.date') },
            { label: t('bills.billNo') },
            { label: t('prod.name') },
            { label: t('parties.categories') },
            { label: t('bills.total'), right: true },
            { label: t('print.totalPaid'), right: true },
            { label: t('print.totalDue'), right: true },
          ],
          rows: historyRows,
          totalRow: [
            t('bills.grandTotal'),
            '',
            '',
            '',
            fmtMoney(party.totalSpent),
            fmtMoney(party.totalSpent - party.totalDue),
            fmtMoney(party.totalDue),
          ],
        },
      ],
    });
  };

  return (
    <div>
      <PageHeader title={t('parties.title')} sub={t('parties.sub')} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard icon={<Users size={18} />} label={t('parties.partyCount')} value={String(parties.length)} tone="orange" />
        <StatCard icon={<IndianRupee size={18} />} label={t('parties.totalSpent')} value={fmtMoney(totalSpent)} tone="green" />
        <StatCard icon={<Wallet size={18} />} label={t('parties.totalDue')} value={fmtMoney(totalDue)} tone={totalDue > 0 ? 'red' : 'green'} />
        <StatCard icon={<ShoppingBag size={18} />} label={t('parties.billsTotal')} value={String(parties.reduce((s, p) => s + p.bills.length, 0))} tone="slate" />
      </div>

      <AdminCard className="mb-4" bodyClass="!p-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--psa-faint)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('parties.search')}
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-[var(--psa-field-border)] bg-[var(--psa-field)] text-sm text-[var(--psa-ink)] outline-none focus:border-[#FA6E41]"
          />
        </div>
      </AdminCard>

      {filtered.length === 0 ? (
        <AdminCard>
          <EmptyState
            icon={<Users size={22} />}
            title={parties.length === 0 ? t('parties.none') : t('parties.noMatch')}
          />
        </AdminCard>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setOpenPartyKey(p.key)}
              className="text-left rounded-xl border border-[var(--psa-border)] bg-[var(--psa-card)] p-4 hover:border-[#FA6E41]/60 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--psa-ink)] truncate">{p.name}</p>
                  <p className="text-xs text-[var(--psa-muted)] tabular-nums">{p.mobile || '—'}</p>
                </div>
                {p.totalDue > 0 ? (
                  <Badge tone="red">{t('parties.dueBadge')}: {fmtMoney(p.totalDue)}</Badge>
                ) : (
                  <Badge tone="green">{t('parties.clearBadge')}</Badge>
                )}
              </div>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-[var(--psa-muted)]">
                  {p.bills.length} {t('parties.billsUnit')} · {t('parties.last')} {fmtDate(p.lastDate)}
                </span>
                <span className="font-bold text-[var(--psa-sub)] tabular-nums">{fmtMoney(p.totalSpent)}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {p.categories.slice(0, 3).map((c) => (
                  <Badge key={c} tone="slate">{c}</Badge>
                ))}
                {p.categories.length > 3 && <Badge tone="slate">+{p.categories.length - 3}</Badge>}
                {p.categories.length === 0 && <span className="text-[11px] text-[var(--psa-faint)]">—</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* party detail */}
      <Modal
        open={!!openParty}
        onClose={() => setOpenPartyKey(null)}
        wide
        title={openParty ? `${openParty.name}${openParty.mobile ? ` · ${openParty.mobile}` : ''}` : ''}
        footer={
          <>
            <Btn variant="outline" onClick={() => openParty && openWhats(openParty)}>
              <MessageCircle size={15} /> <span className="hidden sm:inline">{t('parties.whatsapp')}</span>
            </Btn>
            <Btn
              variant="outline"
              onClick={() => {
                if (!openParty) return;
                const phone = (openParty.mobile || '').replace(/\D/g, '');
                if (phone.length < 10) {
                  adminToast(t('parties.noMobile'), 'err');
                  return;
                }
                window.open(`tel:${phone}`);
              }}
            >
              <Phone size={15} /> <span className="hidden sm:inline">{t('parties.call')}</span>
            </Btn>
            <Btn onClick={() => openParty && printPartyStatement(openParty)}>
              <Printer size={15} /> {t('parties.printStatement')}
            </Btn>
          </>
        }
      >
        {openParty && (
          <div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="rounded-lg bg-[var(--psa-hover)] p-2.5 text-center">
                <p className="text-[10px] font-semibold text-[var(--psa-faint)] uppercase tracking-wide">{t('parties.bills')}</p>
                <p className="text-base font-black text-[var(--psa-ink)]">{openParty.bills.length}</p>
              </div>
              <div className="rounded-lg bg-[var(--psa-hover)] p-2.5 text-center">
                <p className="text-[10px] font-semibold text-[var(--psa-faint)] uppercase tracking-wide">{t('parties.totalSpent')}</p>
                <p className="text-base font-black text-[#16A34A]">{fmtMoney(openParty.totalSpent)}</p>
              </div>
              <div className="rounded-lg bg-[var(--psa-hover)] p-2.5 text-center">
                <p className="text-[10px] font-semibold text-[var(--psa-faint)] uppercase tracking-wide">{t('parties.totalDue')}</p>
                <p className={`text-base font-black ${openParty.totalDue > 0 ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>
                  {fmtMoney(openParty.totalDue)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              <span className="text-[11px] font-semibold text-[var(--psa-muted)]">{t('parties.categories')}:</span>
              {openParty.categories.length ? (
                openParty.categories.map((c) => (
                  <Badge key={c} tone="orange">{c}</Badge>
                ))
              ) : (
                <span className="text-[11px] text-[var(--psa-faint)]">—</span>
              )}
            </div>

            <p className="text-xs font-bold text-[var(--psa-muted)] mb-2 flex items-center gap-1.5">
              <CalendarDays size={13} /> {t('parties.historyTitle')}
            </p>
            <div className="space-y-2.5 max-h-[46vh] overflow-y-auto pr-1">
              {openParty.bills.map(({ bill, categories }) => (
                <div key={bill.id} className="rounded-lg border border-[var(--psa-field-border)] overflow-hidden">
                  <div className="flex items-center justify-between gap-2 bg-[var(--psa-hover)] px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[var(--psa-sub)] truncate">
                        {fmtDate(bill.date)} · {bill.billNumber || '—'}
                      </p>
                      <p className="text-[10px] text-[var(--psa-faint)] truncate">
                        {categories.length ? categories.join(', ') : '—'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-black text-[var(--psa-ink)] tabular-nums">{fmtMoney(bill.total || 0)}</p>
                      {(bill.dueAmount || 0) > 0 ? (
                        <p className="text-[10px] font-semibold text-[#DC2626]">{t('parties.dueBadge')}: {fmtMoney(bill.dueAmount)}</p>
                      ) : (
                        <p className="text-[10px] font-semibold text-[#16A34A]">{t('parties.paidBadge')}</p>
                      )}
                    </div>
                  </div>
                  <div className="px-3 py-2 space-y-1">
                    {(bill.items || []).map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-[var(--psa-sub)] truncate">
                          {it.name} <span className="text-[var(--psa-faint)]">×{it.quantity}</span>
                        </span>
                        <span className="text-[var(--psa-muted)] tabular-nums shrink-0">{fmtMoney(it.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
