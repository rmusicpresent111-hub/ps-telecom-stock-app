import type { GstMode } from './types';

/**
 * GST money math — the ONE source of truth shared by bill creation
 * (offline-service), the Quick Sell preview (QuickSellModal) and the
 * settings preview (AdminBillSettings). Every site MUST mirror these
 * numbers so the preview always equals the stored bill.
 *
 * Two modes (user picks in Bill Settings):
 *  - 'inclusive'  → the amount entered IS the final amount. GST comes out
 *                   of it: taxable = amount / (1 + rate/100), then the rate
 *                   is split half CGST / half SGST. Customer pays exactly
 *                   the entered amount (PS Telecom's requested behaviour).
 *  - 'exclusive'  → legacy behaviour: GST is added on top of the entered
 *                   amount and the customer pays amount + GST.
 *
 * Paisa rounding is absorbed by SGST so taxable + CGST + SGST always adds
 * up to the printed total EXACTLY (no 1-paisa drift on the receipt).
 */

export const DEFAULT_GST_MODE: GstMode = 'inclusive';

/** Missing/unknown stored value → inclusive (v2.13.0 default per shop owner's request). */
export function normalizeGstMode(v: unknown): GstMode {
  return v === 'exclusive' ? 'exclusive' : DEFAULT_GST_MODE;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface GstBreakup {
  /** Sale value before GST (the taxed base). */
  taxable: number;
  /** total GST (CGST + SGST). */
  gstAmount: number;
  /** Central half — rate/2 % of taxable. */
  cgst: number;
  /** State half — whatever keeps the sum exact. */
  sgst: number;
  /** The amount the customer actually pays. */
  total: number;
}

/**
 * @param amountAfterDiscount item total minus discount — the pre-GST money
 *                            the bill line shows.
 * @param ratePercent         full GST rate, e.g. 18 (→ 9% CGST + 9% SGST).
 */
export function computeGst(amountAfterDiscount: number, ratePercent: number, mode: GstMode): GstBreakup {
  const amount = round2(Math.max(0, Number(amountAfterDiscount) || 0));
  const rate = Math.max(0, Number(ratePercent) || 0);

  if (rate <= 0) {
    return { taxable: amount, gstAmount: 0, cgst: 0, sgst: 0, total: amount };
  }

  if (mode === 'inclusive') {
    // amount IS the final total — carve the tax out of it.
    const taxable = round2(amount / (1 + rate / 100));
    const gstAmount = round2(amount - taxable);
    const cgst = round2(gstAmount / 2);
    const sgst = round2(gstAmount - cgst);
    return { taxable, gstAmount, cgst, sgst, total: amount };
  }

  // exclusive — legacy: tax rides on top.
  const taxable = amount;
  const gstAmount = round2((amount * rate) / 100);
  const cgst = round2(gstAmount / 2);
  const sgst = round2(gstAmount - cgst);
  return { taxable, gstAmount, cgst, sgst, total: round2(amount + gstAmount) };
}

/** CGST/SGST label rate — half of the full rate (18 → 9, 5 → 2.5). */
export function halfRate(ratePercent: number): number {
  return Math.round(((Number(ratePercent) || 0) / 2) * 100) / 100;
}
