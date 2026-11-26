import type { AppState, Lease, Unit } from '../data/types';

// Notice of a visit (entry): an inspection, a repair, a showing… sent to everyone in a unit, with the landlord
// copied. Most provinces ask for at least 24 hours' written notice, for entry between 8 a.m. and 8 p.m.;
// less notice needs a reason (an emergency, or the tenant agreed).

export const VISIT_KINDS = ['Inspection', 'Maintenance or repair', 'Pest control', 'Showing to a buyer or new tenant', 'Appraisal or insurance visit', 'Other'] as const;
export const URGENCY = ['Emergency', 'Urgent repair', 'The tenant agreed to this time'] as const;

/** Hours from now to the visit (local time). */
export function hoursUntil(date: string, time: string, now = new Date()): number {
  return (new Date(`${date}T${time || '00:00'}:00`).getTime() - now.getTime()) / 3_600_000;
}
/** Entry is usually allowed only between 8 a.m. and 8 p.m. */
export const outsideHours = (time: string) => !!time && (time < '08:00' || time > '20:00');

const longDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
export const clock = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`; };

export function visitMessage(state: AppState, unit: Unit, lease: Lease, v: { date: string; time: string; kind: string; urgency?: string; notes?: string }) {
  const tenant = state.tenants.find((t) => t.id === lease.tenantId);
  const prop = state.properties.find((p) => p.id === unit.propertyId);
  const owner = state.profile.name || state.profile.account?.name || 'Your landlord';
  const place = `${prop?.address ?? ''}${/^[A-Z0-9]{1,3}$/i.test(unit.label) ? `, Unit ${unit.label}` : `, ${unit.label}`}`;
  const subject = `${v.urgency ? 'Urgent: ' : ''}Notice of entry: ${v.kind.toLowerCase()} on ${shortDay(v.date)} at ${clock(v.time)}`;
  const body = [
    `Hi ${tenant ? tenant.names.map((n) => n.split(' ')[0]).join(' & ') : 'there'},`, '',
    `This is notice that ${owner}, or someone working for them, will enter your home for the visit below.`, '',
    `Visit: ${v.kind}`,
    `Date: ${longDay(v.date)}`,
    `Time: ${clock(v.time)}`,
    `Address: ${place}`,
    v.urgency ? `Urgency: ${v.urgency}` : '', '',
    v.notes ? `${v.notes.trim()}` : '', v.notes ? '' : '',
    v.urgency === 'Emergency' ? 'This is an emergency, so the usual 24 hours’ notice does not apply.'
      : v.urgency === 'The tenant agreed to this time' ? 'As agreed with you, this visit is on shorter notice than the usual 24 hours.'
        : v.urgency ? 'This visit is on short notice because the repair is urgent.' : 'This notice is given at least 24 hours before the visit.',
    'You do not need to be home. If the time does not work for you, reply to this email.', '',
    owner,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  return { subject, body };
}
