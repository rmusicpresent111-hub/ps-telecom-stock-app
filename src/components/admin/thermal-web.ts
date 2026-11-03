/**
 * thermal-web — DESKTOP thermal printing bridge for the admin panel (v2.32.0).
 *
 * Two paths, both fed by the SAME line model as the APK's Bluetooth ESC/POS
 * (src/lib/thermal-print.ts buildReceiptLines) so every surface prints the
 * identical receipt:
 *
 *  1. USB DIRECT — Web Serial API (Chrome/Edge on desktop). Raw ESC/POS bytes
 *     straight into the printer: no driver, no dialog. The receipt prints
 *     exactly like it does over Bluetooth in the APK. The port is remembered
 *     in-session; the second print skips the picker.
 *
 *  2. PRINT DIALOG — a narrow thermal-styled HTML page through the system
 *     print dialog (hidden iframe + window.print, same engine as the A4
 *     invoice). Works for printers the OS already knows: a Hoin paired over
 *     Bluetooth, or a USB printer with its vendor driver installed — pick the
 *     printer in the dialog and the driver rasterises the receipt at the
 *     chosen 58mm/80mm width.
 *
 * NOTHING here touches the database, sync or bills — pure print plumbing.
 */

import { Bill, BillingSettings } from '@/lib/types';
import { buildEscPosReceipt, buildReceiptLines } from '@/lib/thermal-print';
import { printHtml } from './print';

// ============ 1) USB DIRECT (Web Serial API) ============

/* Minimal Web Serial typings — avoids adding @types/w3c-web-serial for two
   members; the cast keeps Firefox/Safari (no navigator.serial) type-safe. */
interface MinimalSerialPort {
  open(options: {
    baudRate: number;
    dataBits?: 7 | 8;
    stopBits?: 1 | 2;
    parity?: 'none' | 'even' | 'odd';
    flowControl?: 'none' | 'hardware';
  }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
}
interface MinimalSerial {
  requestPort(options?: {
    filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
  }): Promise<MinimalSerialPort>;
  getPorts(): Promise<MinimalSerialPort[]>;
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/** Port granted earlier this session — second print skips the picker. */
let cachedPort: MinimalSerialPort | null = null;

/** True when the user dismissed Chrome's port chooser (no error toast). */
export function isSerialPickerCancelled(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotFoundError';
}

/**
 * Open a (remembered or newly-picked) serial port and push the ESC/POS bytes.
 * Baud 115200 8N1 — the common Hoin/default thermal setting; USB-CDC printers
 * ignore it entirely, UART-bridge models accept it.
 */
export async function printThermalViaSerial(bill: Bill, settings: BillingSettings | null): Promise<void> {
  if (!isWebSerialSupported()) throw new Error('serial-unsupported');
  const serial = (navigator as Navigator & { serial: MinimalSerial }).serial;
  const bytes = buildEscPosReceipt(bill, settings);

  const attempt = async (port: MinimalSerialPort) => {
    await port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    try {
      const writer = (port.writable as WritableStream<Uint8Array>).getWriter();
      try {
        await writer.write(bytes);
        // give the printer a beat to drain its buffer before closing
        await new Promise((r) => setTimeout(r, 400));
      } finally {
        try { writer.releaseLock(); } catch { /* stream already errored */ }
      }
    } finally {
      try { await port.close(); } catch { /* already gone */ }
    }
  };

  let port = cachedPort;
  let fromPicker = false;
  if (!port) {
    // Previously-granted ports (this session or a prior "allow" with the same
    // origin) can be reused silently — no chooser prompt.
    const granted = await serial.getPorts();
    port = granted[0] || null;
    if (!port) {
      fromPicker = true;
      port = await serial.requestPort(); // user-cancel → NotFoundError propagates (no re-ask)
    }
  }

  try {
    await attempt(port);
    cachedPort = port;
  } catch (err) {
    if (!fromPicker && isSerialPickerCancelled(err)) {
      // The remembered/granted port is stale (printer off/unplugged) →
      // one clean retry through a fresh chooser.
      port = await serial.requestPort();
      await attempt(port);
      cachedPort = port;
      return;
    }
    cachedPort = null;
    throw err;
  }
}

// ============ 2) PRINT DIALOG (thermal-styled HTML) ============

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Self-contained narrow receipt HTML — the same lines the ESC/POS printer
 * receives, rendered in a monospace block at the chosen paper width.
 */
export function buildThermalHtml(bill: Bill, settings: BillingSettings | null): string {
  const widthMm = settings?.thermalWidthMm === 80 ? 80 : 58;
  const inner = (widthMm - 8).toFixed(0); // @page margin 4mm each side
  const body = buildReceiptLines(bill, settings)
    .map((l) => {
      const cls = l.big ? ' class="big"' : '';
      const style = l.center ? ' style="text-align:center"' : '';
      return `<div${cls}${style}>${escHtml(l.text) || '&nbsp;'}</div>`;
    })
    .join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escHtml(bill.billNumber || 'receipt')}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 4mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: 'Courier New', ui-monospace, Menlo, monospace;
    font-size: 10pt; line-height: 1.4; color: #000;
    width: ${inner}mm; word-break: break-all;
  }
  .big { font-size: 13.5pt; font-weight: 700; }
  div { white-space: pre-wrap; }
</style></head><body>
${body}
</body></html>`;
}

/** Open the system print dialog with the thermal-sized receipt. */
export function printThermalViaDialog(bill: Bill, settings: BillingSettings | null): void {
  printHtml(buildThermalHtml(bill, settings));
}

// ============ test bill (Bill Settings "Test Print") ============

/** A small demo bill to verify the printer without touching real data. */
export function makeThermalTestBill(settings: BillingSettings | null): Bill {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const nowIso = now.toISOString();
  return {
    id: 'thermal-test-print',
    userId: 'local-owner',
    billNumber: 'TEST-PRINT',
    customerName: 'Test Customer',
    customerMobile: '9999999999',
    items: [
      { productId: 'tp-1', name: 'Test Item One', categoryName: 'Demo', quantity: 1, unitPrice: 250, total: 250, serialNumbers: [] },
      { productId: 'tp-2', name: 'Test Item Two (Long Name Check)', quantity: 2, unitPrice: 125, total: 250 },
    ],
    subtotal: 500,
    discountValue: 0,
    discountType: 'amount',
    discountAmount: 0,
    gstEnabled: false,
    gstRate: 0,
    gstAmount: 0,
    total: 500,
    paymentMethod: 'cash',
    paidAmount: 500,
    dueAmount: 0,
    note: 'Printer test',
    transactionId: 'thermal-test-print',
    shopSnapshot: {
      name: settings?.shopName || 'PS TELECOM',
      address: settings?.shopAddress || '',
      phone: settings?.shopPhone || '',
      gstNumber: settings?.gstNumber || '',
      proprietorName: settings?.proprietorName || '',
    },
    date: `${now.getFullYear()}-${mm}-${dd}`,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
