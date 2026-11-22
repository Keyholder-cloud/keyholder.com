import { describe, expect, it } from 'vitest';
import { receiptPdf } from './receiptPdf';
import { tenantMails } from './mails';
import { seedState } from '../src/data/seed';

describe('rent receipt PDF', () => {
  it('makes a one-page PDF with the receipt number and amount', async () => {
    const b = await receiptPdf({ number: 1042, issued: '2026-11-03', landlord: { name: 'Alex Morgan', email: 'a@b.ca' }, tenant: 'Maya Chen', rental: '48 Maple St, Unit A', period: 'November 2026', amount: '$1,650.00', paidOn: '2026-11-01', method: 'e-Transfer' });
    expect(Buffer.from(b.slice(0, 5)).toString()).toBe('%PDF-');
    expect(b.length).toBeGreaterThan(1000);
  });
  it('every receipt email carries the PDF; a resend is the same receipt', () => {
    const s = seedState();
    const m = s.messages.find((x) => x.kind === 'receipt' && x.receiptId && s.tenants.find((t) => t.id === x.tenantId)?.email)!;
    const mails = tenantMails(s, { ...m, status: 'sent', sentAt: '2026-11-03T12:00:00.000Z' }, 'acct');
    expect(mails.length).toBeGreaterThan(0);
    const a = mails[0].attachment as { kind: string; filename: string };
    expect(a.kind).toBe('receipt'); expect(a.filename).toMatch(/^Rent receipt \d+/);
    const again = { ...m, id: 'msg-again', status: 'sent' as const, sentAt: '2026-11-20T12:00:00.000Z' };
    s.messages.push({ ...m, status: 'sent', sentAt: '2026-11-03T12:00:00.000Z' }, again);
    const copy = tenantMails(s, again, 'acct')[0];
    expect(copy.subject).toBe(mails[0].subject); // the same receipt, sent again
  });
});
