import { detectFormat, parseStatementText, parseTable, parseTextStatement, type PdfLine, type Statement } from './statements';

// Reading a statement file in the browser (nothing is uploaded to be read): text formats as text (UTF-8, or the
// older Windows encoding some banks still use), Excel by unzipping it, PDF with its text positions (pages that
// are only pictures, like scans, are read by the on-device text reader), and photos by the text reader.

type Progress = (step: string, pct: number) => void;

async function asText(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // Replacement characters mean it was not UTF-8: read it as Windows-1252 (accents in French descriptions).
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8.replace(/^﻿/, '');
}

/** The first worksheet of an .xlsx file as rows of text. */
async function xlsxRows(f: File): Promise<string[][]> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const z = unzipSync(new Uint8Array(await f.arrayBuffer()));
  const shared = z['xl/sharedStrings.xml'] ? [...strFromU8(z['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')) : [];
  const sheetName = Object.keys(z).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) return [];
  const xml = strFromU8(z[sheetName]);
  const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const colIdx = (ref: string) => { const l = ref.replace(/\d+/g, ''); let n = 0; for (const c of l) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
  const rows: string[][] = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]; const inner = c[2] ?? '';
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1]; const t = attrs.match(/t="(\w+)"/)?.[1];
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '';
      let text = t === 's' ? shared[Number(v)] ?? '' : unesc(v);
      // Excel dates are day numbers since 1899-12-30, in cells with a date style: turn plausible ones into dates.
      if (!t && /^\d{5}(\.\d+)?$/.test(text) && Number(text) > 30000 && Number(text) < 60000) {
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86400000);
        text = d.toISOString().slice(0, 10);
      }
      row[ref ? colIdx(ref) : row.length] = unesc(text);
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** A PDF's lines with positions; pages without a text layer (scans) are drawn and read by the text reader. */
async function pdfLines(f: File, onProgress: Progress): Promise<{ lines: PdfLine[]; scanned: boolean }> {
  const pdfjs = await import('pdfjs-dist');
  try { pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href; } catch { /* worker optional */ }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise;
  const lines: PdfLine[] = [];
  let scanned = false;
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress(`Reading page ${p} of ${doc.numPages}`, Math.round(((p - 1) / doc.numPages) * 100));
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = (tc.items as { str: string; transform: number[]; width: number }[]).filter((i) => i.str?.trim());
    if (items.length < 5) {
      // A picture of a page: draw it and read the text.
      scanned = true;
      const vp = page.getViewport({ scale: 2.2 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
      const { readPageText } = await import('./ocr');
      const text = await readPageText(c, onProgress);
      text.forEach((t, i) => lines.push({ y: i, page: p, items: [{ x: 0, w: t.length, str: t }] }));
      continue;
    }
    // Group pieces into lines by their height on the page (within 2.5 points), top to bottom, left to right.
    const rows: { y: number; items: { x: number; w: number; str: string }[] }[] = [];
    for (const it of items) {
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width, str: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) { r.items.sort((a, b) => a.x - b.x); lines.push({ y: r.y, page: p, items: r.items }); }
  }
  return { lines, scanned };
}

export const canReadPhotos = () => typeof Worker !== 'undefined' && typeof WebAssembly === 'object';

/** Reads any statement file into lines, ready for the review screen. */
export async function readStatementFile(f: File, onProgress: Progress = () => {}): Promise<Statement> {
  const head = new TextDecoder().decode(new Uint8Array(await f.slice(0, 2048).arrayBuffer()));
  const fmt = detectFormat(f.name, head);
  if (fmt === 'xlsx') {
    if (/\.xls$/i.test(f.name)) throw new Error('This is an old Excel file (.xls). Open it in Excel or Numbers and save it as .xlsx or .csv, then upload that.');
    return parseTable(await xlsxRows(f), 'xlsx');
  }
  if (fmt === 'pdf') {
    const { lines, scanned } = await pdfLines(f, onProgress);
    if (!lines.length) throw new Error('No text was found in this PDF.');
    return parseTextStatement(lines, scanned ? 'scan' : 'pdf');
  }
  if (fmt === 'scan') {
    if (!canReadPhotos()) throw new Error('This browser cannot read photos. Download the statement as CSV or PDF from your bank instead.');
    const { readPageText } = await import('./ocr');
    return parseTextStatement(await readPageText(f, onProgress), 'scan');
  }
  return parseStatementText(f.name, await asText(f));
}
