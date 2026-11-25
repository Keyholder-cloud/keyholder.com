import { describe, expect, it } from 'vitest';
import { seedState } from '../src/data/seed';
import { tenantMails } from './mails';

describe('receipt email for other income', () => {
  it('a bill share sends a payment receipt with the PDF, saying what it was for', () => {
    const s = seedState(undefined, '2026-11-08');
    const lease = s.leases.find((l) => l.id === 'l-maya')!;
    s.income = [{ id: 'inc-x', kind: 'bill', label: 'Enbridge Gas, October', amount: 6_000, date: '2026-11-02', method: 'etransfer', leaseId: lease.id, source: 'manual', createdAt: '2026-11-02T10:00:00Z' }];
    s.receipts.push({ id: 'r-x', number: 2001, paymentId: '', incomeId: 'inc-x', status: 'sent', createdAt: '2026-11-02T10:00:00Z', sentAt: '2026-11-02T10:00:00Z' });
    const m = { id: 'm-x', kind: 'receipt' as const, tenantId: lease.tenantId, leaseId: lease.id, period: '2026-11', receiptId: 'r-x', subject: 'Your payment receipt', body: '', status: 'sent' as const, edited: false, createdAt: '2026-11-02T10:00:00Z', sentAt: '2026-11-02T10:00:00Z' };
    const mails = tenantMails(s, m, 'acct-1');
    expect(mails.length).toBeGreaterThan(0);
    expect(mails[0].subject).toBe('Payment receipt #2001: Enbridge Gas, October (your share)');
    expect(mails[0].text).toContain('For: Bill share: Enbridge Gas, October (your share)');
    expect(mails[0].attachment).toMatchObject({ kind: 'receipt', filename: 'Payment receipt 2001.pdf' });
  });

  it('every email to a tenant copies the landlord (once, for a shared lease)', () => {
    const s = seedState(undefined, '2026-11-08');
    s.profile.email = 'landlord@landlord-e2e.ca';
    const lease = s.leases.find((l) => l.id === 'l-jordan') ?? s.leases[0];
    const t = s.tenants.find((x) => x.id === lease.tenantId)!;
    t.people = [{ name: 'Jordan Patel', email: 'jordan@tenant-e2e.ca', phone: '' }, { name: 'Priya Patel', email: 'priya@tenant-e2e.ca', phone: '' }];
    const m = { id: 'm-y', kind: 'reminder' as const, tenantId: t.id, leaseId: lease.id, period: '2026-11', subject: 'Rent for November', body: 'Hi, a friendly reminder.', status: 'sent' as const, edited: false, createdAt: '2026-11-05T10:00:00Z', sentAt: '2026-11-05T10:00:00Z' };
    const mails = tenantMails(s, m, 'acct-1');
    expect(mails.map((x) => x.cc)).toEqual(['landlord@landlord-e2e.ca', undefined]);
  });
});
