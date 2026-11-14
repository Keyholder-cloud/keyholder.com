import { describe, expect, it } from 'vitest';
import { seedState } from '../data/seed';
import { borrowingRoom, gainSincePurchase, rentVsMarket, roughSale } from './silver';
import { propertyValue } from './finance';

const today = '2026-11-08';

describe('Silver insights', () => {
  const s = seedState(undefined, today);
  const maple = s.properties.find((p) => p.id === 'p-maple')!;
  const birch = s.properties.find((p) => p.id === 'p-birch')!;

  it('worth is what you paid; a gain shows only once you add your own estimate', () => {
    const m = structuredClone(s);
    m.valuations = m.valuations.filter((v) => v.propertyId !== 'p-maple' || v.source === 'purchase');
    expect(propertyValue(m, maple, today).value).toBe(61_500_000);
    expect(gainSincePurchase(m, maple, today)).toBeNull();
    m.valuations.push({ id: 'v-own', propertyId: 'p-maple', date: '2026-10-01', source: 'owner', low: 70_000_000, likely: 72_000_000, high: 74_000_000, confidence: 'low' });
    expect(gainSincePurchase(m, maple, today)).toMatchObject({ value: 72_000_000, paid: 61_500_000, gain: 10_500_000 });
    expect(gainSincePurchase(m, birch, today)).toBeNull(); // Bronze: no purchase price
  });

  it('compares rent with the area by bedrooms', () => {
    const unitA = s.units.find((u) => u.id === 'u-a')!; // 2-bed at $1,650 in Hamilton
    const r = rentVsMarket(maple, unitA);
    expect(r.market).toBe(195_000);
    expect(r.gap).toBe(30_000);
  });

  it('works out borrowing room and a rough sale only when what is owed is known', () => {
    const v = propertyValue(s, maple, today).value;
    const room = borrowingRoom(s, maple, today)!;
    const sale = roughSale(s, maple, today)!;
    expect(room).toBe(Math.max(0, Math.round(v * 0.8) - sale.owed));
    expect(sale.net).toBe(v - Math.round(v * 0.05) - sale.owed);
    expect(borrowingRoom(s, birch, today)).toBeNull();
  });
});
