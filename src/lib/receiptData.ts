import type { AppState, Receipt } from '../data/types';
import { fmt } from './money';
import { fmtPeriod } from './dates';
import { leaseLedger } from './finance';
import type { ReceiptPdfData } from './receiptPdf';

// What a rent receipt says: one place, used by the email (the PDF the tenant gets) and the app's View, so the two match.

export const receiptMethod = (m?: string) => (m === 'etransfer' ? 'e-Transfer' : m === 'direct-deposit' ? 'Direct deposit' : m ? m[0].toUpperCase() + m.slice(1) : 'Not stated');

/** The receipt's details, as of `asOf` (the day it was sent, for a sent receipt). */
export function receiptData(state: AppState, r: Receipt, asOf: string): ReceiptPdfData | null {
  const pay = state.payments.find((p) => p.id === r.paymentId);
  if (!pay) return null;
  const lease = state.leases.find((l) => l.id === pay.leaseId);
  const tenant = state.tenants.find((t) => t.id === lease?.tenantId);
  const unit = state.units.find((u) => u.id === lease?.unitId);
  const prop = state.properties.find((p) => p.id === unit?.propertyId);
  const owner = state.profile.name || state.profile.account?.name || 'Your landlord';
  const email = state.profile.account?.email || state.profile.email || undefined;
  const room = unit ? (lease?.room ?? (/^[A-Z0-9]{1,3}$/i.test(unit.label) ? `Unit ${unit.label}` : unit.label)) : '';
  const line = lease && pay.period ? leaseLedger(lease, state.payments, asOf).find((x) => x.period === pay.period) : undefined;
  return {
    number: r.number, issued: (r.sentAt ?? asOf).slice(0, 10),
    landlord: { name: owner, email, phone: state.profile.phone },
    tenant: tenant?.names.join(' & ') ?? '—', rental: prop ? `${prop.address}${room ? `, ${room}` : ''}` : (room || '—'),
    period: pay.period ? fmtPeriod(pay.period) : '—', amount: fmt(pay.amount), paidOn: pay.date, method: receiptMethod(pay.method),
    balance: line && line.paid < line.charge ? fmt(line.charge - line.paid) : undefined, note: r.note,
  };
}
