/**
 * Preview the new bill PDF design (sandbox-only, not shipped):
 *   bun run scripts/preview-bill-pdf.ts
 * Writes sample PDFs to tool-results/ for visual inspection.
 */
import { writeFileSync } from 'fs';
import { generateBillPdf, type BillPdfImages } from '../src/lib/bill-pdf';
import type { Bill } from '../src/lib/types';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const baseBill: Bill = {
  id: 'bill-1',
  userId: 'local-owner',
  billNumber: 'PS-0042',
  customerName: 'Sujit Mahato',
  customerMobile: '9876543210',
  items: [
    { productId: 'p1', name: 'Samsung Galaxy F14 Display Panel (Original)', quantity: 1, unitPrice: 2450, total: 2450 },
    { productId: 'p2', name: 'Screen Guard + Tempered Glass Fitting Service', quantity: 2, unitPrice: 150, total: 300 },
    { productId: 'p3', name: 'Mobile Back Cover', quantity: 1, unitPrice: 250, total: 250 },
  ],
  subtotal: 3000,
  discountValue: 5,
  discountType: 'percent',
  discountAmount: 150,
  gstEnabled: true,
  gstRate: 18,
  gstAmount: 513,
  total: 3363,
  paymentMethod: 'upi',
  paidAmount: 3000,
  dueAmount: 363,
  note: 'Warranty: 3 months on display panel only.',
  transactionId: 'tx-1',
  shopSnapshot: {
    name: 'PS TELECOM',
    address: 'Khaltipur More, Near Bus Stand, P.S. Kharibari, Dist. Darjeeling, West Bengal - 734429',
    phone: '9876543210',
    gstNumber: '19ABCDE1234F1Z5',
    proprietorName: 'Avijit Maity & Brother',
  },
  date: '2025-02-14',
  createdAt: '2025-02-14T10:00:00.000Z',
  updatedAt: '2025-02-14T10:00:00.000Z',
};

// Multi-line T&C exactly as the shop owner would type it in Settings
const termsSample = [
  '1. Goods once sold will not be taken back or exchanged.',
  '2. Warranty as per manufacturer policy only — physical damage is not covered.',
  '',
  '3. Payment due within 7 days. Late payments attract 2% monthly interest.',
  '4. All disputes are subject to Siliguri jurisdiction only.',
  '',
  '5. Please retain this bill for any warranty claim.',
].join('\n');

async function main() {
  const fullImages: BillPdfImages = {
    signatureDataUrl: TINY_PNG,
    qrCodeDataUrl: TINY_PNG,
    upiId: 'pstelecom@ybl',
    thankYouNote: 'Thank you for your business — please visit again!',
    termsText: termsSample,
    proprietorName: 'Avijit Maity & Brother',
  };

  const pdf1 = await generateBillPdf(baseBill, fullImages);
  writeFileSync('tool-results/bill-preview-full.pdf', Buffer.from(await pdf1.blob.arrayBuffer()));
  console.log('✓ bill-preview-full.pdf written');

  // minimal variant: no QR/signature/terms, cash payment, no GST
  const minimal: Bill = {
    ...baseBill,
    billNumber: 'PS-0043',
    gstEnabled: false,
    gstAmount: 0,
    discountAmount: 0,
    discountValue: 0,
    paidAmount: 500,
    dueAmount: 0,
    note: '',
    customerName: 'Walk-in Customer',
    customerMobile: '',
    items: [{ productId: 'p1', name: 'Charger Cable Type-C', quantity: 1, unitPrice: 500, total: 500 }],
    subtotal: 500,
    total: 500,
    paymentMethod: 'cash',
  };
  const pdf2 = await generateBillPdf(minimal, { thankYouNote: '' });
  writeFileSync('tool-results/bill-preview-minimal.pdf', Buffer.from(await pdf2.blob.arrayBuffer()));
  console.log('✓ bill-preview-minimal.pdf written');
}

main().catch((e) => {
  console.error('PREVIEW FAILED:', e);
  process.exit(1);
});
