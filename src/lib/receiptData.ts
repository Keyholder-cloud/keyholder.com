import type { AppState, IncomeKind, Receipt } from '../data/types';
import { fmt } from './money';
import { fmtPeriod } from './dates';
import { leaseLedger } from './finance';
import type { ReceiptPdfData } from './receiptPdf';

// What a rent receipt says: one place, used by the email (the PDF the tenant gets) and the app's View, so the two match.

export const receiptMethod = (m?: string) => (m === 'etransfer' ? 'e-Transfer' : m === 'direct-deposit' ? 'Direct deposit' : m ? m[0].toUpperCase() + m.slice(1) : 'Not stated');

/** The receipt's details, as of `asOf` (the day it was sent, for a sent receipt). */
/** Other income, in plain words. */
export const INCOME_KINDS: { id: IncomeKind; label: string; icon: string }[] = [
  { id: 'bill', label: 'Bill share', icon: 'bolt' },
  { id: 'parking', label: 'Parking', icon: 'pin' },
  { id: 'laundry', label: 'Laundry', icon: 'drop' },
  { id: 'storage', label: 'Storage', icon: 'box' },
  { id: 'late-fee', label: 'Late fee', icon: 'clock' },
  { id: 'other', label: 'Other', icon: 'cash' },
  { id: 'deposit', label: "Last month's rent deposit", icon: 'key' },
];
export const incomeKindLabel = (k: IncomeKind) => INCOME_KINDS.find((x) => x.id === k)?.label ?? 'Other';

export function receiptData(state: AppState, r: Receipt, asOf: string): ReceiptPdfData | null {
  if (r.incomeId) return incomeReceiptData(state, r, asOf);
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

/** A receipt for other income (a bill share, parking…): the same receipt, saying what the money was for. */
function incomeReceiptData(state: AppState, r: Receipt, asOf: string): ReceiptPdfData | null {
  const inc = (state.income ?? []).find((x) => x.id === r.incomeId);
  if (!inc) return null;
  const lease = state.leases.find((l) => l.id === inc.leaseId);
  const tenant = state.tenants.find((t) => t.id === lease?.tenantId);
  const unit = state.units.find((u) => u.id === lease?.unitId);
  const prop = state.properties.find((p) => p.id === (unit?.propertyId ?? inc.propertyId));
  const owner = state.profile.name || state.profile.account?.name || 'Your landlord';
  const email = state.profile.account?.email || state.profile.email || undefined;
  const room = unit ? (lease?.room ?? (/^[A-Z0-9]{1,3}$/i.test(unit.label) ? `Unit ${unit.label}` : unit.label)) : '';
  const what = inc.kind === 'deposit' ? "Last month's rent (deposit)" : `${inc.label}${inc.kind === 'bill' ? ' (your share)' : ''}`;
  return {
    number: r.number, issued: (r.sentAt ?? asOf).slice(0, 10), title: inc.kind === 'deposit' ? 'DEPOSIT RECEIPT' : 'PAYMENT RECEIPT', forWhat: what, kindLabel: inc.kind === 'deposit' ? undefined : incomeKindLabel(inc.kind),
    landlord: { name: owner, email, phone: state.profile.phone },
    tenant: tenant?.names.join(' & ') ?? '—', rental: prop ? `${prop.address}${room ? `, ${room}` : ''}` : (room || '—'),
    period: what, amount: fmt(inc.amount), paidOn: inc.date, method: receiptMethod(inc.method), note: inc.note || r.note,
  };
}
