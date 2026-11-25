import { describe, expect, it } from 'vitest';
import { seedState } from '../data/seed';
import type { Expense } from '../data/types';
import { improvements, improvementsCsv, leaseLedger, picture, taxPack } from './finance';

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
  it('counts every month owned, from the purchase date, rented or vacant', () => {
    const s = base();
    const prop = s.properties.find((p) => s.mortgages.some((m) => m.propertyId === p.id))!;
    const units = new Set(s.units.filter((u) => u.propertyId === prop.id).map((u) => u.id));
    const leases = new Set(s.leases.filter((l) => units.has(l.unitId)).map((l) => l.id));
    // Nothing recorded and no tenants (vacant): the mortgage is still paid.
    s.payments = s.payments.filter((p) => !leases.has(p.leaseId));
    s.leases = s.leases.filter((l) => !leases.has(l.id));
    s.expenses = s.expenses.filter((e) => e.propertyId !== prop.id);
    s.income = [];
    delete prop.recordsFrom;
    prop.purchaseDate = '2026-02-01';
    const fromFeb = picture(s, '2026-01-01', today, { propertyId: prop.id });
    const feb = picture(base(), '2026-02-01', today, { propertyId: prop.id });
    expect(fromFeb.mortgageInterest + fromFeb.mortgagePrincipal).toBeGreaterThan(0);
    expect(fromFeb.mortgageInterest + fromFeb.mortgagePrincipal).toBe(feb.mortgageInterest + feb.mortgagePrincipal);
  });
  it('paid-up months count as money in, with the mortgage over the same months', () => {
    const s = base();
    const prop = s.properties.find((p) => s.mortgages.some((m) => m.propertyId === p.id))!;
    const units = new Set(s.units.filter((u) => u.propertyId === prop.id).map((u) => u.id));
    const ls = s.leases.filter((l) => units.has(l.unitId));
    const ids = new Set(ls.map((l) => l.id));
    s.payments = s.payments.filter((p) => !ids.has(p.leaseId));
    s.expenses = s.expenses.filter((e) => e.propertyId !== prop.id);
    s.income = [];
    delete prop.recordsFrom;
    // The landlord said: everyone is paid up through November.
    const lease = ls.find((l) => !l.end)!;
    lease.start = '2026-01-01'; lease.paidThrough = '2026-11';
    const pic = picture(s, '2026-01-01', today, { propertyId: prop.id });
    expect(pic.rentCollected).toBeGreaterThanOrEqual(lease.rent * 11);
    expect(pic.mortgageInterest + pic.mortgagePrincipal).toBeGreaterThan(0);
  });
  it('paid-up months count as rent received on the Taxes page', () => {
    const s = base();
    const prop = s.properties.find((p) => s.mortgages.some((m) => m.propertyId === p.id))!;
    const units = new Set(s.units.filter((u) => u.propertyId === prop.id).map((u) => u.id));
    const ls = s.leases.filter((l) => units.has(l.unitId));
    const ids = new Set(ls.map((l) => l.id));
    s.payments = s.payments.filter((p) => !ids.has(p.leaseId));
    for (const l of ls) { l.start = '2026-01-01'; delete l.end; l.paidThrough = '2026-10'; }
    const pack = taxPack(s, prop, 2026);
    expect(pack.grossRents).toBe(ls.reduce((a, l) => a + l.rent * 10, 0));
  });
  it('prorates the first month by the move-in day', () => {
    const s = base();
    const lease = s.leases.find((l) => !l.end && l.dueDay === 1)!;
    lease.start = '2026-11-25'; lease.rent = 300000; delete lease.paidThrough;
    const line = leaseLedger(lease, [], '2026-11-30').find((l) => l.period === '2026-11')!;
    expect(line.charge).toBe(60000); // 6 of 30 days
    expect(line.due).toBe('2026-11-25');
  });
});
