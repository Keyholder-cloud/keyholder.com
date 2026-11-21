import { describe, expect, it } from 'vitest';
import { seedState } from '../data/seed';
import type { AppState, BankTxn, Payment } from '../data/types';
import { activeLeases, defaultPeriod, leaseLedger, paidOn, roomsPaid, roomsPill } from './finance';
import { journeyLeases } from './journey';
import { markedCandidates, markedPayment, suggestMatch } from './matching';
import { trayItems } from './tray';

// The sample's basement is rented by the room. Here both rooms cost $900 and neither has paid November yet:
// the case where a deposit used to be offered to the wrong room.
const today = '2026-11-08';
const rooms = () => {
  const s = seedState(undefined, today);
  s.leases.find((l) => l.id === 'l-grace')!.rent = 90_000;
  s.payments = s.payments.filter((p) => !(p.leaseId === 'l-grace' && p.period === '2026-11'));
  s.txns = s.txns.filter((t) => t.id !== 'tx-grace' && t.id !== 'tx-sam');
  return s;
};
const markPaid = (s: AppState, leaseId: string, date = '2026-11-03'): Payment => {
  const p: Payment = { id: `pay-hand-${leaseId}`, leaseId, period: '2026-11', date, amount: 90_000, method: 'etransfer', source: 'manual', createdAt: `${date}T12:00:00Z` };
  s.payments.push(p);
  return p;
};
const deposit = (s: AppState, payer: string, date = '2026-11-05'): BankTxn => {
  const t: BankTxn = { id: `tx-${payer}`, source: 'bank', date, amount: 90_000, payer, memo: '', status: 'new' };
  s.txns.push(t);
  return t;
};
const nov = (s: AppState, leaseId: string) => leaseLedger(s.leases.find((l) => l.id === leaseId)!, s.payments, today).find((l) => l.period === '2026-11')!;

describe('rent marked paid stays paid, for every kind of rental', () => {
  it("attaches the tenant's bank deposit to the rent already marked paid, never to another room", () => {
    const s = rooms();
    const p = markPaid(s, 'l-sam');
    const t = deposit(s, 'SAM OKAFOR');
    expect(markedPayment(s, t)?.id).toBe(p.id);
    expect(suggestMatch(s, t, today)).toMatchObject({ leaseId: 'l-sam', paymentId: p.id });
    // Not asked about, and Grace's row is not told "rent to confirm".
    expect(trayItems(s, today).some((i) => i.kind === 'match')).toBe(false);
    expect(nov(s, 'l-grace').state).toBe('late');
  });

  it('does the same when the deposit arrived first and the rent was marked paid after', () => {
    const s = rooms();
    const t = deposit(s, 'SAM OKAFOR', '2026-11-02');
    const p = markPaid(s, 'l-sam', '2026-11-04');
    expect(markedPayment(s, t)?.id).toBe(p.id);
  });

  it("never offers a named tenant's deposit to someone else when that tenant is already paid", () => {
    const s = rooms();
    s.payments.push({ id: 'pay-bank-sam', leaseId: 'l-sam', period: '2026-11', date: '2026-11-01', amount: 90_000, method: 'etransfer', source: 'bank', createdAt: '2026-11-01T09:00:00Z' });
    expect(suggestMatch(s, { amount: 90_000, payer: 'Sam Okafor', memo: '', date: '2026-11-06' }, today)).toBeNull();
  });

  it("asks whose rent it is when rooms have the same rent and the sender's name says nothing", () => {
    const s = rooms();
    expect(suggestMatch(s, { amount: 90_000, payer: 'J DOE', memo: '', date: '2026-11-02' }, today)).toBeNull();
    // Named: it goes to that tenant, with confidence.
    expect(suggestMatch(s, { amount: 90_000, payer: 'GRACE LIU', memo: '', date: '2026-11-02' }, today)).toMatchObject({ leaseId: 'l-grace', confidence: 'high' });
  });

  it('asks rather than assumes when an unnamed deposit could be rent marked paid or another room still owing', () => {
    const s = rooms();
    markPaid(s, 'l-sam');
    const t = deposit(s, 'J DOE');
    expect(markedPayment(s, t)).toBeUndefined();
    expect(markedCandidates(s, t)).toHaveLength(1); // offered as "already marked paid" in "Whose rent is it?"
    // Once Grace has paid too, the only place it fits is Sam's rent.
    s.payments.push({ id: 'pay-bank-grace', leaseId: 'l-grace', period: '2026-11', date: '2026-11-01', amount: 90_000, method: 'etransfer', source: 'bank', createdAt: '2026-11-01T09:00:00Z' });
    expect(markedPayment(s, t)?.leaseId).toBe('l-sam');
  });

  it('"Mark paid" is for this month while it is unpaid, not the oldest month owing', () => {
    const s = rooms();
    const sam = s.leases.find((l) => l.id === 'l-sam')!;
    s.payments = s.payments.filter((p) => !(p.leaseId === 'l-sam' && p.period === '2026-09'));
    expect(defaultPeriod(s, sam, today)).toBe('2026-11');
    markPaid(s, 'l-sam');
    expect(defaultPeriod(s, sam, today)).toBe('2026-09');
  });

  it('shows the day rent was paid, and how many rooms have paid', () => {
    const s = rooms();
    const unit = s.units.find((u) => u.id === 'u-bsmt')!;
    expect(roomsPaid(s, unit, today)).toEqual({ rented: 2, charged: 2, paid: 0, late: 2 });
    markPaid(s, 'l-sam', '2026-11-03');
    expect(paidOn(nov(s, 'l-sam'))).toBe('2026-11-03');
    expect(roomsPaid(s, unit, today)).toEqual({ rented: 2, charged: 2, paid: 1, late: 1 });
  });

  it('counts rooms rented before their rent starts (move-in later this month or next)', () => {
    const s = rooms();
    const unit = s.units.find((u) => u.id === 'u-bsmt')!;
    for (const l of s.leases.filter((x) => x.unitId === unit.id)) l.start = '2026-12-01';
    const sum = roomsPaid(s, unit, today);
    expect(sum).toEqual({ rented: 2, charged: 0, paid: 0, late: 0, startsOn: '2026-12-01' });
    expect(roomsPill(sum, (d) => d.slice(5)).label).toBe('2 rooms rented · rent starts 12-01');
    expect(roomsPill(roomsPaid(rooms(), unit, today), (d) => d).label).toBe('0 of 2 paid');
  });

  it('keeps a room tenant whose lease has no room number (the unit was switched to by the room later)', () => {
    const s = rooms();
    const unit = s.units.find((u) => u.id === 'u-bsmt')!;
    s.tenants.push({ id: 't-ana', unitId: unit.id, names: ['Ana Ruiz'], email: '', phone: '', noticeMethod: 'hand', emailConsent: false, aliases: [] });
    s.leases.push({ id: 'l-ana', unitId: unit.id, tenantId: 't-ana', start: '2026-06-01', rent: 80_000, dueDay: 1, paymentMethod: 'etransfer', lmrDeposit: 0, utilities: '', parking: false, pets: false, emailNoticeConsent: false });
    expect(activeLeases(s, unit.id, today).map((l) => l.id)).toContain('l-ana');
    expect(journeyLeases(s, unit, today).map((l) => l.id)).toEqual(['l-sam', 'l-grace', 'l-ana']);
  });
});
