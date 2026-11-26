import { describe, expect, it } from 'vitest';
import { seedState } from '../data/seed';
import { hoursUntil, outsideHours, visitMessage } from './visits';
import { tenantMails } from '../../server/mails';

describe('visit notices', () => {
  it('the email says what, when and where, and why when it is short notice', () => {
    const s = seedState(undefined, '2026-11-08');
    const lease = s.leases[0]; const unit = s.units.find((u) => u.id === lease.unitId)!;
    const m = visitMessage(s, unit, lease, { date: '2026-12-02', time: '14:30', kind: 'Inspection', notes: 'Smoke alarms.' });
    expect(m.subject).toMatch(/^Notice of entry: inspection on .* at 2:30 p\.m\.$/);
    expect(m.body).toMatch(/Time: 2:30 p\.m\./);
    expect(m.body).toMatch(/at least 24 hours/);
    const u = visitMessage(s, unit, lease, { date: '2026-12-02', time: '09:00', kind: 'Maintenance or repair', urgency: 'Emergency' });
    expect(u.subject.startsWith('Urgent: ')).toBe(true);
    expect(u.body).toMatch(/emergency/);
  });
  it('short notice and hours', () => {
    const now = new Date('2026-12-01T10:00:00');
    expect(hoursUntil('2026-12-01', '20:00', now)).toBe(10);
    expect(outsideHours('21:00')).toBe(true);
    expect(outsideHours('10:00')).toBe(false);
  });
  it('the landlord is copied once, not on every lease in the unit', () => {
    const s = seedState(undefined, '2026-11-08');
    s.profile.email = 'owner@landlord-test.ca'; s.profile.account = { ...(s.profile.account ?? {}), email: 'owner@landlord-test.ca' } as typeof s.profile.account;
    const lease = s.leases[0]; const t = s.tenants.find((x) => x.id === lease.tenantId)!; t.email = 'tenant@tenant-test.ca';
    const base = { id: 'm1', kind: 'visit' as const, tenantId: t.id, leaseId: lease.id, subject: 'Notice of entry', body: 'Hi', status: 'sent' as const, edited: false, createdAt: '', sentAt: new Date().toISOString() };
    expect(tenantMails(s, base, 'acc')[0].cc).toBe('owner@landlord-test.ca');
    expect(tenantMails(s, { ...base, id: 'm2', ccLandlord: false }, 'acc')[0].cc).toBeUndefined();
  });
});
