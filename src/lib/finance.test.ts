import { describe, expect, it } from 'vitest';
import type { AppState, Lease, Mortgage, Payment, Property, Valuation } from '../data/types';
import {
  amortization, buildingCostBase, ccaSchedule, chargeState,
  leaseBalance, leaseLedger, mortgageBalanceAt, mortgagePaidBetween, mortgagePayment, periodicRate, propertyValue, rentalPortion,
  worthIt,
} from './finance';
import { propertyLevel } from './levels';
import { addMonths, dueDate, periodRange } from './dates';
import { parseMoney } from './money';

const prop = (o: Partial<Property> = {}): Property => ({
  id: 'p1', nickname: 'Test', address: '1 Main', city: 'Hamilton', province: 'ON', type: 'duplex',
  rentalSharePct: 100, ownerOccupied: false, ownershipPct: 100, claimCCA: true, ...o,
});

describe('money', () => {
  it('parses typed amounts into cents', () => {
    expect(parseMoney('1,650')).toBe(165000);
    expect(parseMoney('$1650.5')).toBe(165050);
    expect(parseMoney('')).toBeNaN();
  });
});

describe('dates', () => {
  it('clamps due dates and month additions to month length', () => {
    expect(dueDate('2026-02', 31)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(periodRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('rental share split (PS-6)', () => {
  it('splits shared costs, keeps direct costs whole, drops personal costs', () => {
    expect(rentalPortion({ amount: 100000, scope: 'shared' }, 35)).toBe(35000);
    expect(rentalPortion({ amount: 100000, scope: 'direct' }, 35)).toBe(100000);
    expect(rentalPortion({ amount: 100000, scope: 'personal' }, 35)).toBe(0);
  });
});

describe('rent ledger', () => {
  const lease: Lease = {
    id: 'l1', unitId: 'u1', tenantId: 't1', start: '2026-09-01', rent: 165000, dueDay: 1,
    paymentMethod: 'etransfer', lmrDeposit: 165000, utilities: '', parking: false, pets: false, emailNoticeConsent: true,
  };
  const pay = (period: string, amount: number, date = `${period}-01`): Payment => ({
    id: `${period}-${amount}`, leaseId: 'l1', period, amount, date, method: 'etransfer', source: 'manual', createdAt: date,
  });

  it('is late the day after it is due', () => {
    expect(chargeState(1000, 0, '2026-11-01', '2026-11-01').state).toBe('due');
    expect(chargeState(1000, 0, '2026-11-01', '2026-11-02')).toEqual({ state: 'late', daysLate: 1 });
    expect(chargeState(1000, 500, '2026-11-01', '2026-11-04').state).toBe('partial');
    expect(chargeState(1000, 1000, '2026-11-01', '2026-11-04').state).toBe('paid');
  });

  it('builds one charge per period with a running balance', () => {
    const lines = leaseLedger(lease, [pay('2026-09', 165000), pay('2026-10', 100000)], '2026-11-08');
    expect(lines.map((l) => l.state)).toEqual(['paid', 'partial', 'late']);
    expect(lines[2].balance).toBe(65000 + 165000);
    expect(leaseBalance(lease, [pay('2026-09', 165000), pay('2026-10', 100000)], '2026-11-08')).toBe(230000);
  });

  it('ignores voided payments', () => {
    const p = { ...pay('2026-09', 165000), voided: true };
    expect(leaseLedger(lease, [p], '2026-09-10')[0].state).toBe('late');
  });
});

describe('Canadian mortgage math (semi-annual compounding)', () => {
  const m: Mortgage = {
    id: 'm1', propertyId: 'p1', lender: 'RBC', principal: 40_000_000, startDate: '2026-01-01',
    ratePct: 5, amortYears: 25, termEnd: '2031-01-01', frequency: 'monthly',
  };

  it('derives the periodic rate from semi-annual compounding', () => {
    expect(periodicRate(5, 12)).toBeCloseTo(0.00412392, 7);
  });

  it('matches the standard payment for $400k at 5% over 25 years', () => {
    expect(mortgagePayment(40_000_000, 5, 25, 'monthly')).toBe(232642);
  });

  it('amortises to zero with principal + interest = payment', () => {
    const rows = amortization(m);
    expect(rows.length).toBe(300);
    expect(rows[rows.length - 1].balance).toBe(0);
    expect(rows[0].interest).toBe(Math.round(40_000_000 * periodicRate(5, 12)));
    expect(rows[0].interest + rows[0].principal).toBe(232642);
  });

  it('reports balance and principal/interest paid in a window', () => {
    const rows = amortization(m);
    const paid = mortgagePaidBetween(m, '2026-01-01', '2027-01-01', rows);
    expect(paid.count).toBe(12);
    expect(mortgageBalanceAt(m, '2027-01-01', rows)).toBe(40_000_000 - paid.principal);
    expect(paid.interest + paid.principal).toBe(12 * 232642);
  });

  it('handles accelerated bi-weekly payments', () => {
    const rows = amortization({ ...m, frequency: 'biweekly' });
    expect(rows[1].date).toBe('2026-01-29');
    expect(rows[rows.length - 1].balance).toBe(0);
  });
});

describe('property value: your own estimate, else what you paid (Keyholder does not estimate values)', () => {
  const today = '2026-11-08';
  const st = (p: Property, valuations: Valuation[] = []) => ({ properties: [p], valuations, units: [], leases: [], payments: [], expenses: [], mortgages: [] }) as unknown as AppState;
  const v = (o: Partial<Valuation>): Valuation => ({ id: 'v', propertyId: 'p1', date: '2026-10-01', source: 'owner', low: 1, likely: 1, high: 1, confidence: 'low', ...o });
  const bought = prop({ purchasePrice: 50_000_000, purchaseDate: '2020-05-01' });

  it('is what you paid until you add your own estimate', () => {
    expect(propertyValue(st(bought), bought, today)).toMatchObject({ value: 50_000_000, basis: 'purchase', source: 'What you paid in 2020' });
  });
  it('uses your latest own estimate or appraisal (not one dated after today)', () => {
    const s = st(bought, [v({ id: 'a', date: '2025-01-10', likely: 55_000_000 }), v({ id: 'b', date: '2026-09-01', source: 'assessment', likely: 60_000_000 }), v({ id: 'c', date: '2027-01-01', likely: 99_000_000 })]);
    expect(propertyValue(s, bought, today)).toMatchObject({ value: 60_000_000, basis: 'owner', asOf: '2026-09-01' });
    expect(propertyValue(s, bought, today).source).toMatch(/^Your appraisal/);
  });
  it('ignores estimates saved by earlier versions (automated, price trend, nearby sales)', () => {
    const s = st(bought, [v({ source: 'avm', likely: 90_000_000 }), v({ source: 'index', likely: 80_000_000 }), v({ source: 'comparables', likely: 70_000_000 })]);
    expect(propertyValue(s, bought, today).value).toBe(50_000_000);
  });
  it('has no value without a purchase price or an estimate of your own', () => {
    expect(propertyValue(st(prop()), prop(), today)).toMatchObject({ value: 0, basis: 'none' });
  });
});

describe('CCA (phase 3)', () => {
  const base = prop({ purchasePrice: 60_000_000, purchaseDate: '2026-03-01', closingCosts: 0, landTransferTax: 0, landValuePct: 25 });
  const state = { expenses: [] } as unknown as AppState;

  it('excludes land from the building cost base', () => {
    expect(buildingCostBase(base)).toBe(45_000_000);
  });

  it('applies the half-year rule in the purchase year', () => {
    const [row] = ccaSchedule(state, base, 2026, 10_000_000);
    expect(row.maxCCA).toBe(Math.round(45_000_000 / 2 * 0.04));
    expect(row.claimed).toBe(row.maxCCA);
  });

  it('never creates a rental loss', () => {
    const [row] = ccaSchedule(state, base, 2026, 100_000);
    expect(row.claimed).toBe(100_000);
    const [none] = ccaSchedule(state, base, 2026, -50_000);
    expect(none.claimed).toBe(0);
  });

  it('claims nothing when CCA is off', () => {
    const [row] = ccaSchedule(state, { ...base, claimCCA: false }, 2026, 10_000_000);
    expect(row.claimed).toBe(0);
  });
});

describe('levels, and what a property earns', () => {
  const base = (o: Partial<Property> = {}) => prop({ id: 'p1', city: 'Hamilton', ...o });
  const state = (p: Property, extra: Partial<AppState> = {}) => ({
    properties: [p], units: [{ id: 'u1', propertyId: 'p1', label: 'A', rent: 200000, bedrooms: 2, utilitiesIncluded: [], status: 'occupied' }],
    leases: [], payments: [], expenses: [], valuations: [], comparables: [], mortgages: [], tenants: [], ...extra,
  }) as unknown as AppState;

  it('without what you paid there is no value, so no return to compare yet', () => {
    const w = worthIt(state(base()), '2026-11-08');
    expect(w.noValue).toEqual(['Test']);
    expect(w.value).toBe(0);
    expect(w.returnPct).toBeNull(); // no GIC comparison until Silver
  });

  it('the return is rent left over plus mortgage paid down, on your money; no estimated growth', () => {
    const b = base({ purchasePrice: 50_000_000, purchaseDate: '2020-01-01', approxMortgageBalance: 30_000_000 });
    const w = worthIt(state(b), '2026-11-08');
    expect(w.value).toBe(50_000_000);
    expect(w.equity).toBe(20_000_000);
    expect(w.total).toBe(w.cashFlow + w.principalPaid);
    expect(w.returnPct).toBeCloseTo((w.total / 20_000_000) * 100, 6);
  });

  it('moves Bronze → Silver → Gold as details are added', () => {
    const b = base();
    expect(propertyLevel(state(b), b)).toBe('bronze');
    const s = base({ purchasePrice: 50_000_000, purchaseDate: '2020-01-01' });
    expect(propertyLevel(state(s), s)).toBe('silver');
    const g = { ...s, closingCosts: 0, landTransferTax: 600_000, mortgageFree: true };
    expect(propertyLevel(state(g), g)).toBe('gold');
    expect(worthIt(state(s), '2026-11-08').returnPct).not.toBeNull();
  });
});

describe('portfolio and net worth history', () => {
  it('sums worth, owed and yours; history starts when value and mortgage are both known', async () => {
    const { seedState } = await import('../data/seed');
    const { portfolio, netWorthHistory } = await import('./finance');
    const s = seedState(undefined, '2026-11-08');
    const pf = portfolio(s, '2026-11-08');
    expect(pf.yours).toBe(pf.value - pf.owed);
    expect(pf.rows[0].value).toBeGreaterThanOrEqual(pf.rows[1].value);
    const h = netWorthHistory(s, '2026-11-08');
    expect(h[0].date).toBe('2019-12-31'); // Maple duplex: bought June 2019, mortgage from July 2019
    expect(h[h.length - 1].date).toBe('2026-11-08');
    expect(h.every((x) => x.yours === x.value - x.owed)).toBe(true);
  });
});

describe('late-rent notices', () => {
  it('uses the shorter N4 period from Sept 21, 2026 and adds days for mail', async () => {
    const { terminationDate } = await import('./notices');
    expect(terminationDate('2026-09-01', 'hand')).toBe('2026-09-15');
    expect(terminationDate('2026-11-08', 'hand')).toBe('2026-11-15');
    expect(terminationDate('2026-11-08', 'mail')).toBe('2026-11-20');
  });
  it('claims rent only, for periods already due', async () => {
    const { seedState } = await import('../data/seed');
    const { arrears } = await import('./notices');
    const s = seedState(undefined, '2026-11-08');
    const lease = s.leases.find((l) => l.id === 'l-patel')!;
    const a = arrears(s, lease, '2026-11-08');
    expect(a.total).toBe(145_000);
    expect(a.periods.map((p) => p.period)).toEqual(['2026-11']);
  });
});

describe('mortgage extra payments', () => {
  it('takes lump sums straight off the balance and pays off sooner', () => {
    const m: Mortgage = { id: 'm', propertyId: 'p', lender: 'X', principal: 40_000_000, startDate: '2026-01-01', ratePct: 5, amortYears: 25, termEnd: '2031-01-01', frequency: 'monthly' };
    const base = amortization(m);
    const extra = amortization({ ...m, prepayments: [{ date: '2026-06-15', amount: 2_000_000 }] });
    expect(extra.length).toBeLessThan(base.length);
    const juneBase = base.find((r) => r.date === '2026-07-01')!;
    const juneExtra = extra.find((r) => r.date === '2026-07-01')!;
    expect(juneBase.balance - juneExtra.balance).toBeGreaterThan(2_000_000 - 1_000);
  });
});
