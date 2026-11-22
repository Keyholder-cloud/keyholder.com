import { describe, expect, it } from 'vitest';
import { lineKey, parseAmount, parseDate, parseStatementText, parseTable, parseTextStatement, splitCsv, findPeriod, type PdfLine } from './statements';

describe('amounts and dates as banks print them', () => {
  it('reads amounts in every common form', () => {
    expect(parseAmount('$1,234.56')).toBe(123456);
    expect(parseAmount('(12.00)')).toBe(-1200);
    expect(parseAmount('12.00-')).toBe(-1200);
    expect(parseAmount('-12.00')).toBe(-1200);
    expect(parseAmount('1 234,56')).toBe(123456);
    expect(parseAmount('45.10 CR')).toBe(4510);
    expect(parseAmount('45.10 DR')).toBe(-4510);
    expect(parseAmount('Coffee')).toBeNull();
  });
  it('reads dates in every common form', () => {
    expect(parseDate('2026-01-15')).toBe('2026-01-15');
    expect(parseDate('20260115')).toBe('2026-01-15');
    expect(parseDate('01/15/2026')).toBe('2026-01-15');
    expect(parseDate('15/01/2026')).toBe('2026-01-15');
    expect(parseDate('Jan 15, 2026')).toBe('2026-01-15');
    expect(parseDate('15 JAN 26')).toBe('2026-01-15');
    expect(parseDate('Jan 15', { year: 2026 })).toBe('2026-01-15');
    expect(parseDate('15 janv. 2026')).toBe('2026-01-15');
    expect(parseDate('February 30, 2026')).toBeNull();
  });
  it('finds the statement period, also across the new year', () => {
    expect(findPeriod('Statement period: January 1, 2026 to January 31, 2026')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(findPeriod('Dec 15 to Jan 14, 2026')).toEqual({ from: '2025-12-15', to: '2026-01-14' });
  });
});

describe('CSV exports', () => {
  it('RBC (header, account type, signed CAD$ column)', () => {
    const csv = `"Account Type","Account Number","Transaction Date","Cheque Number","Description 1","Description 2","CAD$","USD$"
Chequing,01234-5678901,1/2/2026,,"E-TRANSFER","MAYA CHEN",1650.00,
Chequing,01234-5678901,1/5/2026,,"MORTGAGE PAYMENT","RBC MORTGAGE",-2300.69,
Chequing,01234-5678901,1/9/2026,,"HOME DEPOT #7011","",-86.45,`;
    const st = parseTable(splitCsv(csv));
    expect(st.kind).toBe('bank');
    expect(st.lines.map((l) => [l.date, l.amount])).toEqual([['2026-01-02', 165000], ['2026-01-05', -230069], ['2026-01-09', -8645]]);
    expect(st.lines[0].description).toBe('E-TRANSFER · MAYA CHEN');
  });
  it('TD (no header: date, description, debit, credit, balance), checked against the running balance', () => {
    const csv = `01/02/2026,E-TRANSFER MAYA CHEN,,1650.00,5650.00
01/05/2026,RBC MORTGAGE PMT,2300.69,,3349.31
01/09/2026,HOME DEPOT #7011,86.45,,3262.86`;
    const st = parseTable(splitCsv(csv));
    expect(st.lines.map((l) => l.amount)).toEqual([165000, -230069, -8645]);
    expect(st.check).toBe('balanced');
  });
  it('credit card exports: purchases are money out', () => {
    const csv = `Date,Description,Amount,Card
2026-01-03,AMAZON.CA,54.99,Visa
2026-01-04,PAYMENT THANK YOU,-200.00,Visa
2026-01-08,HOME HARDWARE,120.00,Visa`;
    const st = parseTable(splitCsv(csv));
    expect(st.kind).toBe('card');
    expect(st.lines.map((l) => l.amount)).toEqual([-5499, 20000, -12000]);
  });
  it('day-first dates are recognised when the day is over 12', () => {
    const st = parseTable(splitCsv('Date,Description,Amount\n03/01/2026,A,-1.00\n25/01/2026,B,-2.00'));
    expect(st.lines.map((l) => l.date)).toEqual(['2026-01-03', '2026-01-25']);
  });
});

describe('OFX/QFX and QIF', () => {
  it('OFX: exact lines with the bank id', () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>5678901</ACCTID></BANKACCTFROM><BANKTRANLIST><DTSTART>20260101<DTEND>20260131
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260102120000<TRNAMT>1650.00<FITID>A1<NAME>E-TRANSFER MAYA CHEN</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260105<TRNAMT>-2300.69<FITID>A2<NAME>RBC MORTGAGE<MEMO>Mortgage payment</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const st = parseStatementText('jan.qfx', ofx);
    expect(st.format).toBe('ofx');
    expect(st.from).toBe('2026-01-01');
    expect(st.account).toBe('•••• 8901');
    expect(st.lines.map((l) => [l.amount, l.ref])).toEqual([[165000, 'A1'], [-230069, 'A2']]);
  });
  it('QIF', () => {
    const st = parseStatementText('x.qif', '!Type:Bank\nD01/02/2026\nT1,650.00\nPMAYA CHEN\n^\nD01/05/2026\nT-2,300.69\nPRBC MORTGAGE\n^\n');
    expect(st.lines.map((l) => [l.date, l.amount, l.description])).toEqual([['2026-01-02', 165000, 'MAYA CHEN'], ['2026-01-05', -230069, 'RBC MORTGAGE']]);
  });
});

describe('PDF statements', () => {
  const line = (y: number, ...items: [number, string][]): PdfLine => ({ y, page: 1, items: items.map(([x, str]) => ({ x, w: str.length * 5, str })) });
  it('columns from the headers; dates without a year; several lines on one date; balances checked', () => {
    const L = [
      line(10, [40, 'Royal Bank of Canada']), line(20, [40, 'Your account statement From January 1, 2026 to January 31, 2026']),
      line(30, [40, 'Opening balance'], [400, '4,000.00']),
      line(40, [40, 'Date'], [90, 'Description'], [260, 'Withdrawals ($)'], [340, 'Deposits ($)'], [420, 'Balance ($)']),
      line(50, [40, 'Jan 2'], [90, 'e-Transfer received MAYA CHEN'], [360, '1,650.00'], [440, '5,650.00']),
      line(60, [40, 'Jan 5'], [90, 'Mortgage payment'], [280, '2,300.69']),
      line(70, [90, 'Home Depot #7011'], [290, '86.45'], [440, '3,262.86']),
      line(80, [40, 'Closing balance'], [400, '3,262.86']),
    ];
    const st = parseTextStatement(L, 'pdf');
    expect(st.bank).toBe('RBC Royal Bank');
    expect(st.lines.map((l) => [l.date, l.amount, l.description])).toEqual([
      ['2026-01-02', 165000, 'e-Transfer received MAYA CHEN'],
      ['2026-01-05', -230069, 'Mortgage payment'],
      ['2026-01-05', -8645, 'Home Depot #7011'],
    ]);
    expect(st.check).toBe('balanced');
  });
  it('scanned text without columns: directions come from the running balance', () => {
    const st = parseTextStatement([
      'Opening balance 4,000.00', '01/02/2026 E-TRANSFER MAYA CHEN 1,650.00 5,650.00', '01/05/2026 RBC MORTGAGE 2,300.69 3,349.31', 'Closing balance 3,349.31',
    ], 'scan');
    expect(st.lines.map((l) => l.amount)).toEqual([165000, -230069]);
    expect(st.check).toBe('balanced');
  });
  it('a line that does not add up is flagged', () => {
    const st = parseTextStatement(['Opening balance 100.00', '01/02/2026 A 10.00', 'Closing balance 50.00'], 'scan');
    expect(st.check).toBe('mismatch');
    expect(st.warnings.join(' ')).toMatch(/do not|add up/);
  });
});

it('the same line has the same key in two statements', () => {
  expect(lineKey({ date: '2026-01-02', amount: 165000, description: 'E-Transfer  Maya Chen' })).toBe(lineKey({ date: '2026-01-02', amount: 165000, description: 'E-TRANSFER MAYA CHEN' }));
});
