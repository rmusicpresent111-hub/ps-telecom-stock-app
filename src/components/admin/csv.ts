/**
 * csv.ts — tiny CSV download helpers shared across the admin console
 * (AdminSync products/bills export, AdminReports low-stock exports).
 *
 * Files carry a UTF-8 BOM so Excel / Google Sheets open Bangla/Hindi
 * text correctly, and every cell goes through csvEscape so commas,
 * quotes and newlines inside product names never break the grid.
 */

export function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

/**
 * Build + download a CSV from a matrix of primitive cells.
 * The first row is the header row.
 */
export function downloadCsvFile(filename: string, rows: (string | number)[][]): void {
  const csv = '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  downloadBlob(csv, filename, 'text/csv;charset=utf-8');
}
