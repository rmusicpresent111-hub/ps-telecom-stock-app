/**
 * Bill receipt template registry (v2.31.0).
 *
 * 5 styles render the on-screen receipt (src/components/bill/BillReceipt.tsx):
 *   royal-gold    — the original premium gold-on-navy receipt (default)
 *   royal-blue    — matches the WhatsApp/A4 PDF (navy + white)
 *   classic-white — white paper, black ink, serif, double-ruled (traditional)
 *   modern-dark   — minimal mono layout with a single accent line
 *   thermal-58    — 1:1 preview of the real ESC/POS Bluetooth thermal output
 *
 * SYNC/DB SAFETY: the chosen id rides inside the existing billingSettings
 * JSON blob (optional field, additive) — old rows decode fine (missing =
 * 'royal-gold'), old app versions ignore the unknown key, and the D1 schema
 * is never touched.
 */

import { BillTemplateId } from './types';
import type { TranslationKeys } from './i18n';

interface BillTemplateMeta {
  id: BillTemplateId;
  /** i18n key for the display name */
  nameKey: keyof TranslationKeys;
  /** one-line hint shown under the name in the picker */
  descKey: keyof TranslationKeys;
  /** tiny swatch colors for the picker card (bg gradient + accent) */
  swatch: string;
  accent: string;
}

export const BILL_TEMPLATES: BillTemplateMeta[] = [
  {
    id: 'royal-gold',
    nameKey: 'tplRoyalGold',
    descKey: 'tplRoyalGoldDesc',
    swatch: 'linear-gradient(135deg,#1e2434,#141927 55%,#0f1219)',
    accent: '#D4A853',
  },
  {
    id: 'royal-blue',
    nameKey: 'tplRoyalBlue',
    descKey: 'tplRoyalBlueDesc',
    swatch: 'linear-gradient(135deg,#1E3A8A,#17306E 55%,#0F1F45)',
    accent: '#9DB4E4',
  },
  {
    id: 'classic-white',
    nameKey: 'tplClassicWhite',
    descKey: 'tplClassicWhiteDesc',
    swatch: 'linear-gradient(135deg,#ffffff,#f3f0e8 60%,#e7e2d4)',
    accent: '#1c1c1c',
  },
  {
    id: 'modern-dark',
    nameKey: 'tplModernDark',
    descKey: 'tplModernDarkDesc',
    swatch: 'linear-gradient(135deg,#0b0f14,#11181f 55%,#0b0f14)',
    accent: '#34d399',
  },
  {
    id: 'thermal-58',
    nameKey: 'tplThermal',
    descKey: 'tplThermalDesc',
    swatch: 'repeating-linear-gradient(0deg,#ffffff,#ffffff 6px,#e8e8e8 7px)',
    accent: '#111111',
  },
];

export const BILL_TEMPLATE_IDS: BillTemplateId[] = BILL_TEMPLATES.map((t) => t.id);

