/**
 * Toast mapping for the WhatsApp / PDF share flow — shared by InvoiceScreen
 * and HistoryScreen so both entry points always explain to the user exactly
 * what happened with the PDF file.
 */

import { toast } from 'sonner';
import { t } from './i18n';
import { Language } from './types';
import { WhatsappSendResult } from './bill-pdf';

export function toastWhatsappResult(result: WhatsappSendResult, language: Language): void {
  switch (result) {
    case 'shared':
      // The OS share sheet opened carrying the real PDF — WhatsApp will attach it.
      toast.success(t('billSharedWithPdf', language));
      break;
    case 'cancelled':
      // User closed the share sheet themselves — nothing to report.
      break;
    case 'iframe-blocked':
      // Preview panel / embedded frame — sharing files from a framed page is
      // blocked by the browser, so guide the user to a real tab.
      toast.warning(t('shareOpenInNewTab', language), { duration: 9000 });
      break;
    case 'fallback':
      // File share unavailable → PDF was downloaded and the wa.me chat opened.
      toast.info(t('pdfAttachManually', language), { duration: 10000 });
      break;
    case 'no-mobile':
      toast.error(t('customerPhone', language) + ' ' + t('error', language));
      break;
  }
}
