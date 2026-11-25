import type { AppState, BankTxn, Lease, Message, Tone } from '../data/types';
import { addDays, daysBetween, periodOf } from './dates';
import { currentLeases, leaseLedger, type LedgerLine } from './finance';
import { suggestMatch, type Suggestion } from './matching';
import { journeyCards } from './journey';

// The approval tray (PRD §12): everything that needs a decision. Its count is the only badge in the app.

export type TrayItem =
  | { kind: 'message'; id: string; message: Message }
  | { kind: 'reminder'; id: string; lease: Lease; line: LedgerLine; tone: Tone; stage: string }
  | { kind: 'match'; id: string; txn: BankTxn; suggestion: Suggestion | null };

export function reminderStage(daysLate: number, grace: number, base: Tone): { tone: Tone; stage: string } | null {
  if (daysLate < 1) return null;
  if (daysLate >= grace) return { tone: 'firm', stage: 'End of grace period' };
  if (daysLate >= 3) return { tone: base === 'gentle' ? 'standard' : base, stage: 'Day 3' };
  return { tone: base, stage: 'Day after due' };
}

export function trayItems(state: AppState, today: string): TrayItem[] {
  const items: TrayItem[] = [];
  for (const m of state.messages) if (m.status === 'draft') items.push({ kind: 'message', id: m.id, message: m });

  // Don't nag a tenant whose deposit is already sitting in the tray waiting to be matched.
  const deposits = state.txns.filter((t) => t.status === 'new' && t.amount > 0).map((t) => ({ t, s: suggestMatch(state, t, today) }));
  const pendingDeposits = deposits.filter((x) => !x.s?.paymentId).map((x) => x.s?.leaseId);
  for (const lease of currentLeases(state, today)) {
    const tenant = state.tenants.find((t) => t.id === lease.tenantId);
    if (!tenant || tenant.remindersPaused || pendingDeposits.includes(lease.id)) continue;
    for (const line of leaseLedger(lease, state.payments, today)) {
      if (line.state !== 'late' && !(line.state === 'partial' && line.daysLate > 0)) continue;
      if (line.daysLate > 45) continue; // beyond reminders — that is notice territory
      const st = reminderStage(line.daysLate, state.profile.graceDays, state.profile.reminderTone);
      if (!st) continue;
      const already = state.messages.some(
        (m) => m.kind === 'reminder' && m.leaseId === lease.id && m.period === line.period &&
          (m.tone === st.tone || (m.sentAt && daysBetween(m.sentAt.slice(0, 10), today) < 2)),
      );
      if (already) continue;
      items.push({ kind: 'reminder', id: `rem-${lease.id}-${line.period}-${st.tone}`, lease, line, ...st });
    }
    // Before it is due: from the last day of the month before, a friendly reminder for rent not yet paid.
    const next = periodOf(addDays(today, 1));
    for (const line of leaseLedger(lease, state.payments, today, next)) {
      if (line.state !== 'upcoming' && line.state !== 'due') continue;
      if (today < addDays(`${line.period}-01`, -1)) continue;
      if (state.messages.some((m) => m.kind === 'reminder' && m.leaseId === lease.id && m.period === line.period)) continue;
      items.push({ kind: 'reminder', id: `rem-${lease.id}-${line.period}-upcoming`, lease, line, tone: 'gentle', stage: 'Before due' });
    }
  }

  // A deposit that is rent already marked paid is attached to it (the store does that), not asked about.
  for (const { t, s } of deposits) if (!s?.paymentId) items.push({ kind: 'match', id: t.id, txn: t, suggestion: s });
  return items;
}

/** How many journey cards need the owner now (Home badge). */
export function needsYouCount(state: AppState, today: string): number {
  return journeyCards(state, today).length;
}
