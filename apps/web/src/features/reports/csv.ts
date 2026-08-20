/**
 * CSV export.
 *
 * Reports get taken into board packs and client reviews, so every table on the
 * screen can leave as a file. Generated in the browser from data already
 * fetched — no second round trip, and nothing to keep in step on the server.
 */

/** Quotes a field so commas, quotes and newlines survive the trip to a spreadsheet. */
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return [headers, ...rows].map((row) => row.map(escapeField).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>): void {
  // The byte-order mark is what makes Excel read the file as UTF-8 rather than
  // mangling ₹. Written as an escape so it is visible in the source.
  const blob = new Blob([`\uFEFF${toCsv(headers, rows)}`], {
    type: 'text/csv;charset=utf-8;',
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** `probild-revenue-2026-08-18.csv` */
export function reportFilename(name: string): string {
  return `probild-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
}
