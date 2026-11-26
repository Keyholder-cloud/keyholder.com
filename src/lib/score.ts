import type { AppState, Property } from '../data/types';
import { propertyValue } from './finance';
import { activeLeases, byRoom, roomLabels } from './finance';
import { tenantPeople } from './people';
import { hasSilver } from './levels';
import { currentTaxYear, yearCheck } from './taxyear';

// Keyholder score: how complete the owner's records are, 0–100. Each item is worth points;
// some give partial credit (e.g. receipt photos). Property items count toward that property's %.

export interface ScoreItem {
  id: string;
  text: string;
  points: number;
  earned: number;
  /** 1 Set up · 2 Rent running · 3 Know your numbers · 4 Tax-ready. */
  stage: Stage;
  propertyId?: string;
  /** Where to go to complete it. */
  to: string;
  /** Opens the level-up form for this property instead of navigating. */
  levelUp?: 'silver' | 'gold';
}

export type Stage = 1 | 2 | 3 | 4;
/** Four stages of 25 points each, done in order: what is suggested is always the current stage. */
export const STAGES: { n: Stage; title: string; sub: string }[] = [
  { n: 1, title: 'Set up', sub: 'Your properties, units and tenants' },
  { n: 2, title: 'Rent running', sub: 'Rent tracked, paid and receipted' },
  { n: 3, title: 'Know your numbers', sub: 'What you paid and what you owe' },
  { n: 4, title: 'Tax-ready', sub: 'This tax year documented, month by month' },
];
/** The ring's colour as it fills: rose, amber, blue, teal, then green at 100. */
export const scoreTone = (score: number) => (score >= 100 ? 'done' : score >= 75 ? 'teal' : score >= 50 ? 'blue' : score >= 25 ? 'amber' : 'rose');

/** Properties, most valuable first. Suggestions follow this order. */
export function byValue(state: AppState, today: string): Property[] {
  return state.properties.filter((p) => !p.archived)
    .map((p) => ({ p, v: propertyValue(state, p, today).value }))
    .sort((a, b) => b.v - a.v)
    .map((x) => x.p);
}

/**
 * Every item, by stage. `banks`: bank checks are available. `twoStep`: on the live site, whether two-step
 * sign-in is on (undefined elsewhere: not counted).
 */
export function scoreItems(state: AppState, today: string, banks = true, twoStep?: boolean): ScoreItem[] {
  const items: ScoreItem[] = [];
  const pr = state.profile;
  const add = (i: Omit<ScoreItem, 'earned'> & { done: boolean | number }) => {
    const earned = typeof i.done === 'number' ? i.points * Math.max(0, Math.min(1, i.done)) : i.done ? i.points : 0;
    const { done: _ignored, ...rest } = i; void _ignored;
    items.push({ ...rest, earned });
  };
  const props = byValue(state, today);

  // ---- 1. Set up
  add({ id: 'name', stage: 1, text: 'Add your name and email for receipts', points: 3, done: !!pr.name && !!pr.email, to: '/settings' });
  add({ id: 'property', stage: 1, text: 'Add your first property', points: 6, done: props.length > 0, to: '/rentals' });
  for (const p of props) {
    const units = state.units.filter((u) => u.propertyId === p.id);
    const leases = units.flatMap((u) => activeLeases(state, u.id, today));
    const places = units.reduce((n, u) => n + (byRoom(u) ? roomLabels(u).length : 1), 0);
    add({ id: `${p.id}-units`, stage: 1, text: `Add the units at ${p.nickname}`, points: 3, done: units.length > 0, propertyId: p.id, to: `/rent/property/${p.id}` });
    add({ id: `${p.id}-tenants`, stage: 1, text: `Add the tenants at ${p.nickname}`, points: 4, done: places ? Math.min(1, leases.length / places) : 0, propertyId: p.id, to: `/rent/property/${p.id}/tenants` });
    for (const l of leases) {
      const t = state.tenants.find((x) => x.id === l.tenantId); if (!t) continue;
      tenantPeople(t).forEach((x, i) => {
        add({ id: i ? `${t.id}-email-${i}` : `${t.id}-email`, stage: 1, text: `Add ${x.name.split(' ')[0]}'s email so receipts can be sent`, points: i ? 1 : 2, done: !!x.email, propertyId: p.id, to: `/rent/tenant/${t.id}` });
      });
    }
  }

  // ---- 2. Rent running
  const anyLease = state.leases.length > 0;
  if (banks) add({ id: 'bank', stage: 2, text: 'Connect your bank (or upload statements) so rent is spotted for you', points: 5, done: (state.banks ?? []).some((b) => b.status === 'connected') || (state.statements ?? []).length > 0, to: '/settings#rent-tracking' });
  add({ id: 'first-rent', stage: 2, text: 'Mark your first rent paid', points: 5, done: state.payments.some((x) => !x.voided), to: '/today' });
  add({ id: 'first-receipt', stage: 2, text: 'Send your first rent receipt', points: 4, done: state.messages.some((m) => m.kind === 'receipt' && m.status === 'sent'), to: '/today' });
  if (anyLease) for (const t of state.tenants.filter((x) => state.leases.some((l) => l.tenantId === x.id && (!l.end || l.end >= today)))) {
    tenantPeople(t).forEach((x, i) => add({ id: i ? `${t.id}-phone-${i}` : `${t.id}-phone`, stage: 2, text: `Add ${x.name.split(' ')[0]}'s phone number`, points: 1, done: !!x.phone, to: `/rent/tenant/${t.id}` }));
  }
  if (twoStep !== undefined) add({ id: 'two-step', stage: 2, text: 'Turn on two-step sign-in (fingerprint or an app code)', points: 4, done: twoStep, to: '/settings#two-step' });

  // ---- 3. Know your numbers
  for (const p of props) {
    add({ id: `${p.id}-paid`, stage: 3, text: `Add what you paid for ${p.nickname}`, points: 8, done: hasSilver(p), propertyId: p.id, to: `/rent/property/${p.id}`, levelUp: 'silver' });
    add({ id: `${p.id}-mortgage`, stage: 3, text: `Add the mortgage for ${p.nickname} (or say there is none)`, points: 6, done: !!p.mortgageFree || state.mortgages.some((m) => m.propertyId === p.id), propertyId: p.id, to: `/rent/property/${p.id}/mortgage`, levelUp: 'gold' });
    add({ id: `${p.id}-costs`, stage: 3, text: `Add closing costs and land transfer tax for ${p.nickname}`, points: 3, done: p.closingCosts !== undefined && p.landTransferTax !== undefined, propertyId: p.id, to: `/rent/property/${p.id}/mortgage`, levelUp: 'gold' });
  }

  // ---- 4. Tax-ready: the current tax year, month by month
  const year = currentTaxYear(today);
  for (const p of props) {
    const c = yearCheck(state, p, year, today);
    const n = (k: string) => c.gaps.filter((g) => g.kind === k).length;
    add({ id: `${p.id}-statements-${year}`, stage: 4, text: `Upload ${year} bank statements for ${p.nickname} (${c.covered.length} of ${c.months.length} months)`, points: 8, done: c.months.length ? 1 - n('statement') / c.months.length : 1, propertyId: p.id, to: '/paperwork/taxes' });
    add({ id: `${p.id}-rent-${year}`, stage: 4, text: `Mark every ${year} rent paid at ${p.nickname}`, points: 4, done: !n('rent'), propertyId: p.id, to: '/paperwork/taxes' });
    add({ id: `${p.id}-mortgage-${year}`, stage: 4, text: `Record every ${year} mortgage payment for ${p.nickname}`, points: 4, done: !n('mortgage'), propertyId: p.id, to: '/paperwork/taxes' });
    add({ id: `${p.id}-taxins-${year}`, stage: 4, text: `Add ${year} property tax and insurance for ${p.nickname}`, points: 4, done: !n('property-tax') && !n('insurance'), propertyId: p.id, to: '/expenses' });
    const exps = state.expenses.filter((e) => e.propertyId === p.id && e.date.startsWith(String(year)));
    if (exps.length) {
      const withPhoto = exps.filter((e) => e.receiptImage || e.cashNoReceipt).length;
      add({ id: `${p.id}-photos`, stage: 4, text: `Add photos to ${exps.length - withPhoto} receipt${exps.length - withPhoto === 1 ? '' : 's'} at ${p.nickname}`, points: 3, done: withPhoto / exps.length, propertyId: p.id, to: '/expenses' });
      const typed = exps.filter((e) => e.category !== 'other').length;
      add({ id: `${p.id}-types`, stage: 4, text: `Pick a type for ${exps.length - typed} expense${exps.length - typed === 1 ? '' : 's'} at ${p.nickname}`, points: 2, done: typed / exps.length, propertyId: p.id, to: '/expenses' });
    }
  }
  return items;
}

export const scoreKey = (i: ScoreItem) => `score:${i.id}`;

export interface ScoreResult {
  score: number;
  /** The current stage's open items, biggest gain first (then later stages', so it is never empty while work is left). */
  todo: ScoreItem[];
  /** Open items the owner hid for a while (⋯ → Hide). */
  hidden: ScoreItem[];
  /** The first stage not finished (5 when all are). */
  stage: number;
  stages: { n: Stage; title: string; sub: string; pct: number }[];
}

export function keyholderScore(state: AppState, today: string, banks = true, twoStep?: boolean): ScoreResult {
  // Ignored items no longer count against the score; hidden ones still count but are not suggested.
  const prefs = state.todoPrefs ?? {};
  const items = scoreItems(state, today, banks, twoStep).filter((i) => !prefs[scoreKey(i)]?.ignored);
  // A stage with nothing in it yet (no property for stages 3 and 4) counts only once the stages before it are done.
  const stages: { n: Stage; title: string; sub: string; pct: number }[] = [];
  for (const st of STAGES) {
    const its = items.filter((i) => i.stage === st.n);
    const total = its.reduce((a, i) => a + i.points, 0);
    stages.push({ ...st, pct: total ? its.reduce((a, i) => a + i.earned, 0) / total : stages.every((x) => x.pct >= 1) ? 1 : 0 });
  }
  // Each stage is worth 25; the score only says 100 when everything is done.
  const raw = stages.reduce((a, s) => a + s.pct * 25, 0);
  const score = stages.every((s) => s.pct >= 1) ? 100 : Math.min(99, Math.floor(raw));
  const stage = stages.find((s) => s.pct < 1)?.n ?? 5;
  const isHidden = (i: ScoreItem) => { const h = prefs[scoreKey(i)]?.hiddenUntil; return !!h && h > today; };
  const open = items.filter((i) => i.points - i.earned > 0.001);
  const order = (list: ScoreItem[]) => list.map((i, n) => ({ i, n }))
    .sort((a, b) => a.i.stage - b.i.stage || (b.i.points - b.i.earned) - (a.i.points - a.i.earned) || a.n - b.n).map((x) => x.i);
  // The current stage first; when everything left there is hidden, the next stages' steps.
  let todo = order(open.filter((i) => i.stage === stage && !isHidden(i)));
  if (!todo.length) todo = order(open.filter((i) => !isHidden(i)));
  return { score, todo, hidden: order(open.filter(isHidden)), stage, stages: stages.map((s) => ({ ...s, pct: Math.round(s.pct * 100) })) };
}

export function propertyCompletion(state: AppState, p: Property, today: string): number {
  const items = scoreItems(state, today).filter((i) => i.propertyId === p.id);
  const total = items.reduce((a, i) => a + i.points, 0);
  return total ? Math.round((items.reduce((a, i) => a + i.earned, 0) / total) * 100) : 0;
}
