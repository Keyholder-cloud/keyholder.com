import { describe, expect, it } from 'vitest';
import { emailHtml } from './emailHtml';
import { twoStepCodeMail, welcomeMail } from './mails';

describe('designed emails', () => {
  const appUrl = 'https://keyholder.cloud';
  it('a tenant email leads with the landlord, lays out the receipt, and keeps Keyholder to a small footer', () => {
    const text = 'Hi Maya,\n\nThank you.\n\nReceipt number: 1063\nAmount: $1,650.00\n\nSam Lee\n\n—\nSent for Sam Lee by Keyholder. Reply to this email to reach your landlord.';
    const h = emailHtml({ text, kind: 'receipt', subject: 'Rent receipt #1063', appUrl, hasPdf: true });
    expect(h).toContain('From Sam Lee');
    expect(h).toMatch(/<td[^>]*>Amount<\/td><td[^>]*>\$1,650\.00<\/td>/);
    expect(h).toContain('/email-logo.png" width="14"');
    expect(h).not.toContain('— Sent for');
  });
  it('a link becomes a button, a code becomes a big code, and text is escaped', () => {
    const w = welcomeMail('a@b.c', 'Sam <b>', 'https://keyholder.cloud/#/verify?t=1');
    const h = emailHtml({ text: w.text, kind: w.kind, subject: w.subject, appUrl });
    expect(h).toContain('>Confirm my email</a>'); expect(h).not.toContain('<b>');
    const c = twoStepCodeMail('a@b.c', 'Sam', '482913');
    expect(emailHtml({ text: c.text, kind: c.kind, subject: c.subject, appUrl })).toMatch(/data-code[^>]*>482913</);
  });
});
