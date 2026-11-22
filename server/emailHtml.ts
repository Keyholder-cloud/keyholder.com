// Every email also goes out as a designed HTML version, made from its plain text when it is sent (the plain text
// stays as the fallback for mail apps that show text only). Tenant emails lead with the landlord's name: they are
// from the landlord. Keyholder appears only as a very small logo and line at the bottom.
//
// The plain text is turned into blocks:
//   "Hi Maya,"                    → the greeting
//   lines starting with "• "      → a list
//   "Label: value" lines (2+)     → a details table (a receipt's number, amount, month…)
//   a line that is only a link,
//   or "Open Keyholder: https://" → a button
//   anything else                 → a paragraph (links inside it are made clickable)

const BRAND = '#4F46E5', INK = '#101828', SOFT = '#475467', FAINT = '#98A2B3', RULE = '#EAECF0', BG = '#F4F5F9';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const URL_RE = /https?:\/\/[^\s<>"]+/g;
const linkify = (s: string) => esc(s).replace(/https?:\/\/[^\s<>"]+/g, (u) => `<a href="${u}" style="color:${BRAND};text-decoration:underline;word-break:break-all">${u}</a>`);

/** The button's words, for a link on its own line, by kind of email. */
const BUTTON: Record<string, string> = {
  welcome: 'Confirm my email', reset: 'Choose a new password', invite: 'Set my password', digest: 'Open Keyholder', 'ticket-new': 'Open the support inbox',
};
/** Emails Keyholder sends to its own users (everything else is from a landlord to a tenant). */
const SYSTEM = new Set(['welcome', 'reset', 'invite', 'ticket-ack', 'ticket-reply', 'ticket-new', 'digest', 'two-step-code']);

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0"><tr><td style="border-radius:10px;background:${BRAND}">` +
  `<a href="${esc(href)}" style="display:inline-block;padding:13px 24px;font-weight:600;font-size:15px;color:#ffffff;text-decoration:none;border-radius:10px">${esc(label)}</a></td></tr></table>`;

export function emailHtml({ text, kind, subject, appUrl, hasPdf }: { text: string; kind: string; subject: string; appUrl: string; hasPdf?: boolean }): string {
  let body = text.replace(/\r\n/g, '\n').trim();
  // The footer lines the plain text ends with become the small footer.
  let sentFor = '';
  const tenantFoot = body.match(/\n+—\nSent for (.+?) by Keyholder\. Reply to this email to reach your landlord\.$/);
  if (tenantFoot) { sentFor = tenantFoot[1]; body = body.slice(0, tenantFoot.index).trim(); }
  body = body.replace(/\n+— Keyholder\nRental automation for Canadian landlords$/, '').trim();
  const system = SYSTEM.has(kind);
  const from = system ? '' : sentFor;
  const code = kind === 'two-step-code' ? body.match(/\b(\d{6})\b/)?.[1] : undefined;

  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: string[] = [];
  blocks.forEach((b, i) => {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => l.startsWith('• '))) {
      out.push(`<ul style="margin:14px 0;padding:0 0 0 20px;color:${INK}">${lines.map((l) => `<li style="margin:6px 0">${linkify(l.slice(2))}</li>`).join('')}</ul>`);
      return;
    }
    if (lines.length === 1 && /^https?:\/\/\S+$/.test(lines[0])) { out.push(button(lines[0], BUTTON[kind] ?? 'Open the link')); return; }
    const labelled = lines.length === 1 ? lines[0].match(/^(.{2,40}?):\s*(https?:\/\/\S+)$/) : null;
    if (labelled) { out.push(button(labelled[2], labelled[1])); return; }
    const pairs = lines.map((l) => l.match(/^([A-Z][^:]{1,30}):\s+(.+)$/));
    if (lines.length >= 2 && pairs.every(Boolean)) {
      out.push(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0;border:1px solid ${RULE};border-radius:12px;border-collapse:separate;overflow:hidden">` +
        pairs.map((p, k) => {
          const strong = /^(Amount|Total)/i.test(p![1]);
          return `<tr><td style="padding:10px 14px;${k ? `border-top:1px solid ${RULE};` : ''}color:${SOFT};font-size:14px;width:42%">${esc(p![1])}</td>` +
            `<td style="padding:10px 14px;${k ? `border-top:1px solid ${RULE};` : ''}color:${INK};font-size:${strong ? 18 : 14}px;font-weight:${strong ? 700 : 500};text-align:right">${linkify(p![2])}</td></tr>`;
        }).join('') + '</table>');
      return;
    }
    // Code emails: the code itself, big and easy to copy.
    if (code && b.includes(code) && !out.some((x) => x.includes('data-code'))) {
      out.push(`<p style="margin:14px 0;color:${INK};font-size:16px;line-height:1.6">${linkify(b)}</p>`);
      out.push(`<div data-code style="margin:8px 0 18px;padding:16px;border-radius:12px;background:#EEF0FF;text-align:center;font-size:32px;letter-spacing:8px;font-weight:700;color:${BRAND};font-family:Menlo,Consolas,monospace">${code}</div>`);
      return;
    }
    const greet = i === 0 && /^(Hi|Hello|Dear)\b.{0,60},$/.test(lines[0]);
    out.push(`<p style="margin:${greet ? '0 0 14px' : '14px 0'};color:${INK};font-size:16px;line-height:1.6">${lines.map(linkify).join('<br>')}</p>`);
  });
  if (hasPdf && !/attached/i.test(body)) out.push(`<p style="margin:18px 0 0;padding:10px 14px;border-radius:10px;background:#F0FDF4;color:#067647;font-size:14px">&#128206; The PDF is attached to this email.</p>`);

  const logo = `${appUrl.replace(/\/$/, '')}/email-logo.png`;
  const foot = system
    ? `Keyholder · rental tools for Canadian landlords`
    : `Sent for ${esc(sentFor || 'your landlord')} with Keyholder. Reply to this email to reach your landlord.`;
  const pre = esc(body.replace(URL_RE, '').replace(/\s+/g, ' ').slice(0, 120));

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="background:#ffffff;border-radius:16px;border:1px solid ${RULE};overflow:hidden">
<div style="height:5px;background:${BRAND};background-image:linear-gradient(90deg,#4F46E5,#7C3AED,#38BDF8)"></div>
<div style="padding:28px 30px 26px">
${from ? `<p style="margin:0 0 4px;color:${FAINT};font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase">From ${esc(from)}</p>` : ''}
<h1 style="margin:0 0 20px;color:${INK};font-size:21px;line-height:1.3;font-weight:700">${esc(subject)}</h1>
${out.join('\n')}
</div></td></tr>
<tr><td align="center" style="padding:18px 10px 6px">
<img src="${logo}" width="14" height="14" alt="Keyholder" style="display:inline-block;vertical-align:middle;border:0;border-radius:3px;margin-right:6px"><span style="color:${FAINT};font-size:11px;vertical-align:middle">${foot}</span>
</td></tr>
</table></td></tr></table></body></html>`;
}
