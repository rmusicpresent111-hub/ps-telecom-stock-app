'use client';

/**
 * ThermalPrintModal — desktop chooser for the admin panel's thermal printing
 * (v2.32.0). Offers the two web paths side by side:
 *   • USB Direct (Web Serial) — raw ESC/POS, no driver (Chrome/Edge)
 *   • Print Dialog — thermal-styled page through the OS driver (works for
 *     Bluetooth-paired Hoin printers + driver-installed USB printers)
 * Also carries the 58/80 mm paper-width toggle so the desktop is fully
 * self-sufficient (persists into the SAME synced billingSettings row the APK
 * uses — no new storage, no schema change).
 */

import { useState } from 'react';
import { Usb, Printer, Loader2, AlertTriangle } from 'lucide-react';
import { BillingSettings, Bill } from '@/lib/types';
import { saveBillingSettingsOffline } from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import { Modal, Btn, adminToast } from './admin-ui';
import {
  isWebSerialSupported,
  isSerialPickerCancelled,
  printThermalViaSerial,
  printThermalViaDialog,
} from './thermal-web';

interface Props {
  bill: Bill | null;
  settings: BillingSettings | null;
  onClose: () => void;
  /** Called after the paper width is saved so the parent refreshes its copy. */
  onSettingsChanged?: (s: BillingSettings) => void;
}

export default function ThermalPrintModal({ bill, settings, onClose, onSettingsChanged }: Props) {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const [busy, setBusy] = useState<'serial' | 'dialog' | 'width' | null>(null);
  const serialOk = isWebSerialSupported();
  const widthMm = settings?.thermalWidthMm === 80 ? 80 : 58;

  if (!bill) return null;

  const doSerial = async () => {
    setBusy('serial');
    try {
      await printThermalViaSerial(bill, settings);
      adminToast(t('bills.thermalPrinted'));
      onClose();
    } catch (err) {
      if (isSerialPickerCancelled(err)) {
        adminToast(t('bills.thermalCancelled'));
      } else {
        adminToast(`${t('bills.thermalFailed')}: ${(err as Error)?.message || 'error'}`, 'err');
      }
    } finally {
      setBusy(null);
    }
  };

  const doDialog = () => {
    setBusy('dialog');
    try {
      printThermalViaDialog(bill, settings);
      // window.print() inside is async-ish; close after the iframe fires it
      window.setTimeout(() => {
        setBusy(null);
        onClose();
      }, 800);
    } catch (err) {
      adminToast(`${t('bills.thermalFailed')}: ${(err as Error)?.message || 'error'}`, 'err');
      setBusy(null);
    }
  };

  const setWidth = async (w: 58 | 80) => {
    if (busy) return;
    setBusy('width');
    try {
      const saved = await saveBillingSettingsOffline(DEFAULT_USER_ID, { thermalWidthMm: w });
      onSettingsChanged?.(saved);
    } catch {
      adminToast(t('c.error'), 'err');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open onClose={onClose} title={t('bills.thermalTitle')}>
      <div className="space-y-3">
        {/* paper width */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-[var(--psa-muted)]">{t('bills.thermalWidth')}:</span>
          {[58, 80].map((w) => (
            <button
              key={w}
              type="button"
              disabled={!!busy}
              onClick={() => void setWidth(w as 58 | 80)}
              aria-pressed={widthMm === w}
              className={`h-7 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                widthMm === w
                  ? 'bg-[var(--psa-accent,#F97316)] text-white'
                  : 'bg-[var(--psa-hover)] text-[var(--psa-muted)] hover:bg-[var(--psa-hover2)]'
              }`}
            >
              {w} mm
            </button>
          ))}
          {busy === 'width' && <Loader2 size={13} className="animate-spin text-[var(--psa-faint)]" />}
        </div>

        {/* option 1 — USB direct */}
        <button
          type="button"
          onClick={doSerial}
          disabled={!serialOk || !!busy}
          className="w-full text-left rounded-xl border border-[var(--psa-border)] p-4 flex gap-3 items-start hover:bg-[var(--psa-hover)] transition-colors disabled:opacity-55 disabled:cursor-not-allowed"
        >
          <span className="w-9 h-9 shrink-0 rounded-lg bg-[var(--psa-soft-green,#DCFCE7)] flex items-center justify-center">
            {busy === 'serial' ? <Loader2 size={17} className="animate-spin text-green-600" /> : <Usb size={17} className="text-green-600" />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{t('bills.thermalUsb')}</span>
            <span className="block text-[11px] text-[var(--psa-muted)] mt-0.5">{t('bills.thermalUsbDesc')}</span>
            {!serialOk && (
              <span className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-600">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {t('bills.thermalSerialUnsupported')}
              </span>
            )}
          </span>
        </button>

        {/* option 2 — system print dialog */}
        <button
          type="button"
          onClick={doDialog}
          disabled={!!busy}
          className="w-full text-left rounded-xl border border-[var(--psa-border)] p-4 flex gap-3 items-start hover:bg-[var(--psa-hover)] transition-colors disabled:opacity-55"
        >
          <span className="w-9 h-9 shrink-0 rounded-lg bg-[var(--psa-soft-blue,#DBEAFE)] flex items-center justify-center">
            {busy === 'dialog' ? <Loader2 size={17} className="animate-spin text-blue-600" /> : <Printer size={17} className="text-blue-600" />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{t('bills.thermalDialog')}</span>
            <span className="block text-[11px] text-[var(--psa-muted)] mt-0.5">{t('bills.thermalDialogDesc')}</span>
          </span>
        </button>
      </div>
    </Modal>
  );
}
