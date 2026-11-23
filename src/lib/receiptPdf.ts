import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';

// A rent receipt as a one-page PDF (letter size), attached to every receipt email and downloaded from the app: the landlord, the tenant,
// the rental, the month, the amount, how and when it was paid, a receipt number, and the landlord's name as the
// signature. Made on the server when the email is sent, from the details kept with the email.

export interface ReceiptPdfData {
  number: number;
  issued: string; // YYYY-MM-DD
  landlord: { name: string; email?: string; phone?: string };
  tenant: string;
  rental: string;
  period: string; // "November 2026"
  amount: string; // "$1,650.00"
  paidOn: string; // YYYY-MM-DD
  method: string; // "e-Transfer"
  balance?: string; // still owing for that month, if any
  note?: string;
}

const INK = rgb(0.07, 0.09, 0.15), SOFT = rgb(0.4, 0.44, 0.52), RULE = rgb(0.85, 0.87, 0.91), BRAND = rgb(0.31, 0.27, 0.9), PAID = rgb(0.01, 0.6, 0.38);
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

export async function receiptPdf(d: ReceiptPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Rent receipt #${d.number}`); doc.setAuthor(d.landlord.name); doc.setCreator('Keyholder');
  const page = doc.addPage([612, 792]);
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = 56, R = 556;
  const text = (p: PDFPage, s: string, x: number, y: number, f: PDFFont, size: number, color = INK) => p.drawText(s, { x, y, font: f, size, color });
  const right = (s: string, y: number, f: PDFFont, size: number, color = INK, end = R) => text(page, s, end - f.widthOfTextAtSize(s, size), y, f, size, color);

  // Header band
  page.drawRectangle({ x: 0, y: 712, width: 612, height: 80, color: BRAND });
  text(page, 'RENT RECEIPT', L, 748, bold, 22, rgb(1, 1, 1));
  text(page, 'Official receipt for rent received', L, 730, reg, 10, rgb(0.9, 0.9, 1));
  const no = `No. ${d.number}`;
  text(page, no, R - bold.widthOfTextAtSize(no, 16), 748, bold, 16, rgb(1, 1, 1));
  const iss = `Issued ${day(d.issued)}`;
  text(page, iss, R - reg.widthOfTextAtSize(iss, 10), 730, reg, 10, rgb(0.9, 0.9, 1));

  // From / To
  let y = 676;
  text(page, 'FROM (LANDLORD)', L, y, bold, 9, SOFT); text(page, 'RECEIVED FROM (TENANT)', 316, y, bold, 9, SOFT);
  y -= 18; text(page, d.landlord.name, L, y, bold, 13); text(page, d.tenant, 316, y, bold, 13);
  y -= 16; if (d.landlord.email) text(page, d.landlord.email, L, y, reg, 10, SOFT);
  y -= 14; if (d.landlord.phone) text(page, d.landlord.phone, L, y, reg, 10, SOFT);
  y -= 30;
  text(page, 'RENTAL', L, y, bold, 9, SOFT); y -= 18; text(page, d.rental, L, y, reg, 12);

  // Amount box
  y -= 40;
  page.drawRectangle({ x: L, y: y - 64, width: R - L, height: 80, color: rgb(0.96, 0.97, 1), borderColor: RULE, borderWidth: 1 });
  text(page, 'AMOUNT RECEIVED', L + 20, y - 4, bold, 9, SOFT);
  text(page, d.amount, L + 20, y - 40, bold, 30);
  right(`Rent for ${d.period}`, y - 18, bold, 13, INK, R - 20);
  right(d.balance ? `Still owing for the month: ${d.balance}` : 'Paid in full for the month', y - 38, reg, 10, d.balance ? rgb(0.85, 0.18, 0.13) : PAID, R - 20);

  // Details table
  y -= 104;
  const rows: [string, string][] = [['Receipt number', String(d.number)], ['Rent period', d.period], ['Date paid', day(d.paidOn)], ['Paid by', d.method], ['Received from', d.tenant], ['Rental', d.rental]];
  if (d.note) rows.push(['Note', d.note]);
  for (const [k, v] of rows) {
    page.drawLine({ start: { x: L, y: y + 14 }, end: { x: R, y: y + 14 }, thickness: 0.6, color: RULE });
    text(page, k, L, y, reg, 11, SOFT);
    right(v.length > 60 ? `${v.slice(0, 58)}…` : v, y, reg, 11);
    y -= 26;
  }
  page.drawLine({ start: { x: L, y: y + 14 }, end: { x: R, y: y + 14 }, thickness: 0.6, color: RULE });

  // Signature
  y -= 40;
  text(page, 'Received with thanks,', L, y, reg, 11); y -= 34;
  text(page, d.landlord.name, L, y, bold, 14);
  page.drawLine({ start: { x: L, y: y - 6 }, end: { x: L + 220, y: y - 6 }, thickness: 0.8, color: INK });
  text(page, 'Landlord', L, y - 20, reg, 9, SOFT);
  // A "PAID" stamp
  page.drawRectangle({ x: R - 120, y: y - 22, width: 120, height: 44, borderColor: PAID, borderWidth: 2, opacity: 0, borderOpacity: 0.9 });
  text(page, 'PAID', R - 60 - bold.widthOfTextAtSize('PAID', 22) / 2, y - 8, bold, 22, PAID);

  // Footer
  text(page, 'Keep this receipt for your records. It can be used as proof of rent paid (for example, for a tax credit or a new rental).', L, 64, reg, 8.5, SOFT);
  text(page, `Issued for ${d.landlord.name} by Keyholder · keyholder.cloud`, L, 50, reg, 8.5, SOFT);
  return doc.save();
}
