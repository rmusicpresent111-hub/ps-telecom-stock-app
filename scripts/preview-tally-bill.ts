/**
 * Sandbox-only: render the Tally-style bill HTML to tool-results/ so the
 * layout can be inspected in a browser without app data.
 */
import { buildBillReceiptHtml } from '../src/components/admin/print';
import type { Bill, BillingSettings } from '../src/lib/types';
import { writeFileSync } from 'node:fs';

const settings: BillingSettings = {
  userId: 'demo',
  shopName: 'PS TELECOM',
  proprietorName: 'P. Saha',
  shopAddress: 'Kolkata, West Bengal - 700001',
  shopPhone: '9732881732',
  gstNumber: '19ABCDE1234F1Z5',
  gstEnabled: true,
  gstRate: 18,
  gstMode: 'inclusive',
  defaultDiscountPercent: 0,
  upiId: 'pstelecom@upi',
  signatureDataUrl: '',
  qrCodeDataUrl: '',
  billPrefix: 'PS-',
  thankYouNote: '',
  termsText: 'Goods once sold will not be taken back.\nWarranty as per manufacturer only.',
  adminPin: '9732881732',
  updatedAt: new Date().toISOString(),
};

const bill: Bill = {
  id: 'b1',
  userId: 'demo',
  billNumber: 'PS-0142',
  customerName: 'Rahul Sharma',
  customerMobile: '9830112233',
  items: [
    { productId: 'p1', name: 'Samsung 25W Type-C Adapter (EP-T2510)', quantity: 1, unitPrice: 1180, total: 1180, serialNumbers: ['SN-AX91K2231'] },
    { productId: 'p2', name: 'JBL Tune 125TWS Earbuds', quantity: 2, unitPrice: 3499, total: 6998, serialNumbers: [] },
    { productId: 'p3', name: 'Mi Braided USB-C Cable 1.5m', quantity: 3, unitPrice: 149, total: 447, serialNumbers: [] },
  ],
  subtotal: 8625,
  discountValue: 125,
  discountType: 'amount',
  discountAmount: 125,
  gstEnabled: true,
  gstRate: 18,
  gstAmount: 1301.81,
  gstMode: 'inclusive',
  taxableValue: 7323.19,
  cgstAmount: 650.91,
  sgstAmount: 650.9,
  total: 8500,
  paymentMethod: 'upi',
  paidAmount: 8500,
  dueAmount: 0,
  note: 'Counter sale',
  transactionId: 'tx_001',
  shopSnapshot: { name: 'PS TELECOM', address: 'Kolkata, West Bengal - 700001', phone: '9732881732', gstNumber: '19ABCDE1234F1Z5' },
  date: '2025-10-31',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const html = buildBillReceiptHtml(bill, 'en', settings);
writeFileSync('tool-results/tally-bill-sample.html', html, 'utf8');
console.log('written: tool-results/tally-bill-sample.html,', html.length, 'bytes');
