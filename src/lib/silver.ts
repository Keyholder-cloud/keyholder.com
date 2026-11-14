import type { AppState, Cents, ISODate, Property, Unit } from '../data/types';
import { ownEstimate, owedAt, propertyValue, worthIt } from './finance';
import { BENCHMARK_LABELS, benchmarks, regionData } from './jurisdiction';

// Silver: "what it's worth to you and what it could do for you". The value is what you paid, or your own estimate;
// Keyholder does not estimate home values. All figures are for guidance, not offers or advice.

export const SELLING_COST_PCT = 5;
export const LENDER_MAX_LTV = 80;

/** Up or down since buying, by your own estimate. Null without both a purchase price and an estimate of your own. */
export function gainSincePurchase(state: AppState, p: Property, today: ISODate) {
  const own = ownEstimate(state, p.id, today);
  if (!p.purchasePrice || !own) return null;
  return { value: own.likely, paid: p.purchasePrice, gain: own.likely - p.purchasePrice, pct: ((own.likely - p.purchasePrice) / p.purchasePrice) * 100, asOf: own.date };
}

/** The property's return compared with savings, a GIC and a stock fund. */
export function returnComparison(state: AppState, p: Property, today: ISODate) {
  const w = worthIt(state, today, { propertyId: p.id });
  return { yours: w.returnPct, rows: compareRows() };
}

/** GIC, balanced fund and stock market returns to compare against (the same for every property). */
function compareRows() {
  const b = benchmarks();
  return (['savings', 'gic', 'index'] as const).map((k) => ({ key: k, label: BENCHMARK_LABELS[k], pct: b[k].pct, source: b[k].source, asOf: b[k].asOf }));
}

/** Typical rent for a unit like this nearby, and how far the current rent is from it. */
export function rentVsMarket(p: Property, u: Unit) {
  const r = regionData(p.province, p.city).marketRent;
  const beds = Math.max(0, Math.min(3, u.bedrooms)) as 0 | 1 | 2 | 3;
  const market = r[beds];
  return { market, gap: market - u.rent, source: r.source, asOf: r.asOf, fallback: regionData(p.province, p.city).fallback };
}

/** Rough room to borrow against the property: 80% of value minus what is owed. Null if either is unknown. */
export function borrowingRoom(state: AppState, p: Property, today: ISODate): Cents | null {
  const o = owedAt(state, p, today, today);
  const value = propertyValue(state, p, today).value;
  if (!o.known || !value) return null;
  return Math.max(0, Math.round((value * LENDER_MAX_LTV) / 100) - o.owed);
}

/** Rough cash after selling: value minus selling costs minus what is owed. Gold gives the exact figure with tax. */
export function roughSale(state: AppState, p: Property, today: ISODate): { value: Cents; costs: Cents; owed: Cents; net: Cents } | null {
  const o = owedAt(state, p, today, today);
  const value = propertyValue(state, p, today).value;
  if (!o.known || !value) return null;
  const costs = Math.round((value * SELLING_COST_PCT) / 100);
  return { value, costs, owed: o.owed, net: value - costs - o.owed };
}

/** Return on your money across the properties that have enough detail (purchase price and what is owed). */
export function portfolioReturn(state: AppState, today: ISODate) {
  const props = state.properties.filter((p) => !p.archived);
  let total = 0, equity = 0;
  const included: Property[] = [], missing: Property[] = [];
  for (const p of props) {
    const w = worthIt(state, today, { propertyId: p.id });
    if (w.returnPct === null) { missing.push(p); continue; }
    total += w.total; equity += w.equity; included.push(p);
  }
  return { pct: equity > 0 ? (total / equity) * 100 : null, included, missing, rows: compareRows() };
}
