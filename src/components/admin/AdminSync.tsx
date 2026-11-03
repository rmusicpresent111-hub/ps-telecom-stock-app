'use client';

/**
 * Admin Sync & Settings — mirrors the SAME encrypted Cloudflare D1 sync the
 * mobile app uses. v2.19.0: the connect (Sync ID + PIN) form is GONE — the
 * engine auto-connects from environment credentials at boot (d1-sync.ts);
 * this tab shows live status, CSV export and a full JSON backup.
 */

import { useEffect, useState } from 'react';
import {
  CloudCheck,
  RefreshCw,
  FileSpreadsheet,
  ShieldCheck,
  Download,
} from 'lucide-react';
import {
  getD1SyncStatus,
  subscribeD1Status,
  syncNowD1,
} from '@/lib/d1-sync';
import { getSyncAccount, isStaticWebHost } from '@/lib/d1-config';
import {
  getProductsOffline,
  getBillsOffline,
  exportBackupOffline,
  localDateStr,
} from '@/lib/offline-service';
import { DEFAULT_USER_ID, getLocalUser } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import { csvEscape, downloadBlob } from './csv'; // v2.33.0: shared CSV helpers (were local copies)
import {
  AdminCard,
  Badge,
  Btn,
  PageHeader,
  adminToast,
  fmtDateTime,
} from './admin-ui';

export default function AdminSync() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [status, setStatusState] = useState(getD1SyncStatus());
  const [account, setAccountState] = useState(getSyncAccount());
  const [shopName, setShopName] = useState('');

  const staticHost = typeof window !== 'undefined' ? isStaticWebHost() : false;

  useEffect(() => {
    const off = subscribeD1Status(setStatusState);
    return off;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const user = await getLocalUser(DEFAULT_USER_ID);
      if (!alive) return;
      if (user?.shopName) setShopName(user.shopName);
      const acct = getSyncAccount();
      if (acct) setAccountState(acct);
    })();
    return () => {
      alive = false;
    };
  }, [tick, status.state]);

  const doSyncNow = async () => {
    const res = await syncNowD1(DEFAULT_USER_ID);
    adminToast(res.ok ? t('sync.connected') : t('sync.errOffline'), res.ok ? 'ok' : 'err');
  };

  const exportProductsCsv = async () => {
    const [{ getCategoriesOffline }, products] = await Promise.all([
      import('@/lib/offline-service'),
      getProductsOffline(DEFAULT_USER_ID),
    ]);
    const catList = await getCategoriesOffline(DEFAULT_USER_ID);
    const catNames = new Map(catList.map((c) => [c.id, c.name]));
    let csv = '\uFEFF';
    csv += 'Name,Category,Quantity,Box,Purchase Price,Selling Price,Low Stock Alert,Value\n';
    for (const p of products) {
      csv += [
        csvEscape(p.name),
        csvEscape(catNames.get(p.categoryId) || ''),
        p.quantity,
        csvEscape(p.boxNumber),
        p.purchasePrice,
        p.sellingPrice,
        p.lowStockThreshold,
        (p.quantity * p.purchasePrice).toFixed(2),
      ].join(',') + '\n';
    }
    downloadBlob(csv, `ps-admin-products-${localDateStr()}.csv`, 'text/csv;charset=utf-8');
    adminToast(t('sync.csvDone'));
  };

  const exportBillsCsv = async () => {
    const bills = await getBillsOffline(DEFAULT_USER_ID);
    let csv = '\uFEFF';
    csv += 'Bill No,Date,Customer,Mobile,Items,Subtotal,Discount,GST,Total,Paid,Due,Payment\n';
    for (const b of bills) {
      csv += [
        csvEscape(b.billNumber),
        b.date,
        csvEscape(b.customerName),
        csvEscape(b.customerMobile),
        csvEscape(b.items.map((i) => `${i.name} x${i.quantity}`).join('; ')),
        b.subtotal.toFixed(2),
        b.discountAmount.toFixed(2),
        b.gstAmount.toFixed(2),
        b.total.toFixed(2),
        b.paidAmount.toFixed(2),
        b.dueAmount.toFixed(2),
        b.paymentMethod,
      ].join(',') + '\n';
    }
    downloadBlob(csv, `ps-admin-bills-${localDateStr()}.csv`, 'text/csv;charset=utf-8');
    adminToast(t('sync.csvDone'));
  };

  const exportJson = async () => {
    const data = await exportBackupOffline(DEFAULT_USER_ID);
    downloadBlob(
      JSON.stringify(data, null, 2),
      `ps-admin-backup-${localDateStr()}.json`,
      'application/json'
    );
    adminToast(t('c.saved'));
  };

  const stateBadge = () => {
    if (!account) return <Badge tone="slate">{t('sync.off')}</Badge>;
    switch (status.state) {
      case 'syncing':
        return <Badge tone="orange">{t('sync.syncing')}</Badge>;
      case 'error':
        return <Badge tone="red">{t('sync.error')}</Badge>;
      case 'offline':
        return <Badge tone="amber">{t('sync.offline')}</Badge>;
      default:
        return <Badge tone="green">{t('sync.connected')}</Badge>;
    }
  };

  return (
    <div>
      <PageHeader title={t('sync.title')} />

      {staticHost && (
        <div className="mb-4 flex items-start gap-3 bg-[var(--psa-soft-amber)] border border-[var(--psa-amber-line)] rounded-xl p-4">
          <ShieldCheck size={18} className="text-[#D97706] shrink-0 mt-0.5" />
          <p className="text-sm text-[var(--psa-amber-ink)]">{t('sync.errStatic')}</p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* connection status */}
        <AdminCard
          title={
            <span className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-[#16A34A]" />
              {t('sync.status')}
            </span>
          }
        >
          {account ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 bg-[var(--psa-soft-green)] border border-[var(--psa-green-line)] rounded-xl p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <CloudCheck size={26} className="text-[#16A34A] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--psa-green-ink)]">{account.syncId}</p>
                    <p className="text-[11px] text-[#15803D]/80">
                      {t('sync.lastSync')}: {status.lastSyncAt ? `${relative(status.lastSyncAt)} ${t('c.of')} ${fmtDateTime(new Date(status.lastSyncAt).toISOString())}` : t('sync.never')}
                    </p>
                  </div>
                </div>
                {stateBadge()}
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn variant="primary" onClick={doSyncNow} disabled={status.state === 'syncing'}>
                  <RefreshCw size={15} className={status.state === 'syncing' ? 'animate-spin' : ''} /> {t('sync.syncNow')}
                </Btn>
              </div>
              <p className="text-[11px] text-[var(--psa-faint)] leading-relaxed">{t('sync.autoNote')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* v2.19.0: no connect form — the engine auto-connects from env */}
              <div className="flex items-center justify-between gap-3 bg-[var(--psa-soft-red)] border border-[var(--psa-red-line,var(--psa-field-border))] rounded-xl p-4">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#DC2626]">{t('sync.off')}</p>
                  <p className="text-[11px] text-[var(--psa-sub)] mt-0.5">{t('sync.sameDb')}</p>
                </div>
                {stateBadge()}
              </div>
              {status.state === 'error' && status.lastError && (
                <p className="text-[11px] text-[var(--psa-amber-ink)] bg-[var(--psa-soft-amber)] rounded-lg p-2.5 break-words">
                  {status.lastError}
                </p>
              )}
              <p className="text-[11px] text-[var(--psa-faint)] leading-relaxed">{t('sync.autoNote')}</p>
            </div>
          )}
        </AdminCard>

        {/* shop + export */}
        <AdminCard
          title={
            <span className="flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-[#E8552C]" />
              {t('sync.exportCsv')}
            </span>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 bg-[var(--psa-soft-orange)] rounded-xl p-4">
              <div>
                <p className="text-[11px] text-[var(--psa-faint)] font-semibold uppercase">{t('sync.shop')}</p>
                <p className="text-base font-bold text-[var(--psa-ink)]">{shopName || 'PS TELECOM'}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-[#FA6E41] text-white flex items-center justify-center font-bold text-lg">
                {(shopName || 'PS').charAt(0)}
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-2">
              <Btn variant="outline" onClick={exportProductsCsv}>
                <Download size={15} /> {t('sync.csvProducts')}
              </Btn>
              <Btn variant="outline" onClick={exportBillsCsv}>
                <Download size={15} /> {t('sync.csvBills')}
              </Btn>
              <Btn variant="outline" onClick={exportJson}>
                <Download size={15} /> JSON
              </Btn>
            </div>
            <p className="text-[11px] text-[var(--psa-faint)] leading-relaxed">
              Excel / Google Sheets–ready · UTF-8 (বাংলা ঠিকভাবে দেখাবে) · {t('sync.sameDb')}
            </p>
          </div>
        </AdminCard>
      </div>
    </div>
  );
}

function relative(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return '<1m';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
