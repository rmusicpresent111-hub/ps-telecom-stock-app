/**
 * Thermal (ESC/POS) receipt generation + Bluetooth printing bridge (v2.31.0).
 *
 * The bytes are built 100% on-device from the bill data — no cloud, no
 * server, nothing touches the database. Output is plain ESC/POS text that
 * every cheap 58mm/80mm Bluetooth thermal printer understands:
 *
 *   ESC @        initialise
 *   ESC a n      alignment (0 left / 1 center)
 *   ESC ! n      font (0x00 normal, 0x30 double-height+width for TOTAL)
 *   ESC d n      feed n lines
 *
 * TEXT SAFETY: thermal printer fonts are ASCII/latin only. Every string is
 * sanitised (₹→Rs., ×→x, dashes, then non-ASCII dropped) so the receipt
 * NEVER prints garbage — Bengali/Hindi labels render as clean English.
 *
 * BLUETOOTH: printing goes through the local native plugin
 * (native/android/BluetoothPrinter.java → installed by scripts/build-apk.js).
 * On web builds the plugin is absent → callers show the "APK only" hint.
 * Nothing here requires any permission beyond the OS Bluetooth dialog.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { Bill, BillingSettings } from './types';

// ============ BluetoothPrinter native plugin bridge ============

export interface BtDevice {
  name: string;
  address: string;
}

interface BluetoothPrinterPlugin {
  listPaired(): Promise<{ devices: BtDevice[]; enabled: boolean }>;
  print(options: { address: string; dataBase64: string }): Promise<{ ok: boolean; error?: string }>;
}

const BluetoothPrinter = registerPlugin<BluetoothPrinterPlugin>('BluetoothPrinter');

export const isNativeApp = () => Capacitor.isNativePlatform();

export async function listPairedPrinters(): Promise<BtDevice[]> {
  const res = await BluetoothPrinter.listPaired();
  // The native side resolves (never rejects) with structured codes.
  const r = res as unknown as { devices?: BtDevice[]; enabled?: boolean; ok?: boolean; error?: string };
  if (r && r.ok === false && r.error === 'permission-denied') {
    throw new Error('permission-denied');
  }
  return Array.isArray(r?.devices) ? r.devices : [];
}

export async function printEscPosOverBluetooth(address: string, bytes: Uint8Array): Promise<void> {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const dataBase64 = btoa(binary);
  const res = await BluetoothPrinter.print({ address, dataBase64 });
  if (!res?.ok) throw new Error(res?.error || 'print-error');
}

// ============ paper geometry ============

export const THERMAL_WIDTHS = [58, 80] as const;

export function thermalColumns(widthMm: number): number {
  // 58mm roll ≈ 32 printable columns on the built-in font A;
  // 80mm roll ≈ 48 columns. (Both are the safe-common denominators.)
  return widthMm === 80 ? 48 : 32;
}

// ============ ASCII safety ============

function asciiLine(s: string): string {
  return s
    .replace(/₹\s?/g, 'Rs.')
    .replace(/[×✕]/g, 'x')
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    // drop anything the printer font cannot show (Bengali/Hindi/emoji…)
    .replace(/[^\x20-\x7E]/g, '')
    .trimEnd();
}

// ============ text layout helpers ============

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function billDate(date: string): string {
  // bill.date is YYYY-MM-DD (local) → DD-MM-YYYY
  const [y, m, d] = date.split('-');
  return d && m && y ? `${d}-${m}-${y}` : asciiLine(date);
}

function wrapText(s: string, width: number): string[] {
  const words = asciiLine(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur.length) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
    while (cur.length > width) { lines.push(cur.slice(0, width)); cur = cur.slice(width); }
  }
  if (cur.length) lines.push(cur);
  return lines.length ? lines : [''];
}

/** "label" left, "value" right inside one cols-wide line. */
function twoCol(label: string, value: string, cols: number): string {
  const l = asciiLine(label);
  const v = asciiLine(value);
  const space = cols - l.length - v.length;
  if (space >= 1) return l + ' '.repeat(space) + v;
  // overflow → stack the value on the next line
  return l.slice(0, cols) + '\n' + v.slice(0, cols).padStart(cols);
}

function dotted(cols: number): string {
  return '-'.repeat(cols);
}

function money(n: number): string {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============ ESC/POS byte assembly ============

const ESC = 0x1b;
const GS = 0x1d;

class EscPosBuilder {
  private parts: number[] = [];

  raw(...bytes: number[]): this { this.parts.push(...bytes); return this; }
  init(): this { return this.raw(ESC, 0x40); } // ESC @
  align(mode: 0 | 1 | 2): this { return this.raw(ESC, 0x61, mode); }
  font(n: number): this { return this.raw(ESC, 0x21, n); } // ESC !
  feed(n: number): this { return this.raw(ESC, 0x64, n); } // ESC d n
  cutPartial(): this { return this.raw(GS, 0x56, 66, 0); } // GS V 66 0
  text(s: string): this {
    const clean = asciiLine(s);
    for (let i = 0; i < clean.length; i++) this.parts.push(clean.charCodeAt(i) & 0xff);
    this.parts.push(0x0a); // LF
    return this;
  }
  line(s: string): this { return this.text(s); }
  blank(): this { return this.raw(0x0a); }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

/**
 * Shared receipt model (v2.32.0) — the single source of truth for BOTH
 * consumers so paper output is byte-identical no matter the path:
 *   • buildEscPosReceipt      → APK Bluetooth (ESC/POS bytes)
 *   • admin thermal-web.ts    → desktop USB (Web Serial) + print dialog (HTML)
 * Each line carries alignment/size hints; text is ASCII-sanitised here.
 */
export interface ThermalLine {
  text: string;
  center?: boolean;
  big?: boolean;
}

export function buildReceiptLines(bill: Bill, settings: BillingSettings | null): ThermalLine[] {
  const cols = thermalColumns(settings?.thermalWidthMm ?? 58);
  const lines: ThermalLine[] = [];
  // split('\n') FIRST (before asciiLine, which strips control chars incl. \n)
  // so a twoCol overflow truly stacks on two lines — the old inline ESC/POS
  // path accidentally merged the two halves into one line (fixed here).
  const add = (text: string, center = false, big = false) => {
    for (const part of text.split('\n')) {
      lines.push({ text: asciiLine(part), center, big });
    }
  };
  const L = (s: string) => add(s);
  const C = (s: string) => add(s, true);

  const shopName = bill.shopSnapshot?.name || settings?.shopName || 'PS TELECOM';

  // ---- header (centered, shop identity) ----
  add(shopName.toUpperCase(), true, true);
  if (bill.shopSnapshot?.address) {
    for (const l of wrapText(bill.shopSnapshot.address, cols)) { if (l) C(l); }
  }
  if (bill.shopSnapshot?.phone) C(`Ph: ${bill.shopSnapshot.phone}`);
  if (bill.shopSnapshot?.gstNumber) C(`GSTIN: ${bill.shopSnapshot.gstNumber}`);
  L(dotted(cols));

  // ---- meta ----
  L(twoCol(`BILL: ${bill.billNumber}`, billDate(bill.date), cols));
  const custAscii = asciiLine(bill.customerName || '');
  if (custAscii && bill.customerMobile) {
    L(twoCol(`CUST: ${custAscii}`, bill.customerMobile, cols));
  } else if (custAscii) {
    L(`CUST: ${custAscii}`);
  } else if (bill.customerMobile) {
    L(`MOB: ${bill.customerMobile}`);
  }
  L(dotted(cols));

  // ---- items ----
  for (const item of bill.items) {
    const nameLine = item.name + (item.categoryName ? ` (${item.categoryName})` : '');
    for (const l of wrapText(nameLine, cols)) L(l);
    L(twoCol(`  ${item.quantity} x ${money(item.unitPrice)}`, money(item.total), cols));
    if (item.serialNumbers && item.serialNumbers.length) {
      L(`  SN: ${item.serialNumbers.join(',')}`);
    }
  }
  L(dotted(cols));

  // ---- totals ----
  L(twoCol('SUBTOTAL', money(bill.subtotal), cols));
  if (bill.discountAmount > 0) {
    const pct = bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : '';
    L(twoCol(`DISCOUNT${pct}`, `-${money(bill.discountAmount)}`, cols));
  }
  if (bill.gstEnabled && bill.gstAmount > 0) {
    L(twoCol(`GST ${bill.gstRate}%`, money(bill.gstAmount), cols));
    if (bill.taxableValue !== undefined) {
      L(twoCol('TAXABLE', money(bill.taxableValue), cols));
    }
  }
  add(twoCol('TOTAL', `Rs.${money(bill.total)}`, cols), true, true);
  if (bill.paidAmount > 0) {
    L(twoCol(`PAID (${bill.paymentMethod.toUpperCase()})`, money(bill.paidAmount), cols));
  }
  if (bill.dueAmount > 0) {
    L(twoCol('DUE', `Rs.${money(bill.dueAmount)}`, cols));
  }
  L(dotted(cols));

  // ---- footer ----
  if (settings?.upiId) L(`UPI: ${settings.upiId}`);
  if (bill.note && asciiLine(bill.note)) {
    for (const l of wrapText(`Note: ${bill.note}`, cols)) { if (l) L(l); }
  }
  const thanksAscii = settings?.thankYouNote ? asciiLine(settings.thankYouNote) : '';
  if (thanksAscii) {
    for (const l of wrapText(thanksAscii, cols)) { if (l) C(l); }
  } else {
    C('Thank you for your business!');
  }
  C('* * *');

  return lines;
}

/**
 * Builds the complete thermal receipt for a bill (ESC/POS bytes).
 * Mirrors the on-screen thermal-58 template (same sections, same order).
 */
export function buildEscPosReceipt(bill: Bill, settings: BillingSettings | null): Uint8Array {
  const b = new EscPosBuilder();
  b.init();
  let align: 0 | 1 = 0;
  let font = 0x00;
  for (const l of buildReceiptLines(bill, settings)) {
    const wantAlign: 0 | 1 = l.center ? 1 : 0;
    if (align !== wantAlign) { b.align(wantAlign); align = wantAlign; }
    const wantFont = l.big ? 0x30 : 0x00;
    if (font !== wantFont) { b.font(wantFont); font = wantFont; }
    b.line(l.text);
  }
  b.feed(3);
  b.cutPartial();
  return b.toUint8Array();
}

// ============ high-level print flow ============

const LAST_PRINTER_KEY = 'psa_thermal_printer';

export function rememberPrinter(address: string, name: string): void {
  try { localStorage.setItem(LAST_PRINTER_KEY, JSON.stringify({ address, name })); } catch { /* private mode */ }
}

export function getRememberedPrinter(): { address: string; name: string } | null {
  try {
    const raw = localStorage.getItem(LAST_PRINTER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { address?: string; name?: string };
    if (!parsed?.address) return null;
    return { address: parsed.address, name: parsed.name || parsed.address };
  } catch { return null; }
}

/** One-shot: build bytes + send to the given printer. */
export async function printBillThermal(bill: Bill, settings: BillingSettings | null, address: string): Promise<void> {
  const bytes = buildEscPosReceipt(bill, settings);
  await printEscPosOverBluetooth(address, bytes);
}
