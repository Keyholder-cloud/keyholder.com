import { describe, expect, it } from 'vitest';
import { seedState } from '../data/seed';
import type { Expense } from '../data/types';
import { improvements, improvementsCsv, picture, taxPack } from './finance';

const today = '2026-11-08';
const base = () => seedState(undefined, today);

describe('other income and improvements', () => {
  it('other income counts as money in; improvements are not taken off You kept', () => {
    const s = base();
    const before = picture(s, '2026-01-01', today);
    const prop = s.properties[0];
    s.income = [{ id: 'inc1', kind: 'bill', label: 'Enbridge Gas, October', amount: 6_000, date: '2026-10-20', method: 'etransfer', propertyId: prop.id, source: 'manual', createdAt: '2026-10-20T10:00:00Z' }];
    const roof: Expense = { ...s.expenses.find((e) => e.propertyId === prop.id)!, id: 'roof', kind: 'capital', amount: 1_200_000, date: '2026-09-01', vendor: 'Roofer', ccaClass: undefined };
    s.expenses.push(roof);
    const after = picture(s, '2026-01-01', today);
    expect(after.otherIncome).toBe(6_000);
    expect(after.capital).toBeGreaterThanOrEqual(before.capital + 1_200_000 * (prop.rentalSharePct / 100) - 1);
    // You kept moves by the other income only: the roof is kept apart.
    expect(after.kept - before.kept).toBe(6_000);
  });

  it('the tax summary has other income (8230) and the improvements spreadsheet lists each one, by class, with the cost base', () => {
    const s = base();
    const prop = s.properties[0];
    s.income = [{ id: 'inc2', kind: 'parking', label: 'Parking spot', amount: 5_000, date: '2026-03-01', method: 'cash', propertyId: prop.id, source: 'manual', createdAt: '2026-03-01T10:00:00Z' }];
    s.expenses.push({ ...s.expenses.find((e) => e.propertyId === prop.id)!, id: 'fridge', kind: 'capital', amount: 150_000, date: '2026-05-02', vendor: 'Home Depot', note: 'Fridge', ccaClass: '8' });
    s.expenses.push({ ...s.expenses.find((e) => e.propertyId === prop.id)!, id: 'win', kind: 'capital', amount: 400_000, date: '2026-06-02', vendor: 'Windows Co', note: undefined, ccaClass: undefined });
    expect(taxPack(s, prop, 2026).otherIncome).toBe(5_000);
    const imp = improvements(s, prop);
    expect(imp.needsClass).toBeGreaterThanOrEqual(1);
    const csv = improvementsCsv(s, prop);
    expect(csv).toContain('"Home Depot · Fridge"');
    expect(csv).toContain('"Class 8 — Appliances and equipment"');
    expect(csv).toContain('"Needs a class"');
    expect(csv).toMatch(/Adjusted cost base/);
  });
});

describe('mortgage in Money out', () => {
  it('counts only from when the property has records (nothing recorded: none)', () => {
    const s = base();
    const prop = s.properties.find((p) => s.mortgages.some((m) => m.propertyId === p.id))!;
    const units = new Set(s.units.filter((u) => u.propertyId === prop.id).map((u) => u.id));
    const leases = new Set(s.leases.filter((l) => units.has(l.unitId)).map((l) => l.id));
    // A new account: the property and its mortgage, nothing recorded yet.
    s.payments = s.payments.filter((p) => !leases.has(p.leaseId));
    s.expenses = s.expenses.filter((e) => e.propertyId !== prop.id);
    s.income = [];
    delete prop.recordsFrom;
    const empty = picture(s, '2026-01-01', today, { propertyId: prop.id });
    expect(empty.mortgageInterest + empty.mortgagePrincipal).toBe(0);
    // First record in November: only November's mortgage payment counts.
    s.expenses.push({ ...base().expenses.find((e) => e.propertyId === prop.id)!, id: 'nov', date: '2026-11-02' });
    const nov = picture(s, '2026-01-01', today, { propertyId: prop.id });
    const full = picture(base(), '2026-11-01', today, { propertyId: prop.id });
    expect(nov.mortgageInterest + nov.mortgagePrincipal).toBe(full.mortgageInterest + full.mortgagePrincipal);
  });
});
