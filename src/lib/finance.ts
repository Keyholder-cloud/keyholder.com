import type {
  AppState, Cents, Expense, ISODate, Lease, Mortgage, MortgageFrequency, Payment, Period,
  Property, Unit, Valuation,
} from '../data/types';
import { addDays, addMonths, daysBetween, dueDate, fmtDate, periodOf, periodRange } from './dates';
import { CATEGORIES, CCA_CLASSES, benchmarks } from './jurisdiction';
import { hasGold } from './levels';

// =====================================================================================
// Rental share (PS-5, PS-6)
// =====================================================================================

/** Portion of an expense that counts towards the rental, in cents. */
export function rentalPortion(e: Pick<Expense, 'amount' | 'scope'>, rentalSharePct: number): Cents {
  if (e.scope === 'personal') return 0;
  if (e.scope === 'direct') return e.amount;
  return Math.round((e.amount * clamp(rentalSharePct, 0, 100)) / 100);
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// =====================================================================================
// Rent ledger (RL-1, RL-2)
// =====================================================================================

export type ChargeState = 'upcoming' | 'due' | 'late' | 'partial' | 'paid';

export interface LedgerLine {
  period: Period;
  due: ISODate;
  charge: Cents;
  paid: Cents;
  payments: Payment[];
  state: ChargeState;
  daysLate: number;
  /** Running balance owed after this period (positive = tenant owes). */
  balance: Cents;
  /** Paid before the landlord used Keyholder (the lease's paidThrough answer), not a recorded payment. */
  before?: boolean;
}

/**
 * The month a new payment is for: this month while it is not fully paid, else the oldest month still owing.
 * (Filling the oldest month first left this month unpaid, so the row kept asking to mark rent paid.)
 */
export function defaultPeriod(state: AppState, lease: Lease, today: ISODate): Period {
  const lines = leaseLedger(lease, state.payments, today, periodOf(addMonths(today, 1)));
  const now = periodOf(today);
  const cur = lines.find((l) => l.period === now);
  if (cur && cur.paid < cur.charge) return now;
  return lines.find((l) => l.paid < l.charge)?.period ?? now;
}

/** The day a month's rent was paid (the last payment toward it); none when it was paid before Keyholder. */
export function paidOn(line: LedgerLine): ISODate | undefined {
  return line.payments.map((p) => p.date).sort().pop();
}

/**
 * A unit rented by the room: rooms with a tenant (`rented`, including leases that start later), rooms whose rent
 * has started (`charged`), how many of those have paid this month and how many are late, and when the first of
 * the rest starts (`startsOn`).
 */
export function roomsPaid(state: AppState, unit: Unit, today: ISODate): { rented: number; charged: number; paid: number; late: number; startsOn?: ISODate } {
  const now = periodOf(today);
  const leases = activeLeases(state, unit.id, today);
  const lines = leases.filter((l) => l.start <= today)
    .map((l) => leaseLedger(l, state.payments, today).find((x) => x.period === now)).filter((x): x is LedgerLine => !!x);
  const later = leases.filter((l) => l.start > today).map((l) => l.start).sort();
  return { rented: leases.length, charged: lines.length, paid: lines.filter((x) => x.state === 'paid').length, late: lines.filter((x) => x.daysLate > 0 && x.paid < x.charge).length, ...(later.length ? { startsOn: later[0] } : {}) };
}

/** The unit row's pill for a unit rented by the room: "2 of 3 paid", "3 rooms rented · rent starts Dec 1", or none rented. */
export function roomsPill(sum: ReturnType<typeof roomsPaid>, day: (d: ISODate) => string): { label: string; tone: string } {
  if (!sum.rented) return { label: 'No rooms rented', tone: 'vacant' };
  if (!sum.charged) return { label: `${sum.rented} room${sum.rented > 1 ? 's' : ''} rented${sum.startsOn ? ` · rent starts ${day(sum.startsOn)}` : ''}`, tone: 'due' };
  return { label: `${sum.paid} of ${sum.charged} paid`, tone: sum.paid === sum.charged ? 'paid' : sum.late ? 'late' : 'due' };
}

/** Periods the lease charges for, from its start through `through` (inclusive). */
export function leasePeriods(lease: Lease, through: Period): Period[] {
  const last = lease.end && periodOf(lease.end) < through ? periodOf(lease.end) : through;
  return periodRange(periodOf(lease.start), last);
}

export function chargeState(charge: Cents, paid: Cents, due: ISODate, today: ISODate): { state: ChargeState; daysLate: number } {
  if (paid >= charge) return { state: 'paid', daysLate: 0 };
  const d = daysBetween(due, today);
  if (d < 0) return { state: paid > 0 ? 'partial' : 'upcoming', daysLate: 0 };
  if (d === 0) return { state: paid > 0 ? 'partial' : 'due', daysLate: 0 };
  // Legally late the day after it is due (AR-4).
  return { state: paid > 0 ? 'partial' : 'late', daysLate: d };
}

export function leaseLedger(lease: Lease, payments: Payment[], today: ISODate, through?: Period): LedgerLine[] {
  const live = payments.filter((p) => p.leaseId === lease.id && !p.voided);
  const end = through ?? periodOf(today);
  let balance = 0;
  return leasePeriods(lease, end).map((period) => {
    const due = dueDate(period, lease.dueDay);
    const ps = live.filter((p) => p.period === period).sort((a, b) => a.date.localeCompare(b.date));
    const recorded = ps.reduce((a, p) => a + p.amount, 0);
    // Up to paidThrough the tenant was in good standing before Keyholder: those months count as paid.
    const before = !!lease.paidThrough && period <= lease.paidThrough && recorded < lease.rent;
    const paid = before ? lease.rent : recorded;
    balance += lease.rent - paid;
    const { state, daysLate } = chargeState(lease.rent, paid, due, today);
    return { period, due, charge: lease.rent, paid, payments: ps, state, daysLate, balance, ...(before ? { before } : {}) };
  });
}

export function leaseBalance(lease: Lease, payments: Payment[], today: ISODate): Cents {
  // Only charges that have come due count toward what is owed.
  const lines = leaseLedger(lease, payments, today).filter((l) => l.due <= today);
  return lines.reduce((a, l) => a + l.charge - l.paid, 0);
}

/** The lease running on a unit (or starting within 60 days). For a unit rented by the room: the first room's. */
export function activeLease(state: AppState, unitId: string, today: ISODate): Lease | undefined {
  return activeLeases(state, unitId, today)[0];
}

/**
 * Every lease running on a unit: one for a unit rented as a whole (however many people share it),
 * or one per rented room, in room order, for a unit rented by the room.
 */
export function activeLeases(state: AppState, unitId: string, today: ISODate): Lease[] {
  const running = state.leases
    .filter((l) => l.unitId === unitId && l.start <= addDays(today, 60) && (!l.end || l.end >= today))
    .sort((a, b) => b.start.localeCompare(a.start));
  const unit = state.units.find((u) => u.id === unitId);
  if (unit?.rentedBy !== 'room') return running.slice(0, 1);
  const seen = new Set<string>();
  // One lease per room (the newest); a lease with no room number (from before the unit was rented by the room) is its own.
  return running
    .filter((l) => { const k = l.room ?? l.id; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.room ?? '').localeCompare(b.room ?? '', undefined, { numeric: true }));
}

/** Every lease running now, across all units (each rented room is its own lease). */
export function currentLeases(state: AppState, today: ISODate): Lease[] {
  return state.units.flatMap((u) => activeLeases(state, u.id, today));
}

export const byRoom = (u: Unit | undefined) => u?.rentedBy === 'room';

/** "Room 1", "Room 2"... for a unit rented by the room; none for a unit rented as a whole. */
export function roomLabels(u: Unit): string[] {
  return byRoom(u) ? Array.from({ length: Math.max(1, u.rooms ?? 1) }, (_, i) => `Room ${i + 1}`) : [];
}

/** Rooms nobody rents yet, in a unit rented by the room. */
export function openRooms(state: AppState, unit: Unit, today: ISODate): string[] {
  const taken = new Set(activeLeases(state, unit.id, today).map((l) => l.room));
  return roomLabels(unit).filter((r) => !taken.has(r));
}

/** Room for a new tenant: an empty unit, or a room still free. */
export function hasSpace(state: AppState, unit: Unit, today: ISODate): boolean {
  return byRoom(unit) ? openRooms(state, unit, today).length > 0 : !activeLease(state, unit.id, today);
}

/** "2 of 3 rooms rented", for a unit rented by the room. */
export function roomsLine(state: AppState, unit: Unit, today: ISODate): string {
  const n = roomLabels(unit).length;
  return `${n - openRooms(state, unit, today).length} of ${n} room${n === 1 ? '' : 's'} rented`;
}

/** Where a lease is: "Unit B", or "Unit Basement · Room 2" for a room. */
export function leasePlace(unit: Unit | undefined, lease?: Lease): string {
  if (!unit) return '';
  return `Unit ${unit.label}${lease?.room ? ` · ${lease.room}` : ''}`;
}

// =====================================================================================
// Mortgage (PS-2) — Canadian fixed-rate mortgages compound semi-annually.
// =====================================================================================

export const PERIODS_PER_YEAR: Record<MortgageFrequency, number> = { monthly: 12, 'semi-monthly': 24, biweekly: 26, weekly: 52 };

export function periodicRate(annualPct: number, perYear: number): number {
  return Math.pow(1 + annualPct / 200, 2 / perYear) - 1;
}

export function mortgagePayment(principal: Cents, annualPct: number, amortYears: number, freq: MortgageFrequency): Cents {
  const n = PERIODS_PER_YEAR[freq];
  const i = periodicRate(annualPct, n);
  const N = amortYears * n;
  if (i === 0) return Math.round(principal / N);
  return Math.round((principal * i) / (1 - Math.pow(1 + i, -N)));
}

export interface AmortRow { n: number; date: ISODate; payment: Cents; interest: Cents; principal: Cents; balance: Cents }

function paymentDate(start: ISODate, k: number, freq: MortgageFrequency): ISODate {
  switch (freq) {
    case 'monthly': return addMonths(start, k);
    case 'semi-monthly': return k % 2 === 0 ? addMonths(start, k / 2) : addDays(addMonths(start, (k - 1) / 2), 15);
    case 'biweekly': return addDays(start, 14 * k);
    case 'weekly': return addDays(start, 7 * k);
  }
}

export function amortization(m: Mortgage): AmortRow[] {
  const n = PERIODS_PER_YEAR[m.frequency];
  const i = periodicRate(m.ratePct, n);
  const pay = m.paymentOverride ?? mortgagePayment(m.principal, m.ratePct, m.amortYears, m.frequency);
  const rows: AmortRow[] = [];
  let bal = m.principal;
  const extras = [...(m.prepayments ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  let prevDate = m.startDate;
  for (let k = 1; bal > 0 && k <= m.amortYears * n + 1; k++) {
    // Extra payments made since the last regular payment go straight to principal.
    const date = paymentDate(m.startDate, k, m.frequency);
    for (const x of extras) if (x.date > prevDate && x.date <= date) bal = Math.max(0, bal - x.amount);
    prevDate = date;
    if (bal <= 0) break;
    const interest = Math.round(bal * i);
    let principal = pay - interest;
    if (principal <= 0) break; // payment does not cover interest; schedule never ends
    if (principal > bal) principal = bal;
    bal -= principal;
    rows.push({ n: k, date, payment: interest + principal, interest, principal, balance: bal });
  }
  return rows;
}

export function mortgageBalanceAt(m: Mortgage, date: ISODate, rows = amortization(m)): Cents {
  if (date < m.startDate) return 0;
  let bal = m.principal;
  for (const r of rows) {
    if (r.date > date) break;
    bal = r.balance;
  }
  return bal;
}

export function mortgagePaidBetween(m: Mortgage, from: ISODate, to: ISODate, rows = amortization(m)) {
  let interest = 0, principal = 0, count = 0;
  for (const r of rows) {
    if (r.date < from) continue;
    if (r.date > to) break;
    interest += r.interest; principal += r.principal; count++;
  }
  return { interest, principal, payment: interest + principal, count };
}

// =====================================================================================
// Running picture (FP-1, PRD 7.10)
// =====================================================================================

export interface Picture {
  from: ISODate; to: ISODate;
  rentCollected: Cents;
  rentExpected: Cents;
  arrearsLoss: Cents;
  vacancyLoss: Cents;
  opex: Cents;
  noi: Cents;
  mortgageInterest: Cents;
  mortgagePrincipal: Cents;
  capital: Cents;
  kept: Cents;
  /** "You keep $X of every $1,000 of rent" */
  keptPer1000: number;
  expenseRatio: number;
  hasMortgageData: boolean;
  /** True when a Silver property's rough monthly payment was used (no interest/principal split). */
  mortgageIsRough: boolean;
}

export function picture(state: AppState, from: ISODate, to: ISODate, opts: { propertyId?: string } = {}): Picture {
  // A property archived (sold) during the period still counts for it: its rent and costs up to that day are real.
  const props = state.properties.filter((p) => (!p.archived || (!!p.archivedOn && p.archivedOn >= from)) && (!opts.propertyId || p.id === opts.propertyId));
  const propIds = new Set(props.map((p) => p.id));
  const units = state.units.filter((u) => propIds.has(u.propertyId));
  const unitIds = new Set(units.map((u) => u.id));
  const leases = state.leases.filter((l) => unitIds.has(l.unitId));
  const leaseIds = new Set(leases.map((l) => l.id));

  const rentCollected = state.payments
    .filter((p) => !p.voided && leaseIds.has(p.leaseId) && p.date >= from && p.date <= to)
    .reduce((a, p) => a + p.amount, 0);

  // Expected rent = charges falling due inside the window.
  let rentExpected = 0;
  let paidForThose = 0;
  for (const l of leases) {
    for (const line of leaseLedger(l, state.payments, to, periodOf(to))) {
      if (line.due >= from && line.due <= to) { rentExpected += line.charge; paidForThose += Math.min(line.paid, line.charge); }
    }
  }
  const arrearsLoss = Math.max(0, rentExpected - paidForThose);

  // Vacancy: months inside the window where a unit had no lease covering it.
  let vacancyLoss = 0;
  for (const u of units) {
    for (const p of periodRange(periodOf(from), periodOf(to))) {
      const d = dueDate(p, 1);
      const covered = state.leases.some((l) => l.unitId === u.id && periodOf(l.start) <= p && (!l.end || periodOf(l.end) >= p));
      if (!covered && d >= from && d <= to && u.status !== 'occupied') vacancyLoss += u.rent;
    }
  }

  let opex = 0, capital = 0;
  for (const e of state.expenses) {
    if (!propIds.has(e.propertyId) || e.date < from || e.date > to) continue;
    const prop = props.find((p) => p.id === e.propertyId)!;
    const portion = rentalPortion(e, prop.rentalSharePct);
    if (e.kind === 'capital') capital += portion; else opex += portion;
  }

  // Mortgage: the full record when there is one (Gold), else the rough monthly payment (Silver), else nothing.
  let mortgageInterest = 0, mortgagePrincipal = 0, hasMortgageData = false, mortgageIsRough = false;
  const months = Math.max(0, periodRange(periodOf(from), periodOf(to)).length);
  for (const prop of props) {
    const m = state.mortgages.find((x) => x.propertyId === prop.id);
    if (m) {
      hasMortgageData = true;
      const paid = mortgagePaidBetween(m, from, to);
      mortgageInterest += Math.round((paid.interest * prop.rentalSharePct) / 100);
      mortgagePrincipal += Math.round((paid.principal * prop.rentalSharePct) / 100);
    } else if (prop.approxMortgagePayment) {
      hasMortgageData = true; mortgageIsRough = true;
      mortgageInterest += Math.round((prop.approxMortgagePayment * months * prop.rentalSharePct) / 100);
    }
  }

  const noi = rentCollected - opex;
  const kept = noi - mortgageInterest - mortgagePrincipal - capital;
  return {
    from, to, rentCollected, rentExpected, arrearsLoss, vacancyLoss, opex, noi,
    mortgageInterest, mortgagePrincipal, capital, kept, hasMortgageData, mortgageIsRough,
    keptPer1000: rentCollected > 0 ? Math.round((kept / rentCollected) * 1000) : 0,
    expenseRatio: rentCollected > 0 ? (opex / rentCollected) * 100 : 0,
  };
}

// =====================================================================================
// Property value (owner, 2026-11-14: "remove the property valuation as it does not appear to be accurate").
// Keyholder does not estimate home values. The value is the landlord's own latest estimate or appraisal, or else
// what they paid. What is owed comes from the mortgage (or the landlord's rough figure). Yours = value × share − owed.
// =====================================================================================

export type ValueBasis = 'owner' | 'purchase' | 'none';
export interface ValueInfo { value: Cents; basis: ValueBasis; source: string; asOf: ISODate }

/** The landlord's own latest estimate or appraisal for a property (on or before a date). */
export function ownEstimate(state: AppState, propertyId: string, asOf?: ISODate): Valuation | undefined {
  let best: Valuation | undefined;
  for (const v of state.valuations) {
    if (v.propertyId !== propertyId || (v.source !== 'owner' && v.source !== 'assessment') || (asOf && v.date > asOf)) continue;
    if (!best || v.date >= best.date) best = v;
  }
  return best;
}

/** The value used everywhere: your own latest estimate or appraisal, else what you paid. */
export function propertyValue(state: AppState, prop: Property, today: ISODate): ValueInfo {
  const own = ownEstimate(state, prop.id, today);
  if (own) return { value: own.likely, basis: 'owner', source: `${own.source === 'assessment' ? 'Your appraisal' : 'Your estimate'}, ${fmtDate(own.date)}`, asOf: own.date };
  if (prop.purchasePrice) return { value: prop.purchasePrice, basis: 'purchase', source: `What you paid${prop.purchaseDate ? ` in ${prop.purchaseDate.slice(0, 4)}` : ''}`, asOf: prop.purchaseDate ?? today };
  return { value: 0, basis: 'none', source: 'Add what you paid', asOf: today };
}

/** The value on a past date: your estimate made by then, else what you paid (once bought). */
function valueAt(state: AppState, prop: Property, date: ISODate): Cents {
  const own = ownEstimate(state, prop.id, date);
  if (own) return own.likely;
  return prop.purchasePrice && (!prop.purchaseDate || prop.purchaseDate <= date) ? prop.purchasePrice : 0;
}

// =====================================================================================
// Portfolio: net worth (whole property × your ownership) and its history
// =====================================================================================
export interface PortfolioRow { property: Property; value: Cents; owed: Cents; yours: Cents; earned: Cents; returnPct: number | null; valueInfo: ValueInfo; owedKnown: boolean }

/** What is owed on a date. A rough balance (Silver) only counts for today. */
export function owedAt(state: AppState, prop: Property, date: ISODate, today: ISODate = date): { owed: Cents; known: boolean } {
  if (prop.mortgageFree) return { owed: 0, known: true };
  const m = state.mortgages.find((x) => x.propertyId === prop.id);
  if (m) return date >= m.startDate ? { owed: mortgageBalanceAt(m, date), known: true } : { owed: 0, known: false };
  if (prop.approxMortgageBalance !== undefined) return { owed: prop.approxMortgageBalance, known: date === today };
  return { owed: 0, known: false };
}

export function portfolio(state: AppState, today: ISODate) {
  const rows: PortfolioRow[] = state.properties.filter((p) => !p.archived).map((p) => {
    const own = p.ownershipPct / 100;
    const vi = propertyValue(state, p, today);
    const o = owedAt(state, p, today);
    const w = worthIt(state, today, { propertyId: p.id });
    return { property: p, value: Math.round(vi.value * own), owed: Math.round(o.owed * own), yours: Math.round((vi.value - o.owed) * own), earned: w.total, returnPct: w.returnPct, valueInfo: vi, owedKnown: o.known };
  }).sort((a, b) => b.value - a.value);
  // Net worth only counts properties with a value and a known mortgage (or paid off); others are listed, not guessed.
  const counted = rows.filter((r) => r.owedKnown && r.valueInfo.basis !== 'none');
  const total = (k: 'value' | 'owed' | 'yours') => counted.reduce((a, r) => a + r[k], 0);
  return {
    rows, value: total('value'), owed: total('owed'), yours: total('yours'),
    noValue: rows.filter((r) => r.valueInfo.basis === 'none').map((r) => r.property),
    notCounted: rows.filter((r) => !r.owedKnown && r.valueInfo.basis !== 'none').map((r) => r.property),
  };
}

/**
 * Net worth over time: one point at each year end since the first purchase, plus today. Values are what you paid,
 * or your own estimate from that time; mortgage balances come from the amortization schedule. A property joins the
 * line once both are known at that date.
 */
export function netWorthHistory(state: AppState, today: ISODate): { date: ISODate; yours: Cents; value: Cents; owed: Cents }[] {
  const props = state.properties.filter((p) => !p.archived && p.purchaseDate && p.purchasePrice);
  if (!props.length) return [];
  const first = props.map((p) => p.purchaseDate!).sort()[0];
  const dates: ISODate[] = [];
  for (let y = Number(first.slice(0, 4)); y < Number(today.slice(0, 4)); y++) dates.push(`${y}-12-31`);
  dates.push(today);
  return dates.map((d) => {
    let value = 0, owed = 0;
    for (const p of props) {
      if (p.purchaseDate! > d) continue;
      const o = owedAt(state, p, d, today);
      if (!o.known && d !== today) continue;
      const own = p.ownershipPct / 100;
      value += Math.round(valueAt(state, p, d) * own); owed += Math.round(o.owed * own);
    }
    return { date: d, value, owed, yours: value - owed };
  }).filter((x) => x.value > 0);
}

export interface WorthIt {
  value: Cents; debt: Cents; equity: Cents;
  cashFlow: Cents; principalPaid: Cents;
  total: Cents;
  /** Return on the owner's money. Null unless every property has a value (what you paid, or your estimate). */
  returnPct: number | null;
  benchmarkPct: number;
  diffPts: number | null;
  /** Properties with no value yet (no purchase price and no estimate of your own). */
  noValue: string[];
  missing: string[];
}

/**
 * What the rental part earned in the last 12 months: rent left over after costs, plus mortgage paid down, on your
 * money in it (value − what is owed). No estimated value growth.
 */
export function worthIt(state: AppState, today: ISODate, opts: { propertyId?: string } = {}): WorthIt {
  const from = addDays(addMonths(today, -12), 1);
  const props = state.properties.filter((p) => !p.archived && (!opts.propertyId || p.id === opts.propertyId));
  const missing: string[] = [];
  const noValue: string[] = [];
  let value = 0, debt = 0, principalPaid = 0, cashFlow = 0;

  for (const prop of props) {
    const own = prop.ownershipPct / 100;
    const share = (prop.rentalSharePct / 100) * own;
    const pv = propertyValue(state, prop, today);
    if (pv.basis === 'none') { noValue.push(prop.nickname); missing.push(prop.nickname); }
    value += Math.round(pv.value * share);

    const m = state.mortgages.find((x) => x.propertyId === prop.id);
    if (m) {
      const rows = amortization(m);
      debt += Math.round(mortgageBalanceAt(m, today, rows) * share);
      principalPaid += Math.round(mortgagePaidBetween(m, from, today, rows).principal * share);
    } else if (prop.approxMortgageBalance) {
      debt += Math.round(prop.approxMortgageBalance * share);
    }

    cashFlow += Math.round(picture(state, from, today, { propertyId: prop.id }).kept * own);
  }

  const equity = value - debt;
  const total = cashFlow + principalPaid;
  const returnPct = noValue.length === 0 && equity > 0 ? (total / equity) * 100 : null;
  return {
    value, debt, equity, cashFlow, principalPaid, total, returnPct,
    benchmarkPct: benchmarks().gic.pct,
    diffPts: returnPct === null ? null : returnPct - benchmarks().gic.pct,
    noValue, missing,
  };
}

export function verdict(w: WorthIt): string {
  if (w.returnPct === null) return 'Add what you paid to compare with a GIC.';
  return `Your property earned ${w.returnPct.toFixed(1)}% this year. A 5-year GIC would have paid ${w.benchmarkPct.toFixed(1)}%.`;
}

/** Short label for the verdict: ahead of, about the same as, or behind a GIC. */
export function verdictTag(w: WorthIt): { text: string; tone: 'good' | 'even' | 'bad' } | null {
  if (w.diffPts === null) return null;
  if (w.diffPts >= 0.25) return { text: 'Ahead of a GIC', tone: 'good' };
  if (w.diffPts <= -0.25) return { text: 'Behind a GIC', tone: 'bad' };
  return { text: 'About the same as a GIC', tone: 'even' };
}

// =====================================================================================
// Tax Pack (basic at Bronze, full at Gold) — T776-structured summary, CCA schedule, pre-flight
// =====================================================================================

export interface CCARow { cls: string; label: string; ratePct: number; opening: Cents; additions: Cents; base: Cents; maxCCA: Cents; claimed: Cents; closing: Cents }

export interface TaxPack {
  year: number;
  grossRents: Cents;
  /** label = plain words for the owner; craLabel = the official T776 wording for the accountant. */
  lines: { t776: string; label: string; craLabel: string; amount: Cents; count: number }[];
  totalExpenses: Cents;
  netBeforeCCA: Cents;
  cca: CCARow[];
  ccaClaimed: Cents;
  netIncome: Cents;
  ownerShare: Cents;
  preflight: { id: string; text: string; severity: 'fix' | 'check' }[];
}

/** Undepreciated capital cost of the building (class 1) at purchase: price minus land, plus acquisition costs and day-one improvements. */
export function buildingCostBase(prop: Property): Cents {
  const price = prop.purchasePrice ?? 0;
  const landPct = prop.landValuePct ?? 30;
  const acq = (prop.closingCosts ?? 0) + (prop.landTransferTax ?? 0);
  const buildingShare = 1 - landPct / 100;
  return Math.round((price + acq) * buildingShare + (prop.improvementsAtPurchase ?? 0));
}

/** Adjusted cost base for capital-gain estimates. */
export function adjustedCostBase(state: AppState, prop: Property): Cents {
  const capex = state.expenses.filter((e) => e.propertyId === prop.id && e.kind === 'capital').reduce((a, e) => a + e.amount, 0);
  return (prop.purchasePrice ?? 0) + (prop.closingCosts ?? 0) + (prop.landTransferTax ?? 0) + (prop.improvementsAtPurchase ?? 0) + capex;
}

export function ccaSchedule(state: AppState, prop: Property, year: number, netBeforeCCA: Cents): CCARow[] {
  const share = prop.rentalSharePct / 100;
  const purchaseYear = prop.purchaseDate ? Number(prop.purchaseDate.slice(0, 4)) : year;
  const rows: CCARow[] = [];
  for (const c of CCA_CLASSES) {
    if (c.ratePct === 0) continue;
    // Assume (stage 1 simplification) maximum CCA was claimed each prior year when CCA is on.
    let ucc = 0;
    for (let y = purchaseYear; y <= year; y++) {
      let additions = state.expenses
        .filter((e) => e.propertyId === prop.id && e.kind === 'capital' && e.ccaClass === c.id && Number(e.date.slice(0, 4)) === y)
        .reduce((a, e) => a + rentalPortion(e, prop.rentalSharePct), 0);
      if (c.id === '1' && y === purchaseYear) additions += Math.round(buildingCostBase(prop) * share);
      const base = ucc + additions / 2; // half-year rule
      const maxCCA = Math.round(base * (c.ratePct / 100));
      if (y === year) {
        rows.push({ cls: c.id, label: c.label, ratePct: c.ratePct, opening: ucc, additions, base: Math.round(base), maxCCA, claimed: 0, closing: ucc + additions });
      } else {
        ucc = ucc + additions - maxCCA;
      }
    }
  }
  // CCA cannot create or increase a rental loss: cap the total at net income before CCA.
  const relevant = rows.filter((r) => r.opening + r.additions > 0);
  const totalMax = relevant.reduce((a, r) => a + r.maxCCA, 0);
  const cap = Math.max(0, netBeforeCCA);
  const factor = totalMax > 0 ? Math.min(1, cap / totalMax) : 0;
  for (const r of relevant) {
    r.claimed = prop.claimCCA ? Math.round(r.maxCCA * factor) : 0;
    r.closing = r.opening + r.additions - r.claimed;
  }
  return relevant;
}

/**
 * The first day of the year with anything recorded for this property (rent or a cost). Someone who starts
 * using Keyholder part way through the year has records from that day; the spreadsheet says so.
 */
export function recordsStart(state: AppState, prop: Property, year: number): ISODate {
  const y0 = `${year}-01-01`, y1 = `${year}-12-31`;
  const units = new Set(state.units.filter((u) => u.propertyId === prop.id).map((u) => u.id));
  const leaseIds = new Set(state.leases.filter((l) => units.has(l.unitId)).map((l) => l.id));
  const dates = [
    ...state.payments.filter((p) => !p.voided && leaseIds.has(p.leaseId)).map((p) => p.date),
    ...state.expenses.filter((e) => e.propertyId === prop.id).map((e) => e.date),
  ].filter((d) => d >= y0 && d <= y1).sort();
  return dates[0] ?? y0;
}

/** The T776 numbers for a property and year; `start` limits them to a later first day (records kept from then). */
export function taxPack(state: AppState, prop: Property, year: number, start?: ISODate): TaxPack {
  const y0 = `${year}-01-01`, to = `${year}-12-31`;
  const from = start && start > y0 && start <= to ? start : y0;
  const units = state.units.filter((u) => u.propertyId === prop.id).map((u) => u.id);
  const leaseIds = new Set(state.leases.filter((l) => units.includes(l.unitId)).map((l) => l.id));
  const grossRents = state.payments.filter((p) => !p.voided && leaseIds.has(p.leaseId) && p.date >= from && p.date <= to).reduce((a, p) => a + p.amount, 0);

  const exps = state.expenses.filter((e) => e.propertyId === prop.id && e.date >= from && e.date <= to);
  const byLine = new Map<string, TaxPack['lines'][number]>();
  for (const e of exps) {
    if (e.kind !== 'current' || e.scope === 'personal') continue;
    const cat = CATEGORIES.find((c) => c.id === e.category)!;
    const line = byLine.get(cat.t776) ?? { t776: cat.t776, label: cat.label, craLabel: cat.t776Label, amount: 0, count: 0 };
    line.amount += rentalPortion(e, prop.rentalSharePct);
    line.count++;
    byLine.set(cat.t776, line);
  }
  const m = state.mortgages.find((x) => x.propertyId === prop.id);
  if (m) {
    const interest = Math.round((mortgagePaidBetween(m, from, to).interest * prop.rentalSharePct) / 100);
    const line = byLine.get('8710') ?? { t776: '8710', label: '', craLabel: 'Interest and bank charges', amount: 0, count: 0 };
    line.amount += interest;
    line.label = 'Mortgage interest and bank fees';
    byLine.set('8710', line);
  }
  const lines = [...byLine.values()].sort((a, b) => a.t776.localeCompare(b.t776));
  const totalExpenses = lines.reduce((a, l) => a + l.amount, 0);
  const netBeforeCCA = grossRents - totalExpenses;
  // Depreciation needs the full purchase picture (Gold).
  const cca = hasGold(state, prop) ? ccaSchedule(state, prop, year, netBeforeCCA) : [];
  const ccaClaimed = cca.reduce((a, r) => a + r.claimed, 0);
  const netIncome = netBeforeCCA - ccaClaimed;

  // Pre-flight checklist (TX-3)
  const preflight: TaxPack['preflight'] = [];
  const noReceipt = exps.filter((e) => !e.receiptImage && !e.cashNoReceipt);
  if (noReceipt.length) preflight.push({ id: 'receipts', text: `${noReceipt.length} expense${noReceipt.length > 1 ? 's have' : ' has'} no receipt photo`, severity: 'fix' });
  const cash = exps.filter((e) => e.cashNoReceipt && !e.receiptImage);
  if (cash.length) preflight.push({ id: 'cash', text: `${cash.length} cost${cash.length > 1 ? 's' : ''} paid in cash with no receipt. The record is kept; a short signed note from the person you paid is even better.`, severity: 'check' });
  const noClass = exps.filter((e) => e.kind === 'capital' && !e.ccaClass);
  if (noClass.length) preflight.push({ id: 'cca-class', text: `${noClass.length} upgrade${noClass.length > 1 ? 's need' : ' needs'} a depreciation type`, severity: 'fix' });
  const other = exps.filter((e) => e.category === 'other');
  if (other.length) preflight.push({ id: 'other', text: `${other.length} expense${other.length > 1 ? 's are' : ' is'} marked "Something else". Pick a type.`, severity: 'check' });
  if (!exps.some((e) => e.category === 'property-tax')) preflight.push({ id: 'ptax', text: 'No property tax added this year', severity: 'check' });
  if (!exps.some((e) => e.category === 'insurance')) preflight.push({ id: 'ins', text: 'No insurance added this year', severity: 'check' });
  if (m) preflight.push({ id: 'mstatement', text: "Check the interest matches your bank's yearly mortgage statement", severity: 'check' });
  // Unusual amounts: more than 3x the median of their category.
  for (const cat of new Set(exps.map((e) => e.category))) {
    const amts = exps.filter((e) => e.category === cat).map((e) => e.amount).sort((a, b) => a - b);
    if (amts.length < 3) continue;
    const med = amts[Math.floor(amts.length / 2)];
    const big = amts.filter((a) => a > med * 3).length;
    if (big) preflight.push({ id: `unusual-${cat}`, text: `${big} large ${CATEGORIES.find((c) => c.id === cat)!.label.toLowerCase()} expense${big > 1 ? 's' : ''}. Was it an upgrade?`, severity: 'check' });
  }
  if (prop.ownerOccupied && prop.claimCCA) preflight.push({ id: 'cca-pre', text: 'Depreciation is on for a home you live in. This can affect tax when you sell. Ask your accountant.', severity: 'check' });

  return { year, grossRents, lines, totalExpenses, netBeforeCCA, cca, ccaClaimed, netIncome, ownerShare: Math.round(netIncome * (prop.ownershipPct / 100)), preflight };
}
