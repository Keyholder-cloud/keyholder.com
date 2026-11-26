import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';

// A rental application as a PDF, in the same look as Keyholder's receipts: emailed to the landlord and to the
// applicant when the application is sent. The landlord's copy ends with the two pieces of ID (and the credit
// report, if one was added); the applicant's copy lists them without the images.

export interface ApplicationPdfData {
  submitted: string; // YYYY-MM-DD
  landlord: string;
  rental: string; // "Unit 2 · 12 Faraday St, Ottawa"
  rent: string;
  people: { name: string; email?: string; phone?: string; employer?: string; jobTitle?: string; income: string }[];
  sections: { title: string; rows: [string, string][] }[];
  ids: string[]; // "Driver's licence", "Passport"
  creditScore: number;
  creditSource: string;
}
export interface PdfFile { label: string; mime: string; data: Uint8Array }

const INK = rgb(0.07, 0.09, 0.15), SOFT = rgb(0.4, 0.44, 0.52), RULE = rgb(0.85, 0.87, 0.91), BRAND = rgb(0.31, 0.27, 0.9);
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
// The standard PDF fonts only draw plain Latin text: anything else becomes a "?" instead of failing.
const plain = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

export async function applicationPdf(d: ApplicationPdfData, files: PdfFile[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Rental application: ${d.people.map((p) => p.name).join(' & ')}`); doc.setCreator('Keyholder');
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = 56, R = 556, W = R - L;
  let page: PDFPage = doc.addPage([612, 792]);
  let y = 0;
  const text = (s: string, x: number, yy: number, f: PDFFont, size: number, color = INK) => page.drawText(plain(s), { x, y: yy, font: f, size, color });
  const wrap = (s: string, f: PDFFont, size: number, width: number) => {
    const out: string[] = []; let line = '';
    for (const w of plain(s).split(/\s+/)) {
      const t = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
    return out.length ? out : [''];
  };
  const header = (title: string, sub: string) => {
    page.drawRectangle({ x: 0, y: 712, width: 612, height: 80, color: BRAND });
    text(title, L, 748, bold, 22, rgb(1, 1, 1));
    text(sub, L, 730, reg, 10, rgb(0.9, 0.9, 1));
    const r = `Sent ${day(d.submitted)}`;
    text(r, R - reg.widthOfTextAtSize(r, 10), 748, reg, 10, rgb(0.9, 0.9, 1));
    y = 680;
  };
  const room = (h: number) => { if (y - h < 60) { page = doc.addPage([612, 792]); y = 740; } };
  const heading = (s: string) => { room(40); y -= 8; text(s.toUpperCase(), L, y, bold, 9, SOFT); y -= 8; page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 1, color: INK }); y -= 16; };
  const row = (k: string, v: string) => {
    const lines = wrap(v || '-', reg, 10.5, W * 0.62);
    room(lines.length * 14 + 8);
    text(k, L, y, reg, 10.5, SOFT);
    lines.forEach((ln, i) => text(ln, L + W * 0.36, y - i * 14, reg, 10.5));
    y -= lines.length * 14 + 6;
    page.drawLine({ start: { x: L, y: y + 2 }, end: { x: R, y: y + 2 }, thickness: 0.5, color: RULE });
    y -= 8;
  };

  header('RENTAL APPLICATION', `For ${d.landlord}, through Keyholder`);
  text('RENTAL', L, y, bold, 9, SOFT); text('RENT', 400, y, bold, 9, SOFT);
  y -= 18; wrap(d.rental, bold, 13, 320).forEach((ln, i) => text(ln, L, y - i * 16, bold, 13)); text(d.rent, 400, y, bold, 13);
  y -= 40;

  d.people.forEach((p, i) => {
    heading(d.people.length > 1 ? `Applicant ${i + 1}` : 'Applicant');
    row('Name', p.name);
    row('Email', p.email ?? '');
    row('Phone', p.phone ?? '');
    row('Work', [p.jobTitle, p.employer].filter(Boolean).join(' at '));
    row('Monthly income', p.income);
  });
  for (const s of d.sections) { heading(s.title); for (const [k, v] of s.rows) row(k, v); }
  heading('ID and credit');
  d.ids.forEach((t, i) => row(`ID ${i + 1}`, t));
  row('Credit score', `${d.creditScore} (from ${d.creditSource})`);
  row('Credit check', 'Consent given to a soft credit check. A soft check does not affect the credit score.');
  room(40); y -= 10;
  wrap('Sent through Keyholder · keyholder.cloud. Keyholder never asks about family status, age, religion, ethnicity, place of origin, disability or public assistance.', reg, 8.5, W)
    .forEach((ln) => { text(ln, L, y, reg, 8.5, SOFT); y -= 11; });

  // The landlord's copy: each document on its own page (a PDF's own pages are added as they are).
  for (const f of files) {
    if (f.mime === 'application/pdf') {
      try {
        const src = await PDFDocument.load(f.data, { ignoreEncryption: true });
        for (const pg of await doc.copyPages(src, src.getPageIndices())) doc.addPage(pg);
      } catch {
        page = doc.addPage([612, 792]); header(f.label.toUpperCase(), 'Attached document'); text('This PDF could not be added here. Open it in Keyholder.', L, y, reg, 11);
      }
      continue;
    }
    const img = f.mime === 'image/png' ? await doc.embedPng(f.data) : await doc.embedJpg(f.data);
    page = doc.addPage([612, 792]);
    header(f.label.toUpperCase(), `${d.people[0]?.name ?? ''} · for the landlord only`);
    const maxW = W, maxH = 600;
    const s = Math.min(maxW / img.width, maxH / img.height, 1);
    page.drawImage(img, { x: L + (maxW - img.width * s) / 2, y: 690 - img.height * s, width: img.width * s, height: img.height * s });
  }
  return doc.save();
}
