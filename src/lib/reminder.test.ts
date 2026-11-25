import { describe, expect, it } from 'vitest';
import { seedState } from '../data/seed';
import { trayItems } from './tray';
import { reminderDraft } from './templates';

describe('reminder before rent is due', () => {
  it('shows from the last day of the month before, not earlier, and says "is due"', () => {
    const s = seedState(undefined, '2026-11-08');
    const lease = s.leases.find((l) => !l.end && l.dueDay === 1)!;
    s.payments = s.payments.filter((p) => !(p.leaseId === lease.id && p.period === '2026-12'));
    const has = (today: string) => trayItems(s, today).some((t) => t.kind === 'reminder' && t.lease.id === lease.id && t.line.period === '2026-12');
    expect(has('2026-11-29')).toBe(false);
    expect(has('2026-11-30')).toBe(true);
    expect(reminderDraft(s, lease, '2026-12', 'gentle', '2026-11-30').body).toMatch(/is due on/);
  });
});
