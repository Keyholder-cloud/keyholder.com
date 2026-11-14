import type { AppState, Cents, ISODate, Lease, Period, Person, Tenant } from '../data/types';
import { fmt } from './money';
import { leaseLedger, type LedgerLine } from './finance';
import { tenantPeople } from './people';
import { addMonths, periodOf } from './dates';

// Several people on one lease (roommates, a couple) who each pay their own share of the rent. The rent and what
// is owed stay the lease's; each payment can say who paid, so each person has their own status, "Mark paid",
// receipt and reminder. A month paid in full (by anyone) is paid for everyone.

/** More than one person on the lease. */
export const isShared = (t: Tenant | undefined): t is Tenant => !!t && tenantPeople(t).length > 1;

/**
 * Each person's share of a month's rent: the shares entered on the lease when they add up to the rent, else an
 * equal split (any odd cents go to the first people).
 */
export function rentShares(t: Tenant, rent: Cents): Cents[] {
  const ps = tenantPeople(t);
  const set = ps.map((p) => p.share);
  if (set.every((x) => typeof x === 'number' && x >= 0) && set.reduce<number>((a, x) => a + (x ?? 0), 0) === rent) return set as Cents[];
  return evenSplit(rent, ps.length);
}

/** The rent split evenly between `n` people; odd cents go to the first people. */
export function evenSplit(rent: Cents, n: number): Cents[] {
  const k = Math.max(1, n), base = Math.floor(rent / k), extra = rent - base * k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

/** What is wrong with the shares typed in a form (blank for everyone is fine: an even split), or null. */
export function shareProblem(people: Person[], rent: Cents | undefined): string | null {
  const named = people.filter((p) => p.name.trim());
  if (named.length < 2 || !rent) return null;
  const set = named.filter((p) => typeof p.share === 'number');
  if (!set.length) return null;
  if (set.length < named.length) return 'Enter a share for everyone, or leave them all blank to split evenly.';
  const sum = set.reduce((a, p) => a + (p.share ?? 0), 0);
  return sum === rent ? null : `The shares add up to ${fmt(sum)}, but the rent is ${fmt(rent)}.`;
}

/**
 * When people are removed from a lease, payments and messages that name a person by their place are moved to
 * the new places (`from` is each remaining person's old place); a removed person's payments count toward the month.
 */
export function renumberPeople(d: AppState, tenantId: string, from: (number | undefined)[]) {
  const map = new Map<number, number>();
  from.forEach((old, now) => { if (old !== undefined) map.set(old, now); });
  const leases = new Set(d.leases.filter((l) => l.tenantId === tenantId).map((l) => l.id));
  for (const p of d.payments) if (leases.has(p.leaseId) && p.person !== undefined) { const n = map.get(p.person); if (n === undefined) delete p.person; else p.person = n; }
  for (const m of d.messages) if (m.tenantId === tenantId && m.to) { const to = m.to.map((i) => map.get(i)).filter((i): i is number => i !== undefined); if (to.length) m.to = to; else delete m.to; }
}

export type PersonState = 'paid' | 'partial' | 'due' | 'late' | 'upcoming';
export interface PersonLine { idx: number; name: string; email: string; share: Cents; paid: Cents; owing: Cents; state: PersonState; daysLate: number }

/** Where each person stands for one month. Payments that do not say who paid count toward the month only. */
export function personLines(state: AppState, lease: Lease, line: LedgerLine): PersonLine[] {
  const t = state.tenants.find((x) => x.id === lease.tenantId);
  if (!isShared(t)) return [];
  const ps = tenantPeople(t);
  const shares = rentShares(t, line.charge);
  const all = line.paid >= line.charge;
  return ps.map((p, idx) => {
    const paid = line.payments.filter((x) => x.person === idx).reduce((a, x) => a + x.amount, 0);
    const owing = all ? 0 : Math.max(0, shares[idx] - paid);
    const st: PersonState = owing === 0 ? 'paid' : paid > 0 ? 'partial' : line.daysLate > 0 ? 'late' : line.state === 'due' ? 'due' : line.state === 'upcoming' ? 'upcoming' : 'due';
    return { idx, name: p.name, email: p.email, share: shares[idx], paid, owing, state: st, daysLate: owing > 0 ? line.daysLate : 0 };
  });
}

/** The month a new payment is for: this month while it is not fully paid, else the oldest month still owing. */
export function defaultPeriod(state: AppState, lease: Lease, today: ISODate): Period {
  const lines = leaseLedger(lease, state.payments, today, periodOf(addMonths(today, 1)));
  const now = periodOf(today);
  const cur = lines.find((l) => l.period === now);
  if (cur && cur.paid < cur.charge) return now;
  return lines.find((l) => l.paid < l.charge)?.period ?? now;
}

/** On a shared lease, the people a reminder goes to: those who have not paid their share of that month. */
export function reminderTo(state: AppState, lease: Lease, period: Period, today: ISODate): number[] | undefined {
  const t = state.tenants.find((x) => x.id === lease.tenantId);
  if (!isShared(t)) return undefined;
  const line = leaseLedger(lease, state.payments, today).find((l) => l.period === period);
  if (!line) return undefined;
  const who = personLines(state, lease, line).filter((p) => p.owing > 0).map((p) => p.idx);
  return who.length && who.length < tenantPeople(t).length ? who : undefined;
}
