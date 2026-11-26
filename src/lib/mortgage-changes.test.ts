import { describe, expect, it } from 'vitest';
import { seedState } from '../data/seed';
import { amortization, mortgagePaidBetween, mortgageTermsOn, picture, taxPack } from './finance';
import { yearCheck } from './taxyear';

const today = '2026-11-08';

describe('mortgage changes from a date', () => {
  it('a new rate and payment apply from their date; earlier payments stay the same', () => {
    const s = seedState(undefined, today);
    const m = s.mortgages[0];
    const before = amortization(m);
    m.changes = [{ from: '2026-06-01', ratePct: 5.5, payment: before[0].payment + 20000 }];
    const after = amortization(m);
    const early = before.filter((r) => r.date < '2026-06-01');
    expect(after.slice(0, early.length)).toEqual(early);
    const june = after.find((r) => r.date >= '2026-06-01')!;
    expect(june.payment).toBe(before[0].payment + 20000);
    expect(mortgageTermsOn(m, '2026-07-01').ratePct).toBe(5.5);
    expect(mortgageTermsOn(m, '2026-05-01').ratePct).toBe(m.ratePct);
  });

  it('a new rate with no payment works the payment out from the rate', () => {
    const s = seedState(undefined, today);
    const m = s.mortgages[0];
    const base = amortization(m).find((r) => r.date >= '2026-06-01')!.payment;
    m.changes = [{ from: '2026-06-01', ratePct: m.ratePct + 2 }];
    expect(amortization(m).find((r) => r.date >= '2026-06-01')!.payment).toBeGreaterThan(base);
  });

  it('property tax paid with the mortgage counts as property tax (Money out and Taxes), not mortgage', () => {
    const s = seedState(undefined, today);
    const m = s.mortgages[0];
    const prop = s.properties.find((p) => p.id === m.propertyId)!;
    s.expenses = s.expenses.filter((e) => !(e.propertyId === prop.id && e.category === 'property-tax'));
    const without = picture(s, '2026-01-01', today, { propertyId: prop.id });
    m.taxWithPayment = 45000;
    const withTax = picture(s, '2026-01-01', today, { propertyId: prop.id });
    const paid = mortgagePaidBetween(m, '2026-01-01', today);
    expect(paid.tax).toBe(45000 * paid.count);
    expect(withTax.mortgageInterest + withTax.mortgagePrincipal).toBe(without.mortgageInterest + without.mortgagePrincipal);
    expect(withTax.opex - without.opex).toBe(Math.round((paid.tax * prop.rentalSharePct) / 100));
    const pack = taxPack(s, prop, 2026);
    expect(pack.lines.find((l) => l.t776 === '9180')!.amount).toBeGreaterThan(0);
    expect(yearCheck(s, prop, 2026, today).gaps.some((g) => g.kind === 'property-tax')).toBe(false);
  });
});
