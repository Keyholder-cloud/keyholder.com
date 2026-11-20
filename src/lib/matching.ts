import type { AppState, BankTxn, Cents, ISODate, Payment, Period } from '../data/types';
import { daysBetween } from './dates';
import { currentLeases, leaseLedger } from './finance';

// Payment matcher (BK-2, BK-3). Deposits are scored against open rent charges.
// High confidence logs automatically; medium/low go to the "Needs a look" tray.

export type Confidence = 'high' | 'medium' | 'low';
/** `paymentId`: the deposit is rent already marked paid by hand; it is attached to that payment (no new payment). */
export interface Suggestion { leaseId: string; period: Period; confidence: Confidence; score: number; reasons: string[]; paymentId?: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

export function nameScore(payer: string, names: string[], aliases: string[]): { score: number; reason?: string } {
  const p = norm(payer);
  if (!p) return { score: 0 };
  for (const a of aliases) if (norm(a) === p) return { score: 40, reason: `Known payer "${a}"` };
  // The best match across everyone on the lease (a deposit from the second person still matches them).
  let best: { score: number; reason?: string } = { score: 0 };
  for (const n of names) {
    const nn = norm(n);
    if (nn === p) return { score: 40, reason: 'Payer name matches the tenant' };
    const pt = p.split(' '), nt = nn.split(' ');
    const shared = nt.filter((t) => t.length > 1 && pt.includes(t));
    if (shared.length >= 2 && best.score < 35) best = { score: 35, reason: 'Payer name matches the tenant' };
    else if (shared.length === 1 && shared[0] === nt[nt.length - 1] && best.score < 22) best = { score: 22, reason: `Shares the surname ${n.split(' ').pop()}` };
  }
  return best;
}

/** The sender's name says who it is (their name, or a payer name learned before). */
const NAMED = 35;
const tenantOfLease = (state: AppState, leaseId: string) => state.tenants.find((t) => t.id === state.leases.find((l) => l.id === leaseId)?.tenantId);

/** Rent marked paid by hand that a bank deposit could be: same amount, arriving up to a month before (waiting in the list) or two weeks after. */
export function markedCandidates(state: AppState, txn: Pick<BankTxn, 'amount' | 'date'> & { id?: string }): Payment[] {
  if (txn.amount <= 0) return [];
  const linked = new Set((state.txns ?? []).filter((t) => t.paymentId && t.id !== txn.id).map((t) => t.paymentId));
  return (state.payments ?? []).filter((p) => !p.voided && p.source === 'manual' && p.amount === txn.amount && !linked.has(p.id)
    && daysBetween(p.date, txn.date) >= -31 && daysBetween(p.date, txn.date) <= 14);
}

/**
 * A bank deposit that is rent already marked paid by hand, from that tenant (by name); or, when the sender's name
 * matches nobody, the only such payment, as long as no other unpaid rent is the same amount. Rooms often have the
 * same rent, so without this the deposit would be offered to the next unpaid room.
 */
export function markedPayment(state: AppState, txn: Pick<BankTxn, 'amount' | 'payer' | 'date'> & { id?: string }): Payment | undefined {
  const cands = markedCandidates(state, txn);
  if (!cands.length) return undefined;
  const named = cands.filter((p) => { const t = tenantOfLease(state, p.leaseId); return !!t && nameScore(txn.payer, t.names, t.aliases).score >= NAMED; });
  if (named.length) return named.length === 1 ? named[0] : undefined;
  if (cands.length !== 1 || state.tenants.some((t) => nameScore(txn.payer, t.names, t.aliases).score >= NAMED)) return undefined;
  // Another tenant still owes exactly this amount: it could be theirs, so ask.
  const today = txn.date;
  const otherFits = currentLeases(state, today).some((l) => l.id !== cands[0].leaseId
    && leaseLedger(l, state.payments, today).some((x) => x.paid < x.charge && x.charge - x.paid === txn.amount));
  return otherFits ? undefined : cands[0];
}

export function suggestMatch(state: AppState, txn: Pick<BankTxn, 'amount' | 'payer' | 'memo' | 'date'>, today: ISODate): Suggestion | null {
  if (txn.amount <= 0) return null;
  // Rent already marked paid by hand: this deposit is that payment.
  const marked = markedPayment(state, txn);
  if (marked) return { leaseId: marked.leaseId, period: marked.period, confidence: 'high', score: 100, reasons: ['Rent you already marked paid'], paymentId: marked.id };
  // When the sender's name says who it is, only their rent is considered (never another room with the same rent).
  const leases = currentLeases(state, today);
  const byName = new Set(leases.filter((l) => { const t = tenantOfLease(state, l.id); return !!t && nameScore(txn.payer, t.names, t.aliases).score >= NAMED; }).map((l) => l.id));
  const candidates: Suggestion[] = [];
  for (const lease of leases) {
    const tenant = state.tenants.find((t) => t.id === lease.tenantId);
    const unit = state.units.find((u) => u.id === lease.unitId);
    if (!tenant || !unit) continue;
    if (byName.size && !byName.has(lease.id)) continue;
    const open = leaseLedger(lease, state.payments, today).filter((l) => l.paid < l.charge);
    // Also consider next month (people pay early).
    if (open.length === 0) continue;
    for (const line of open) {
      const reasons: string[] = [];
      let score = 0;
      const owing = line.charge - line.paid;
      if (txn.amount === owing) { score += 45; reasons.push(`Amount equals the ${owing === line.charge ? 'rent' : 'balance owing'}`); }
      else if (txn.amount === lease.rent) { score += 38; reasons.push('Amount equals the monthly rent'); }
      else if (txn.amount < owing) { score += 12; reasons.push('Could be a partial payment'); }
      const ns = nameScore(txn.payer, tenant.names, tenant.aliases);
      score += ns.score; if (ns.reason) reasons.push(ns.reason);
      const gap = Math.abs(daysBetween(line.due, txn.date));
      if (gap <= 5) { score += 12; reasons.push('Arrived near the due date'); }
      else if (gap <= 20) score += 4;
      const memo = norm(txn.memo);
      if (memo && (memo.includes('rent') || memo.split(' ').includes(norm(unit.label)) || (lease.room && memo.includes(norm(lease.room))))) { score += 6; reasons.push('Message mentions rent or the unit'); }
      candidates.push({ leaseId: lease.id, period: line.period, confidence: 'low', score, reasons });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.period.localeCompare(b.period));
  const best = candidates[0];
  if (!best || best.score < 30) return null;
  const runnerUp = candidates.find((c) => c.leaseId !== best.leaseId);
  const ambiguous = runnerUp && best.score - runnerUp.score < 15;
  const hasName = best.reasons.some((r) => r.includes('Payer') || r.includes('Known payer'));
  const hasAmount = best.reasons.some((r) => r.startsWith('Amount equals'));
  let confidence: Confidence = best.score >= 80 && hasName && hasAmount && !ambiguous ? 'high' : best.score >= 55 ? 'medium' : 'low';
  // Two tenants fit equally (rooms with the same rent) and the name does not say who: ask "Whose rent is it?".
  if (ambiguous && !hasName) return null;
  if (ambiguous && confidence === 'medium') confidence = 'low';
  if (ambiguous) best.reasons.push('Another tenant is also a possible match');
  return { ...best, confidence };
}

// ---- Interac e-Transfer email parsing (section 7.4, email forwarding path) ----

export interface ParsedTransfer { payer: string; amount: Cents; memo: string; reference?: string }

export function parseETransferEmail(text: string): ParsedTransfer | null {
  const t = text.replace(/\r/g, '');
  const amountM = t.match(/\$\s?([\d,]+(?:\.\d{2})?)\s*(?:\(?CAD\)?)?/i);
  const payerM =
    t.match(/^\s*(?:INTERAC e-Transfer:\s*)?(.+?)\s+(?:has\s+)?sent you\b/im) ??
    t.match(/(?:From|Sender|Sent from):\s*(.+)/i);
  if (!amountM || !payerM) return null;
  const amount = Math.round(Number(amountM[1].replace(/,/g, '')) * 100);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const memoM = t.match(/Message:\s*(.+)/i);
  const refM = t.match(/Reference(?: Number| #)?:\s*([A-Za-z0-9]+)/i);
  const payer = payerM[1].replace(/\s+/g, ' ').trim().replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return { payer, amount, memo: memoM ? memoM[1].trim() : '', reference: refM?.[1] };
}
