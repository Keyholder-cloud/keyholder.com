import { describe, expect, it } from 'vitest';
import { seedState } from '../data/seed';
import type { AppState, Payment } from '../data/types';
import { tenantMails } from '../../server/mails';
import { leaseLedger } from './finance';
import { personFor, suggestMatch } from './matching';
import { recipients, toLine, withPeople } from './people';
import { defaultPeriod, evenSplit, personLines, reminderTo, renumberPeople, rentShares, shareProblem } from './shares';
import { reminderDraft } from './templates';

// The sample's shared lease: Jordan and Priya Patel, $1,450 a month, nothing paid yet for November.
const today = '2026-11-08';
const setup = () => {
  const s = seedState(undefined, today);
  const lease = s.leases.find((l) => l.id === 'l-patel')!;
  const tenant = s.tenants.find((t) => t.id === 't-patel')!;
  return { s, lease, tenant };
};
const pay = (s: AppState, amount: number, person?: number, period = '2026-11'): Payment => {
  const p: Payment = { id: `pay-${s.payments.length}`, leaseId: 'l-patel', date: today, amount, method: 'etransfer', period, source: 'manual', createdAt: `${today}T10:00:00Z`, ...(person !== undefined ? { person } : {}) };
  s.payments.push(p);
  return p;
};
const nov = (s: AppState) => leaseLedger(s.leases.find((l) => l.id === 'l-patel')!, s.payments, today).find((l) => l.period === '2026-11')!;

describe('a shared lease: each person pays their share', () => {
  it('splits the rent evenly unless shares that add up to the rent are entered', () => {
    const { tenant } = setup();
    expect(rentShares(tenant, 145_000)).toEqual([72_500, 72_500]);
    expect(evenSplit(100_001, 3)).toEqual([33_334, 33_334, 33_333]);
    const set = withPeople(tenant, tenant.people!.map((p, i) => ({ ...p, share: i === 0 ? 80_000 : 65_000 })));
    expect(set.people!.map((p) => p.share)).toEqual([80_000, 65_000]);
    expect(rentShares(set, 145_000)).toEqual([80_000, 65_000]);
    // Shares that no longer add up (the rent went up): an even split until they are fixed.
    expect(rentShares(set, 150_000)).toEqual([75_000, 75_000]);
  });

  it('checks the shares typed in a form', () => {
    const ps = [{ name: 'Ana', email: '', phone: '' }, { name: 'Ben', email: '', phone: '' }];
    expect(shareProblem(ps, 100_000)).toBeNull();
    expect(shareProblem([{ ...ps[0], share: 60_000 }, ps[1]], 100_000)).toMatch(/share for everyone/);
    expect(shareProblem([{ ...ps[0], share: 60_000 }, { ...ps[1], share: 30_000 }], 100_000)).toMatch(/add up to \$900\.00, but the rent is \$1,000\.00/);
    expect(shareProblem([{ ...ps[0], share: 60_000 }, { ...ps[1], share: 40_000 }], 100_000)).toBeNull();
  });

  it("shows where each person stands; one person's payment leaves the other owing", () => {
    const { s, lease } = setup();
    expect(personLines(s, lease, nov(s)).map((p) => p.state)).toEqual(['late', 'late']);
    pay(s, 72_500, 0);
    const [jordan, priya] = personLines(s, lease, nov(s));
    expect(jordan).toMatchObject({ name: 'Jordan Patel', state: 'paid', paid: 72_500, owing: 0 });
    expect(priya).toMatchObject({ name: 'Priya Patel', state: 'late', paid: 0, owing: 72_500, daysLate: 7 });
    expect(nov(s).state).toBe('partial');
    pay(s, 72_500, 1);
    expect(personLines(s, lease, nov(s)).map((p) => p.state)).toEqual(['paid', 'paid']);
    expect(nov(s).state).toBe('paid');
  });

  it('counts a payment that does not say who paid toward the month; paid in full is paid for everyone', () => {
    const { s, lease } = setup();
    pay(s, 145_000);
    expect(personLines(s, lease, nov(s)).map((p) => p.state)).toEqual(['paid', 'paid']);
  });

  it('"Mark paid" is for this month while it is unpaid, not the oldest month owing', () => {
    const { s, lease } = setup();
    // October left unpaid as well: November still comes first.
    s.payments = s.payments.filter((p) => !(p.leaseId === 'l-patel' && p.period === '2026-10'));
    expect(defaultPeriod(s, lease, today)).toBe('2026-11');
    pay(s, 145_000);
    expect(defaultPeriod(s, lease, today)).toBe('2026-10');
  });

  it("matches a bank deposit to the person by name and their share's amount", () => {
    const { s, tenant } = setup();
    expect(personFor(tenant, 'PRIYA PATEL')).toBe(1);
    expect(personFor(tenant, 'Jordan Patel')).toBe(0);
    expect(personFor(tenant, 'Patel')).toBeUndefined();
    const m = suggestMatch(s, { amount: 72_500, payer: 'Priya Patel', memo: 'rent', date: today }, today)!;
    expect(m).toMatchObject({ leaseId: 'l-patel', period: '2026-11', person: 1, confidence: 'high' });
    expect(m.reasons).toContain("Amount equals Priya's share");
  });

  it('sends a reminder only to whoever has not paid, for what they owe', () => {
    const { s, lease, tenant } = setup();
    expect(reminderTo(s, lease, '2026-11', today)).toBeUndefined(); // nobody paid yet: everyone
    pay(s, 72_500, 0);
    const to = reminderTo(s, lease, '2026-11', today);
    expect(to).toEqual([1]);
    const r = reminderDraft(s, lease, '2026-11', 'standard', today, to);
    expect(r.body).toMatch(/^Hi Priya,/);
    expect(r.body).toContain('$725.00 (your share)');
    expect(toLine(tenant, to)).toBe('Priya Patel <priya.patel@example.com>');
    const mails = tenantMails(s, { id: 'm1', kind: 'reminder', tenantId: 't-patel', leaseId: 'l-patel', period: '2026-11', subject: r.subject, body: r.body, status: 'sent', edited: false, to, createdAt: today }, 'acct');
    expect(mails.map((x) => x.to)).toEqual(['priya.patel@example.com']);
  });

  it('sends the receipt to the person who paid, made out to them', () => {
    const { s } = setup();
    const p = pay(s, 72_500, 0);
    s.receipts.push({ id: 'r1', number: 2001, paymentId: p.id, status: 'sent', createdAt: today });
    const mails = tenantMails(s, { id: 'm2', kind: 'receipt', tenantId: 't-patel', leaseId: 'l-patel', period: '2026-11', receiptId: 'r1', subject: '', body: '', status: 'sent', edited: false, to: [0], createdAt: today }, 'acct');
    expect(mails.map((x) => x.to)).toEqual(['jpatel@example.com']);
    expect(mails[0].text).toMatch(/^Hi Jordan,/);
    expect(mails[0].text).toContain('Received from: Jordan Patel');
  });

  it('falls back to everyone when the person has no email', () => {
    const { tenant } = setup();
    const t = withPeople(tenant, [tenant.people![0], { ...tenant.people![1], email: '' }]);
    expect(recipients(t, [1]).map((p) => p.name)).toEqual(['Jordan Patel', 'Priya Patel']);
  });

  it('keeps who paid with the right person when someone is removed from the lease', () => {
    const { s } = setup();
    const t = s.tenants.find((x) => x.id === 't-patel')!;
    t.people = [...t.people!, { name: 'Sam Patel', email: 'sam@example.com', phone: '' }];
    const a = pay(s, 50_000, 0), b = pay(s, 50_000, 2);
    s.messages.push({ id: 'm3', kind: 'reminder', tenantId: 't-patel', leaseId: 'l-patel', subject: '', body: '', status: 'draft', edited: false, to: [0], createdAt: today });
    // Jordan leaves: Priya and Sam move up.
    renumberPeople(s, 't-patel', [1, 2]);
    expect(s.payments.find((p) => p.id === a.id)!.person).toBeUndefined();
    expect(s.payments.find((p) => p.id === b.id)!.person).toBe(1);
    expect(s.messages.find((m) => m.id === 'm3')!.to).toBeUndefined();
  });
});
