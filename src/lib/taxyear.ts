import type { AppState, ISODate, Property } from '../data/types';
import { leaseLedger, mortgagePaidBetween } from './finance';
import { addDays, periodOf } from './dates';

// Closing a tax year for a property: from its records-from date (January 1 by default) to the end of the year
// (or today), month by month: is there a bank statement (or a connected bank) for the month, is each rent
// marked paid, is the mortgage payment there; and for the year, property tax and insurance. Anything missing
// is a gap: the taxes may be inaccurate until it is filled in or ignored.

export type GapKind = 'statement' | 'rent' | 'mortgage' | 'property-tax' | 'insurance';
export interface Gap { key: string; kind: GapKind; month?: string; text: string; to: string }
export interface YearCheck {
  year: number;
  from: ISODate;
  to: ISODate;
  months: string[];
  /** Months with a statement or connected-bank coverage. */
  covered: string[];
  gaps: Gap[];
  /** Gaps the owner said do not apply. */
  ignored: Gap[];
  done: boolean;
}

/** The tax year being closed now: last year until April 30 (filing deadline), then this year. */
export const currentTaxYear = (today: ISODate) => (today.slice(5) <= '04-30' ? Number(today.slice(0, 4)) - 1 : Number(today.slice(0, 4)));

/** The first day kept for taxes in `year`: the property's records-from date, else January 1. */
export function recordsFromIn(p: Property, year: number): ISODate | null {
  const y0 = `${year}-01-01`, y1 = `${year}-12-31`;
  // Nothing to keep before the property was bought.
  const f = [y0, p.recordsFrom, p.purchaseDate].filter((x): x is ISODate => !!x).sort().pop()!;
  return f > y1 ? null : f;
}

const monthName = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('en-CA', { month: 'long' });
const ym = (d: ISODate) => d.slice(0, 7);

/** Months a bank statement or a connected bank (its transactions) covers. */
export function coveredMonths(state: AppState): Set<string> {
  const out = new Set<string>();
  for (const s of state.statements ?? []) {
    for (let d = s.from.slice(0, 7); d <= s.to.slice(0, 7); d = periodOf(addDays(`${d}-28`, 7))) {
      // A month counts when the statement covers most of it.
      const start = d === s.from.slice(0, 7) ? Number(s.from.slice(8)) : 1;
      const end = d === s.to.slice(0, 7) ? Number(s.to.slice(8)) : 31;
      if (end - start >= 20) out.add(d);
    }
  }
  // Connected banks: the months between their first transaction and the last check.
  for (const b of state.banks ?? []) {
    if (b.status !== 'connected' || b.via !== 'plaid') continue;
    const dates = state.txns.filter((t) => t.bankId === b.id).map((t) => t.date).sort();
    if (!dates.length) continue;
    for (let d = ym(dates[0]); d <= ym(b.lastSync.slice(0, 10)); d = periodOf(addDays(`${d}-28`, 7))) out.add(d);
  }
  return out;
}

export function yearCheck(state: AppState, p: Property, year: number, today: ISODate): YearCheck {
  const from = recordsFromIn(p, year) ?? `${year}-12-31`;
  const to = `${year}-12-31` < today ? `${year}-12-31` : today;
  const months: string[] = [];
  for (let m = ym(from); m <= ym(to); m = periodOf(addDays(`${m}-28`, 7))) months.push(m);
  const covered = coveredMonths(state);
  const gaps: Gap[] = [];
  const add = (g: Omit<Gap, 'key'> & { id: string }) => gaps.push({ key: `ty:${p.id}:${year}:${g.id}`, kind: g.kind, month: g.month, text: g.text, to: g.to });
  const units = state.units.filter((u) => u.propertyId === p.id);
  const leases = state.leases.filter((l) => units.some((u) => u.id === l.unitId));
  const mortgages = p.mortgageFree ? [] : state.mortgages.filter((m) => m.propertyId === p.id);
  const done = new Set(state.txns.filter((t) => t.status === 'mortgage' && t.mortgageId && mortgages.some((m) => m.id === t.mortgageId)).map((t) => ym(t.date)));
  const interest = new Set(state.expenses.filter((e) => e.propertyId === p.id && e.category === 'interest').map((e) => ym(e.date)));
  for (const m of months) {
    const name = monthName(m);
    // A month that has not ended yet only needs what is due so far.
    const ended = `${m}-31` < today || m < ym(today);
    if (ended && !covered.has(m)) add({ id: `st-${m}`, kind: 'statement', month: m, text: `${name}: no bank statement`, to: '/expenses?upload=1' });
    for (const l of leases) {
      const line = leaseLedger(l, state.payments, today, m).find((x) => x.period === m);
      if (!line || line.charge <= 0 || line.due > today) continue;
      if (line.paid < line.charge) {
        const t = state.tenants.find((x) => x.id === l.tenantId);
        const u = units.find((x) => x.id === l.unitId);
        add({ id: `rent-${l.id}-${m}`, kind: 'rent', month: m, text: `${name}: rent from ${t?.names[0] ?? 'a tenant'} (Unit ${u?.label ?? ''}${l.room ? `, ${l.room}` : ''}) not marked paid`, to: `/rent/tenant/${l.tenantId}` });
      }
    }
    // A month with no statement is one thing to add (its statement shows the mortgage payment), not two.
    if (ended && covered.has(m) && mortgages.some((mg) => mg.startDate.slice(0, 7) <= m) && !done.has(m) && !interest.has(m)) {
      add({ id: `mtg-${m}`, kind: 'mortgage', month: m, text: `${name}: no mortgage payment recorded`, to: `/rent/property/${p.id}/mortgage` });
    }
  }
  const yearExp = state.expenses.filter((e) => e.propertyId === p.id && e.date.startsWith(String(year)));
  // Property tax paid with the mortgage counts (the lender pays the city).
  const taxWithMortgage = mortgages.some((mg) => mortgagePaidBetween(mg, `${year}-01-01`, `${year}-12-31`).tax > 0);
  if (!yearExp.some((e) => e.category === 'property-tax') && !taxWithMortgage) add({ id: 'property-tax', kind: 'property-tax', text: `Property tax for ${year} not recorded`, to: '/expenses' });
  if (!yearExp.some((e) => e.category === 'insurance')) add({ id: 'insurance', kind: 'insurance', text: `Insurance for ${year} not recorded`, to: '/expenses' });
  const prefs = state.todoPrefs ?? {};
  const open = gaps.filter((g) => !prefs[g.key]?.ignored);
  const ignored = gaps.filter((g) => prefs[g.key]?.ignored);
  return { year, from, to, months, covered: months.filter((m) => covered.has(m)), gaps: open, ignored, done: open.length === 0 };
}

/** Every active property's check for a year (used by the progress score and Expenses' year row). */
export function yearChecks(state: AppState, year: number, today: ISODate) {
  return state.properties.filter((p) => !p.archived && recordsFromIn(p, year)).map((p) => ({ p, c: yearCheck(state, p, year, today) }));
}

/** Gaps across all properties for a year: a bank statement covers the whole account, so each month's statement
 *  counts once however many properties need it. */
function yearGaps(state: AppState, year: number, today: ISODate): Gap[] {
  const seen = new Set<string>();
  return yearChecks(state, year, today).flatMap((x) => x.c.gaps).filter((g) => {
    if (g.kind !== 'statement') return true;
    if (seen.has(g.month!)) return false;
    seen.add(g.month!); return true;
  });
}

/** Gaps across all properties for a year (for a badge). */
export const gapCount = (state: AppState, year: number, today: ISODate) => yearGaps(state, year, today).length;


/** What is missing for a year, in words: "10 bank statements, 2 rent payments, property tax, insurance". */
export function gapSummary(state: AppState, year: number, today: ISODate): string {
  const n: Record<GapKind, number> = { statement: 0, rent: 0, mortgage: 0, 'property-tax': 0, insurance: 0 };
  for (const g of yearGaps(state, year, today)) n[g.kind] += 1;
  const many = (k: GapKind, one: string, more: string) => (n[k] ? `${n[k]} ${n[k] === 1 ? one : more}` : '');
  return [many('statement', 'bank statement', 'bank statements'), many('rent', 'month of rent not marked paid', 'months of rent not marked paid'),
    many('mortgage', 'mortgage payment', 'mortgage payments'), many('property-tax', 'property tax bill', 'property tax bills'), many('insurance', 'insurance bill', 'insurance bills')]
    .filter(Boolean).join(', ');
}
