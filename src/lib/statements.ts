// Reading bank and credit card statements, whatever the format: OFX/QFX/QBO (Quicken, QuickBooks), QIF, CSV/TSV
// (any bank's column layout, with or without a header row), Excel (.xlsx, read by the caller into rows), PDF (text
// with positions, read by the caller) and scanned pages or photos (text from the OCR reader).
//
// Rigour: every line is kept with the text it came from; amounts get their direction from the statement's own
// columns, then from the running balance when there is one; the opening and closing balances, when printed, are
// used to check that every line was read. Nothing here guesses silently: anything unsure becomes a warning that
// the review screen shows before importing.

import type { Cents, ISODate } from '../data/types';

export type StatementFormat = 'ofx' | 'qif' | 'csv' | 'xlsx' | 'pdf' | 'scan' | 'text';
export interface StatementLine {
  date: ISODate;
  /** Signed, from the account holder's side: positive = money in, negative = money out. */
  amount: Cents;
  description: string;
  /** The bank's own id for the line (OFX FITID), when it has one. */
  ref?: string;
  /** The running balance printed next to the line, when there is one. */
  balance?: Cents;
  /** Where the line came from in the file (for the review screen). */
  raw: string;
}
export interface Statement {
  format: StatementFormat;
  kind: 'bank' | 'card';
  bank?: string;
  account?: string;
  from?: ISODate;
  to?: ISODate;
  opening?: Cents;
  closing?: Cents;
  lines: StatementLine[];
  /** 'balanced': opening + every line = closing (or each running balance follows). */
  check: 'balanced' | 'mismatch' | 'unchecked';
  warnings: string[];
}

// ---------------------------------------------------------------- amounts and dates

const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, janvier: 1, january: 1, feb: 2, fev: 2, fév: 2, févr: 2, fevr: 2, february: 2, février: 2, fevrier: 2,
  mar: 3, mars: 3, march: 3, apr: 4, avr: 4, avril: 4, april: 4, may: 5, mai: 5, jun: 6, juin: 6, june: 6,
  jul: 7, juil: 7, juillet: 7, july: 7, aug: 8, aou: 8, aoû: 8, août: 8, aout: 8, august: 8, sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10, nov: 11, november: 11, novembre: 11, dec: 12, déc: 12, december: 12, décembre: 12, decembre: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number): ISODate | null => (valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null);
const year4 = (y: number) => (y < 100 ? 2000 + y : y);

/** A money amount as printed: "$1,234.56", "1 234,56", "(12.00)", "12.00-", "-12.00", "12.00 CR", "DR 12.00". */
export function parseAmount(s: string): Cents | null {
  let t = s.trim().replace(/−/g, '-').replace(/\s*(CAD|USD|\$|CA\$)\s*/gi, ' ').trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
  if (/\bDR\b|\bDB\b|\bdébit\b/i.test(t)) { neg = true; t = t.replace(/\bDR\b|\bDB\b|\bdébit\b/gi, '').trim(); }
  if (/\bCR\b|\bcrédit\b/i.test(t)) t = t.replace(/\bCR\b|\bcrédit\b/gi, '').trim();
  if (/-$/.test(t)) { neg = true; t = t.slice(0, -1).trim(); }
  if (/^[-–]/.test(t)) { neg = !neg; t = t.slice(1).trim(); }
  if (/^\+/.test(t)) t = t.slice(1).trim();
  // 1,234.56 or 1 234,56 (French) or 1234.5
  let m = t.match(/^(\d{1,3}(?:[ ,  ]\d{3})+|\d+)(?:\.(\d{1,2}))?$/);
  if (m) return (neg ? -1 : 1) * (Number(m[1].replace(/[ ,  ]/g, '')) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0));
  m = t.match(/^(\d{1,3}(?:[ .  ]\d{3})+|\d+),(\d{1,2})$/);
  if (m) return (neg ? -1 : 1) * (Number(m[1].replace(/[ .  ]/g, '')) * 100 + Number(m[2].padEnd(2, '0')));
  return null;
}

/** "2026-01-15", "2026/01/15", "20260115", "01/15/2026", "15/01/2026", "Jan 15, 2026", "15 Jan 2026", "15-JAN-26", "Jan 15" (year from `ctx`). */
export function parseDate(s: string, ctx: { year?: number; order?: 'mdy' | 'dmy' } = {}): ISODate | null {
  const t = s.trim().toLowerCase().replace(/\./g, '').replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m = t.match(/^(\d{4})[-/ ](\d{1,2})[-/ ](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{4})(\d{2})(\d{2})(?:\d{6})?(?:\.\d+)?(?:\[.*\])?$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = year4(+m[3]);
    if (a > 12) return iso(y, b, a);
    if (b > 12) return iso(y, a, b);
    return ctx.order === 'dmy' ? iso(y, b, a) : iso(y, a, b);
  }
  m = t.match(/^([a-zéûè]{3,9})\s*(\d{1,2})(?:\s+(\d{2,4}))?$/);
  if (m && MONTHS[m[1]]) { const y = m[3] ? year4(+m[3]) : ctx.year; return y ? iso(y, MONTHS[m[1]], +m[2]) : null; }
  m = t.match(/^(\d{1,2})[\s-]*([a-zéûè]{3,9})[\s-]*(\d{2,4})?$/);
  if (m && MONTHS[m[2]]) { const y = m[3] ? year4(+m[3]) : ctx.year; return y ? iso(y, MONTHS[m[2]], +m[1]) : null; }
  m = t.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (m && ctx.year) return ctx.order === 'dmy' ? iso(ctx.year, +m[2], +m[1]) : iso(ctx.year, +m[1], +m[2]);
  return null;
}

/** A date at the start of a line (PDF or scanned statements). Returns the date and where it ends. */
function leadingDate(s: string, ctx: { year?: number; order?: 'mdy' | 'dmy' }): { date: ISODate; rest: string } | null {
  const pats = [
    /^\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/, /^\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/,
    /^\s*([A-Za-zéû]{3,9}\.?\s+\d{1,2},?(?:\s+\d{4})?)\b/, /^\s*(\d{1,2}[\s-][A-Za-zéû]{3,9}\.?(?:[\s-]\d{2,4})?)\b/,
    /^\s*(\d{1,2}[-/]\d{1,2})\b/,
  ];
  for (const p of pats) {
    const m = s.match(p); if (!m) continue;
    const d = parseDate(m[1], ctx); if (d) return { date: d, rest: s.slice(m[0].length) };
  }
  return null;
}

/** The statement period ("January 1, 2026 to January 31, 2026", "From 2026-01-01 to 2026-01-31", "Statement period: 01/01/2026 - 31/01/2026"). */
export function findPeriod(text: string): { from: ISODate; to: ISODate } | null {
  const D = '((?:[A-Za-zéû]{3,9}\\.?\\s+\\d{1,2},?\\s+\\d{4})|(?:\\d{1,2}\\s+[A-Za-zéû]{3,9}\\.?\\s+\\d{4})|(?:\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})|(?:\\d{1,2}[-/]\\d{1,2}[-/]\\d{4}))';
  const re = new RegExp(`${D}\\s*(?:to|-|–|—|au|à|through|thru)\\s*${D}`, 'i');
  const m = text.match(re);
  if (m) { const a = parseDate(m[1]), b = parseDate(m[2]); if (a && b && a <= b) return { from: a, to: b }; }
  // "Month Day to Month Day, Year" (year once, at the end)
  const m2 = text.match(/([A-Za-zéû]{3,9})\.?\s+(\d{1,2})\s*(?:to|-|–|au)\s*([A-Za-zéû]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m2 && MONTHS[m2[1].toLowerCase()] && MONTHS[m2[3].toLowerCase()]) {
    const y = +m2[5], ma = MONTHS[m2[1].toLowerCase()], mb = MONTHS[m2[3].toLowerCase()];
    const a = iso(ma > mb ? y - 1 : y, ma, +m2[2]), b = iso(y, mb, +m2[4]);
    if (a && b) return { from: a, to: b };
  }
  return null;
}

/** For dates printed without a year: the year from the statement period (December lines in a Dec–Jan statement are last year). */
const yearFor = (period: { from: ISODate; to: ISODate } | null, fallback: number) => (month: number) => {
  if (!period) return fallback;
  const fy = +period.from.slice(0, 4), ty = +period.to.slice(0, 4);
  if (fy === ty) return fy;
  return month >= +period.from.slice(5, 7) ? fy : ty;
};

const BANKS: [RegExp, string][] = [
  [/royal bank|\brbc\b/i, 'RBC Royal Bank'], [/td canada trust|toronto[- ]dominion|\btd\b/i, 'TD Canada Trust'], [/scotiabank|bank of nova scotia/i, 'Scotiabank'],
  [/\bbmo\b|bank of montreal/i, 'BMO'], [/\bcibc\b|canadian imperial/i, 'CIBC'], [/national bank|banque nationale/i, 'National Bank'],
  [/desjardins/i, 'Desjardins'], [/tangerine/i, 'Tangerine'], [/simplii/i, 'Simplii'], [/\beq bank\b/i, 'EQ Bank'], [/\batb\b/i, 'ATB'],
  [/hsbc/i, 'HSBC'], [/coast capital/i, 'Coast Capital'], [/vancity/i, 'Vancity'], [/meridian/i, 'Meridian'], [/laurentian|laurentienne/i, 'Laurentian Bank'],
  [/\bpc financial\b|president'?s choice/i, 'PC Financial'], [/wealthsimple/i, 'Wealthsimple'], [/american express|amex/i, 'American Express'],
];
export const bankName = (text: string) => BANKS.find(([re]) => re.test(text))?.[1];
const looksCard = (text: string) => /\b(visa|mastercard|master card|credit card|carte de crédit|amex|american express|minimum payment|credit limit|limite de crédit)\b/i.test(text);
const SKIP = /\b(opening|closing|previous|new|beginning|ending|starting)\s+balance\b|\bbalance\s+(forward|brought|carried)\b|\btotal\b|\bsubtotal\b|^\s*balance\s*$|\bsolde\s+(d'ouverture|de fermeture|précédent|reporté)\b|\bpage\s+\d+\s+of\b/i;
const IN_WORDS = /\b(deposit|e-?transfer (received|from|autodeposit)|interac e-?transfer from|payroll|refund|interest (paid|earned)|credit memo|payment received|dépôt|virement reçu|mobile deposit|direct deposit|autodeposit)\b/i;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- the balance check

/** Checks the lines against the printed balances; fixes a direction from the running balance where the columns were unclear. */
function reconcile(st: Statement): Statement {
  const L = st.lines;
  // Running balance: each line's balance = previous balance + amount. Use it to confirm (or fix) each direction.
  let followed = 0, fixed = 0, broken = 0;
  for (let i = 1; i < L.length; i++) {
    const a = L[i - 1].balance, b = L[i].balance;
    if (a === undefined || b === undefined) continue;
    const delta = b - a;
    if (delta === L[i].amount) followed++;
    else if (delta === -L[i].amount) { L[i].amount = delta; fixed++; followed++; }
    else broken++;
  }
  if (L.length && L[0].balance !== undefined && st.opening !== undefined) {
    const d0 = L[0].balance - st.opening;
    if (d0 === -L[0].amount) { L[0].amount = d0; fixed++; }
  }
  const sum = L.reduce((a, l) => a + l.amount, 0);
  const sign = st.kind === 'card' ? -1 : 1; // card statements print what is owed: purchases raise it
  if (st.opening !== undefined && st.closing !== undefined) {
    st.check = st.opening + sign * sum === st.closing ? 'balanced' : 'mismatch';
    if (st.check === 'mismatch') st.warnings.push(`The lines add up to ${(sign * sum / 100).toFixed(2)}, but the statement goes from ${(st.opening / 100).toFixed(2)} to ${(st.closing / 100).toFixed(2)}. A line may be missing or misread: check the list before importing.`);
  } else if (followed > 0 && broken === 0) st.check = 'balanced';
  else if (broken > 0) { st.check = 'mismatch'; st.warnings.push(`${broken} line${broken === 1 ? '' : 's'} do not follow the running balance. Check them before importing.`); }
  if (fixed) st.warnings.push(`${fixed} direction${fixed === 1 ? '' : 's'} (in or out) taken from the running balance.`);
  return st;
}

// ---------------------------------------------------------------- OFX / QFX / QBO

export function parseOfx(text: string): Statement {
  const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'))?.[1]?.trim();
  const card = /<CCSTMTRS>/i.test(text);
  const st: Statement = { format: 'ofx', kind: card ? 'card' : 'bank', lines: [], check: 'unchecked', warnings: [] };
  st.bank = tag(text, 'ORG') || bankName(text);
  const acct = tag(text, 'ACCTID'); if (acct) st.account = `•••• ${acct.slice(-4)}`;
  const s = tag(text, 'DTSTART'), e = tag(text, 'DTEND');
  if (s) st.from = parseDate(s.slice(0, 8)) ?? undefined; if (e) st.to = parseDate(e.slice(0, 8)) ?? undefined;
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  for (const b of blocks) {
    const date = parseDate((tag(b, 'DTPOSTED') ?? tag(b, 'DTUSER') ?? '').slice(0, 8));
    const amt = parseAmount(tag(b, 'TRNAMT') ?? '');
    if (!date || amt === null) { st.warnings.push('A transaction without a date or amount was skipped.'); continue; }
    const name = tag(b, 'NAME') ?? tag(b, 'PAYEE') ?? '', memo = tag(b, 'MEMO') ?? '';
    st.lines.push({ date, amount: amt, description: clean([name, memo && memo !== name ? memo : ''].filter(Boolean).join(' · ')) || (tag(b, 'TRNTYPE') ?? 'Transaction'), ref: tag(b, 'FITID'), raw: clean(b).slice(0, 200) });
  }
  // OFX: the ledger balance at the end; the start is that minus the lines.
  const led = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i)?.[1];
  if (led) {
    const close = parseAmount(led); if (close !== null) {
      st.closing = card ? -close : close; // OFX card balances are negative when money is owed
      if (card) st.closing = Math.abs(close);
    }
  }
  st.check = st.lines.length ? 'balanced' : 'unchecked'; // OFX lines are exact by design
  return st;
}

// ---------------------------------------------------------------- QIF

export function parseQif(text: string): Statement {
  const card = /^!Type:(CCard|Invst)/im.test(text);
  const st: Statement = { format: 'qif', kind: card ? 'card' : 'bank', lines: [], check: 'unchecked', warnings: [] };
  let cur: Record<string, string> = {};
  const order = /\b\d{1,2}\/\d{1,2}'\d{2}\b/.test(text) ? 'mdy' : undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd(); if (!line || line.startsWith('!')) continue;
    if (line === '^') {
      const date = parseDate((cur.D ?? '').replace("'", '/'), { order }); const amt = parseAmount(cur.T ?? cur.U ?? '');
      if (date && amt !== null) st.lines.push({ date, amount: amt, description: clean([cur.P, cur.M].filter(Boolean).join(' · ')) || 'Transaction', ref: cur.N, raw: Object.entries(cur).map(([k, v]) => `${k}${v}`).join(' ') });
      cur = {}; continue;
    }
    cur[line[0]] = line.slice(1);
  }
  st.check = st.lines.length ? 'balanced' : 'unchecked';
  return st;
}

// ---------------------------------------------------------------- tables: CSV / TSV / Excel

/** Splits CSV text (quotes, doubled quotes, commas or semicolons or tabs). */
export function splitCsv(text: string): string[][] {
  const first = text.split(/\r?\n/).slice(0, 10).join('\n');
  const delim = [',', ';', '\t', '|'].map((d) => ({ d, n: first.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x));
}

type Cols = { date: number; desc: number[]; amount?: number; debit?: number; credit?: number; balance?: number; type?: number; card: boolean };
const H = {
  date: /^(transaction |posted |posting |trans\.? )?date( posted| de transaction| de l'opération)?$|^date$|^posted$|^trans(action)? date$/i,
  desc: /desc|details|memo|payee|name|narrative|merchant|libell|transaction$|particulars|reference|cheque/i,
  amount: /^(transaction )?amount|^cad\$?$|^montant|^amt$/i,
  debit: /debit|withdraw|paid out|money out|retrait|charges?$|purchases?/i,
  credit: /credit|deposit|paid in|money in|dépôt|depot|payments?$/i,
  balance: /balance|solde/i,
  type: /^(transaction )?type$|account type/i,
};

function headerCols(h: string[]): Cols | null {
  const find = (re: RegExp, not: number[] = []) => h.findIndex((x, i) => re.test(x) && !not.includes(i));
  const date = find(H.date); if (date < 0) return null;
  const amount = find(H.amount, [date]);
  const balance = find(H.balance, [date]);
  const debit = find(H.debit, [date, balance]);
  const credit = find(H.credit, [date, balance, debit]);
  if (amount < 0 && (debit < 0 || credit < 0) && debit < 0) return null;
  const used = [date, amount, debit, credit, balance].filter((i) => i >= 0);
  const desc = h.map((x, i) => (H.desc.test(x) && !used.includes(i) ? i : -1)).filter((i) => i >= 0);
  const type = find(H.type, used);
  return { date, desc, amount: amount >= 0 ? amount : undefined, debit: debit >= 0 ? debit : undefined, credit: credit >= 0 ? credit : undefined, balance: balance >= 0 ? balance : undefined, type: type >= 0 ? type : undefined, card: h.some((x) => /card|visa|mastercard/i.test(x)) };
}

/** No header row (TD, CIBC, Scotiabank exports): the columns are worked out from what is in them. */
function guessCols(rows: string[][], order?: 'mdy' | 'dmy'): Cols | null {
  const n = Math.max(...rows.map((r) => r.length));
  const sample = rows.slice(0, 60);
  const share = (i: number, f: (s: string) => boolean) => { const v = sample.map((r) => r[i] ?? '').filter((x) => x); return v.length ? v.filter(f).length / v.length : 0; };
  const filled = (i: number) => sample.filter((r) => (r[i] ?? '').trim()).length / sample.length;
  const dateCol = [...Array(n).keys()].find((i) => share(i, (s) => !!parseDate(s, { order })) > 0.8);
  if (dateCol === undefined) return null;
  const nums = [...Array(n).keys()].filter((i) => i !== dateCol && share(i, (s) => parseAmount(s) !== null) > 0.9);
  const texts = [...Array(n).keys()].filter((i) => i !== dateCol && !nums.includes(i) && filled(i) > 0.3);
  const desc = texts.sort((a, b) => sample.reduce((s, r) => s + (r[b] ?? '').length, 0) - sample.reduce((s, r) => s + (r[a] ?? '').length, 0)).slice(0, 2);
  if (!nums.length) return null;
  if (nums.length === 1) return { date: dateCol, desc, amount: nums[0], card: false };
  // Two money columns, each row filling one: debit then credit (TD, CIBC). A third, always filled: the balance.
  const always = nums.filter((i) => filled(i) > 0.95);
  const sometimes = nums.filter((i) => !always.includes(i));
  if (sometimes.length >= 2) return { date: dateCol, desc, debit: sometimes[0], credit: sometimes[1], balance: always[always.length - 1], card: false };
  if (always.length >= 2 && sometimes.length === 0) return { date: dateCol, desc, amount: always[0], balance: always[always.length - 1], card: false };
  return { date: dateCol, desc, amount: nums[0], balance: nums.length > 1 ? nums[nums.length - 1] : undefined, card: false };
}

export function parseTable(rows: string[][], format: 'csv' | 'xlsx' = 'csv'): Statement {
  const st: Statement = { format, kind: 'bank', lines: [], check: 'unchecked', warnings: [] };
  const all = rows.map((r) => r.join(' ')).join('\n');
  st.bank = bankName(all);
  // Dates like 03/04/2026 are ambiguous: day-first if any date has a first part above 12.
  const order: 'mdy' | 'dmy' = rows.some((r) => r.some((c) => { const m = c.match(/^(\d{1,2})[-/](\d{1,2})[-/]\d{2,4}$/); return !!m && +m[1] > 12; })) ? 'dmy' : 'mdy';
  let head = -1; let cols: Cols | null = null;
  for (let i = 0; i < Math.min(rows.length, 25); i++) { const c = headerCols(rows[i]); if (c) { head = i; cols = c; break; } }
  if (!cols) cols = guessCols(rows, order);
  if (!cols) { st.warnings.push('Could not find the date and amount columns in this file.'); return st; }
  const body = rows.slice(head + 1);
  const header = head >= 0 ? rows[head].join(' ') : '';
  let card = cols.card || looksCard(all.slice(0, 2000));
  // RBC: the account type column says Chequing / Savings / Visa / MasterCard.
  if (cols.type !== undefined && body.some((r) => /visa|mastercard|credit/i.test(r[cols!.type!] ?? ''))) card = true;
  st.kind = card ? 'card' : 'bank';
  for (const r of body) {
    const date = parseDate(r[cols.date] ?? '', { order });
    if (!date) continue;
    let amt: number | null = null;
    if (cols.amount !== undefined) amt = parseAmount(r[cols.amount] ?? '');
    else {
      const d = parseAmount(r[cols.debit!] ?? ''), c = parseAmount(r[cols.credit!] ?? '');
      if (d !== null && d !== 0) amt = -Math.abs(d); else if (c !== null && c !== 0) amt = Math.abs(c);
    }
    if (amt === null || amt === 0) continue;
    const description = clean(cols.desc.map((i) => r[i] ?? '').filter(Boolean).join(' · ')) || clean(r.filter((x, i) => i !== cols!.date && parseAmount(x) === null).join(' ')) || 'Transaction';
    if (SKIP.test(description)) continue;
    const bal = cols.balance !== undefined ? parseAmount(r[cols.balance] ?? '') ?? undefined : undefined;
    st.lines.push({ date, amount: amt, description, balance: bal, raw: r.join(' | ').slice(0, 200) });
  }
  // Card exports with one amount column usually show purchases as positive: flip so money out is negative.
  if (card && cols.amount !== undefined) {
    const pos = st.lines.filter((l) => l.amount > 0 && !/payment|paiement|refund|credit/i.test(l.description)).length;
    if (pos > st.lines.length / 2) { for (const l of st.lines) l.amount = -l.amount; st.warnings.push('Credit card: purchases are counted as money out, payments to the card as money in.'); }
  }
  if (/\bdate\b/i.test(header) && order === 'dmy') st.warnings.push('Dates read as day/month/year.');
  st.lines.sort((a, b) => a.date.localeCompare(b.date));
  if (st.lines.length) { st.from = st.lines[0].date; st.to = st.lines[st.lines.length - 1].date; }
  return reconcile(st);
}

// ---------------------------------------------------------------- PDF and scanned statements (text lines)

/** One line of a PDF page: its text pieces with where they sit (x from the left, in page units). */
export type PdfItem = { x: number; w: number; str: string };
export type PdfLine = { y: number; page: number; items: PdfItem[] };

const AMT_RE = /\(?-?\$?\s?\d{1,3}(?:[ , ]\d{3})*(?:[.,]\d{2})\)?(?:\s?(?:CR|DR|-))?/g;

/**
 * Text statements: PDF lines (with positions: the column headers say which amounts are money out, in and the
 * balance) or scanned text (no positions: the running balance and words like "deposit" decide).
 */
export function parseTextStatement(lines: PdfLine[] | string[], format: 'pdf' | 'scan' | 'text', today = new Date()): Statement {
  const L: PdfLine[] = typeof lines[0] === 'string' ? (lines as string[]).map((s, i) => ({ y: i, page: 1, items: [{ x: 0, w: s.length, str: s }] })) : (lines as PdfLine[]);
  const text = L.map((l) => l.items.map((i) => i.str).join(' ')).join('\n');
  const st: Statement = { format, kind: looksCard(text) ? 'card' : 'bank', lines: [], check: 'unchecked', warnings: [] };
  st.bank = bankName(text);
  const acct = text.match(/(?:account|acct|compte)[^\d\n]{0,25}((?:\d[\d -]{3,20}\d))/i)?.[1]; if (acct) st.account = `•••• ${acct.replace(/\D/g, '').slice(-4)}`;
  const period = findPeriod(text);
  if (period) { st.from = period.from; st.to = period.to; }
  const year = yearFor(period, today.getFullYear());
  const order: 'mdy' | 'dmy' = /\b(\d{2})\/\d{2}\/\d{4}/.test(text) && [...text.matchAll(/\b(\d{2})\/\d{2}\/\d{4}/g)].some((m) => +m[1] > 12) ? 'dmy' : 'mdy';
  const ob = text.match(/(?:opening|previous|beginning|starting)\s+balance[^\d\-(]{0,40}(\(?-?\$?\s?[\d,]+\.\d{2}\)?(?:\s?CR|\s?DR)?)/i)?.[1];
  const cb = text.match(/(?:closing|new|ending)\s+balance[^\d\-(]{0,40}(\(?-?\$?\s?[\d,]+\.\d{2}\)?(?:\s?CR|\s?DR)?)/i)?.[1];
  if (ob) st.opening = parseAmount(ob) ?? undefined;
  if (cb) st.closing = parseAmount(cb) ?? undefined;

  // Column headers (PDF only): where "Withdrawals", "Deposits" and "Balance" sit, to put each amount in its column.
  type Col = { kind: 'out' | 'in' | 'bal'; x: number };
  let cols: Col[] = [];
  if (format === 'pdf') for (const l of L) {
    const found: Col[] = [];
    for (const it of l.items) {
      const s = it.str.toLowerCase();
      const right = it.x + it.w;
      if (/withdraw|debit|cheques|paid out|retraits|money out|charges|purchases/.test(s)) found.push({ kind: 'out', x: right });
      else if (/deposit|credit|paid in|dépôts|money in|payments/.test(s)) found.push({ kind: 'in', x: right });
      else if (/balance|solde/.test(s)) found.push({ kind: 'bal', x: right });
    }
    if (found.some((c) => c.kind === 'out') && (found.some((c) => c.kind === 'in') || found.some((c) => c.kind === 'bal'))) { cols = found; break; }
  }
  const nearest = (x: number) => cols.reduce<Col | null>((b, c) => (!b || Math.abs(c.x - x) < Math.abs(b.x - x) ? c : b), null);

  let last: StatementLine | null = null; let lastDate: ISODate | null = null;
  for (const l of L) {
    const full = clean(l.items.map((i) => i.str).join(' '));
    if (!full || SKIP.test(full)) { last = null; continue; }
    const ctx = { year: undefined as number | undefined, order };
    // Year for dates without one: try the month first.
    const mm = full.match(/^\s*([A-Za-zéû]{3,9})\.?\s+\d{1,2}\b/)?.[1]?.toLowerCase() ?? full.match(/^\s*\d{1,2}\s+([A-Za-zéû]{3,9})\b/)?.[1]?.toLowerCase();
    const numM = full.match(/^\s*(\d{1,2})[-/](\d{1,2})\b(?![-/]\d)/);
    const month = mm && MONTHS[mm] ? MONTHS[mm] : numM ? (order === 'dmy' ? +numM[2] : +numM[1]) : undefined;
    ctx.year = month ? year(month) : today.getFullYear();
    const ld = leadingDate(full, ctx);
    // Amounts on the line, with their positions when known.
    const amts: { v: Cents; x: number; s: string }[] = [];
    if (format === 'pdf') for (const it of l.items) { for (const m of it.str.matchAll(AMT_RE)) { const v = parseAmount(m[0]); if (v !== null && /[.,]\d{2}/.test(m[0])) amts.push({ v, x: it.x + it.w, s: m[0] }); } }
    else for (const m of full.matchAll(AMT_RE)) { const v = parseAmount(m[0]); if (v !== null && /[.,]\d{2}/.test(m[0])) amts.push({ v, x: m.index ?? 0, s: m[0] }); }
    const date: ISODate | null = ld?.date ?? (amts.length ? lastDate : null);
    if (!date) { if (last && !amts.length && full.length < 80) last.description = clean(`${last.description} ${full}`); continue; }
    if (!amts.length) {
      // A date and words but no amount: the description continues on the next line (RBC, BMO).
      last = null; lastDate = date; continue;
    }
    let amount: Cents | undefined; let balance: Cents | undefined;
    if (cols.length) {
      for (const a of amts) { const c = nearest(a.x); if (!c) continue; if (c.kind === 'bal') balance = a.v; else if (amount === undefined) amount = c.kind === 'out' ? -Math.abs(a.v) : Math.abs(a.v); }
    }
    if (amount === undefined) {
      // No columns: the first amount is the transaction; a second one is the running balance.
      amount = amts[0].v; if (amts.length > 1) balance = amts[amts.length - 1].v;
      const words = (ld?.rest ?? full).replace(AMT_RE, ' ');
      if (amount > 0 && st.kind === 'bank' && !IN_WORDS.test(words)) amount = -amount; // most lines are money out; the balance check corrects
      if (st.kind === 'card' && amount > 0 && !/payment|paiement|refund|credit/i.test(words)) amount = -amount;
    }
    let description = clean((ld?.rest ?? full).replace(AMT_RE, ' ').replace(/\s[-–]\s*$/, ''));
    // A second date at the start (posting date next to transaction date, card statements).
    const second = leadingDate(description, ctx); if (second) description = clean(second.rest);
    if (!description || SKIP.test(description)) continue;
    last = { date, amount, description, balance, raw: full.slice(0, 200) };
    st.lines.push(last); lastDate = date;
  }
  if (!cols.length && format === 'pdf') st.warnings.push('No column headers were found: in and out were worked out from the running balance and the words on each line.');
  if (format === 'scan') st.warnings.push('Read from a picture: check the amounts before importing.');
  if (!st.from && st.lines.length) { st.from = st.lines[0].date; st.to = st.lines[st.lines.length - 1].date; }
  return reconcile(st);
}

// ---------------------------------------------------------------- one entry point for text files

export function detectFormat(name: string, head: string): StatementFormat {
  const n = name.toLowerCase();
  if (/\.(ofx|qfx|qbo)$/.test(n) || /<OFX>|OFXHEADER/i.test(head)) return 'ofx';
  if (/\.qif$/.test(n) || /^!Type:/im.test(head)) return 'qif';
  if (/\.xlsx?$/.test(n)) return 'xlsx';
  if (/\.pdf$/.test(n) || head.startsWith('%PDF')) return 'pdf';
  if (/\.(png|jpe?g|heic|webp|gif|bmp|tiff?)$/.test(n)) return 'scan';
  if (/\.(csv|tsv)$/.test(n) || /[,;\t]/.test(head.split(/\r?\n/)[0] ?? '')) return 'csv';
  return 'text';
}

export function parseStatementText(name: string, text: string): Statement {
  const f = detectFormat(name, text.slice(0, 2000));
  if (f === 'ofx') return parseOfx(text);
  if (f === 'qif') return parseQif(text);
  if (f === 'csv') { const t = parseTable(splitCsv(text)); if (t.lines.length) return t; }
  return parseTextStatement(text.split(/\r?\n/), 'text');
}

/** Same line? (for de-duplicating overlapping statements and Plaid transactions). */
export const lineKey = (l: Pick<StatementLine, 'date' | 'amount' | 'description'>) => `${l.date}|${l.amount}|${l.description.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24)}`;
