import PDFDocument from 'pdfkit';
import type { Currency } from '@probild/shared';

/**
 * Document generation.
 *
 * These are the papers a client actually receives, so they are laid out to be
 * read on a page rather than to mirror a screen: one column, a clear total, and
 * the terms where someone looks for them.
 */

const INK = '#10151C';
const MUTED = '#667085';
const LINE = '#E3E7EE';
const ACCENT = '#1F4FD8';

/**
 * Money on a printed page.
 *
 * The ISO code rather than the symbol: PDFKit's built-in Helvetica is
 * WinAnsi-encoded and has no ₹ glyph, so a rupee symbol prints as a stray mark
 * on an Indian invoice. "INR 6,84,400.00" needs no embedded font, and reads
 * unambiguously to a client in either country. Digit grouping still follows the
 * currency's own convention.
 */
function money(value: number, currency: Currency): string {
  const amount = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${currency} ${amount}`;
}

function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function render(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    build(doc);
    doc.end();
  });
}

export interface CompanyProfile {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  taxId?: string | null;
}

/** The masthead: who this is from, and what the paper is. */
function header(doc: PDFKit.PDFDocument, company: CompanyProfile, title: string, reference: string) {
  // The same three-bar mark the app uses, drawn rather than loaded.
  doc.rect(48, 48, 4, 20).fill(ACCENT);
  doc.rect(55, 55, 4, 13).fill('#8FA6E8');
  doc.rect(62, 61, 4, 7).fill('#C2410C');

  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text(company.name, 76, 50);

  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(8.5)
    .text(
      [company.email, company.phone, company.taxId ? `GST ${company.taxId}` : null]
        .filter(Boolean)
        .join('  ·  '),
      76,
      68,
    );

  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(title, 48, 104, { align: 'right' });

  doc
    .fillColor(MUTED)
    .font('Courier')
    .fontSize(9)
    .text(reference, 48, 126, { align: 'right' });

  doc.moveTo(48, 148).lineTo(547, 148).strokeColor(LINE).lineWidth(1).stroke();
  doc.y = 164;
}

function labelledBlock(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  label: string,
  lines: Array<string | null | undefined>,
): number {
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5).text(label.toUpperCase(), x, y, {
    characterSpacing: 0.8,
  });

  let cursor = y + 13;
  doc.fillColor(INK).font('Helvetica').fontSize(9.5);
  for (const line of lines.filter(Boolean)) {
    doc.text(line as string, x, cursor, { width: 220 });
    cursor = doc.y + 1;
  }
  return cursor;
}

function totalsRow(
  doc: PDFKit.PDFDocument,
  y: number,
  label: string,
  value: string,
  emphasis = false,
): number {
  doc
    .fillColor(emphasis ? INK : MUTED)
    .font(emphasis ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(emphasis ? 11 : 9.5)
    .text(label, 330, y, { width: 120, align: 'right' })
    .text(value, 455, y, { width: 92, align: 'right' });
  return y + (emphasis ? 18 : 15);
}

/**
 * The closing line, pinned above the bottom margin.
 *
 * Measured from the page rather than hard-coded: writing past the bottom margin
 * makes PDFKit start a new page, and a one-page quotation should not arrive as
 * two.
 */
function footer(doc: PDFKit.PDFDocument, note: string) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  const rule = bottom - 26;

  doc.moveTo(48, rule).lineTo(547, rule).strokeColor(LINE).lineWidth(1).stroke();
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(8)
    .text(note, 48, rule + 8, { width: 499, align: 'center', lineBreak: false });
}

/* ------------------------------------------------------------------ */

export interface QuotationPdfInput {
  company: CompanyProfile;
  reference: string;
  title: string;
  issueDate: Date;
  validUntil: Date | null;
  currency: Currency;
  recipient: { name: string; email?: string | null; address?: string | null };
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    discountPercent: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
  paymentTerms: string | null;
  notes: string | null;
}

export function renderQuotation(input: QuotationPdfInput): Promise<Buffer> {
  return render((doc) => {
    header(doc, input.company, 'Quotation', input.reference);

    labelledBlock(doc, 48, 164, 'Prepared for', [
      input.recipient.name,
      input.recipient.email,
      input.recipient.address,
    ]);
    labelledBlock(doc, 330, 164, 'Dates', [
      `Issued  ${formatDate(input.issueDate)}`,
      input.validUntil ? `Valid until  ${formatDate(input.validUntil)}` : 'No expiry',
    ]);

    let y = 244;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5);
    doc.text('DESCRIPTION', 48, y, { characterSpacing: 0.8 });
    doc.text('QTY', 330, y, { width: 40, align: 'right' });
    doc.text('UNIT', 374, y, { width: 78, align: 'right' });
    doc.text('AMOUNT', 456, y, { width: 91, align: 'right' });

    y += 14;
    doc.moveTo(48, y).lineTo(547, y).strokeColor(LINE).stroke();
    y += 10;

    for (const item of input.items) {
      doc.fillColor(INK).font('Helvetica').fontSize(9.5);
      doc.text(item.description, 48, y, { width: 272 });
      const textBottom = doc.y;

      doc.text(String(item.quantity), 330, y, { width: 40, align: 'right' });
      doc.text(money(item.unitPrice, input.currency), 374, y, { width: 78, align: 'right' });
      doc.text(money(item.lineTotal, input.currency), 456, y, { width: 91, align: 'right' });

      if (item.discountPercent > 0) {
        doc
          .fillColor(MUTED)
          .fontSize(8)
          .text(`${item.discountPercent}% discount applied`, 48, textBottom + 1, { width: 272 });
      }

      y = Math.max(textBottom, doc.y) + 10;
      doc.moveTo(48, y - 5).lineTo(547, y - 5).strokeColor(LINE).stroke();
    }

    y += 6;
    y = totalsRow(doc, y, 'Subtotal', money(input.subtotal, input.currency));
    if (input.discountAmount > 0) {
      y = totalsRow(doc, y, 'Discount', `- ${money(input.discountAmount, input.currency)}`);
    }
    y = totalsRow(doc, y, `Tax (${input.taxPercent}%)`, money(input.taxAmount, input.currency));

    doc.moveTo(330, y + 2).lineTo(547, y + 2).strokeColor(LINE).stroke();
    y = totalsRow(doc, y + 10, 'Total', money(input.total, input.currency), true);

    y += 20;
    if (input.paymentTerms) {
      y = labelledBlock(doc, 48, y, 'Payment terms', [input.paymentTerms]) + 12;
    }
    if (input.notes) {
      labelledBlock(doc, 48, y, 'Notes', [input.notes]);
    }

    footer(
      doc,
      input.validUntil
        ? `This quotation is valid until ${formatDate(input.validUntil)}.`
        : 'Thank you for considering Probild.',
    );
  });
}

/* ------------------------------------------------------------------ */

export interface InvoicePdfInput {
  company: CompanyProfile;
  reference: string;
  title: string;
  issuedOn: Date;
  dueDate: Date | null;
  currency: Currency;
  recipient: { name: string; email?: string | null; address?: string | null };
  projectName: string | null;
  amount: number;
  paidAmount: number;
  outstanding: number;
  notes: string | null;
}

export function renderInvoice(input: InvoicePdfInput): Promise<Buffer> {
  return render((doc) => {
    header(doc, input.company, 'Invoice', input.reference);

    labelledBlock(doc, 48, 164, 'Billed to', [
      input.recipient.name,
      input.recipient.email,
      input.recipient.address,
    ]);
    labelledBlock(doc, 330, 164, 'Dates', [
      `Issued  ${formatDate(input.issuedOn)}`,
      input.dueDate ? `Due  ${formatDate(input.dueDate)}` : 'No due date',
    ]);

    let y = 244;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5);
    doc.text('DESCRIPTION', 48, y, { characterSpacing: 0.8 });
    doc.text('AMOUNT', 456, y, { width: 91, align: 'right' });

    y += 14;
    doc.moveTo(48, y).lineTo(547, y).strokeColor(LINE).stroke();
    y += 10;

    doc.fillColor(INK).font('Helvetica').fontSize(9.5);
    doc.text(input.title, 48, y, { width: 380 });
    doc.text(money(input.amount, input.currency), 456, y, { width: 91, align: 'right' });

    if (input.projectName) {
      doc.fillColor(MUTED).fontSize(8).text(input.projectName, 48, doc.y + 1, { width: 380 });
    }

    y = doc.y + 14;
    doc.moveTo(48, y - 5).lineTo(547, y - 5).strokeColor(LINE).stroke();

    y = totalsRow(doc, y + 4, 'Billed', money(input.amount, input.currency));
    if (input.paidAmount > 0) {
      y = totalsRow(doc, y, 'Received', `- ${money(input.paidAmount, input.currency)}`);
    }

    doc.moveTo(330, y + 2).lineTo(547, y + 2).strokeColor(LINE).stroke();
    y = totalsRow(
      doc,
      y + 10,
      input.outstanding > 0 ? 'Amount due' : 'Settled',
      money(input.outstanding, input.currency),
      true,
    );

    if (input.notes) {
      labelledBlock(doc, 48, y + 20, 'Notes', [input.notes]);
    }

    footer(
      doc,
      input.outstanding > 0 && input.dueDate
        ? `Please settle by ${formatDate(input.dueDate)}.`
        : input.outstanding > 0
          ? 'Please settle at your earliest convenience.'
          : 'This invoice is settled in full. Thank you.',
    );
  });
}
