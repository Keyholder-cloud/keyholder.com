import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AppState, Applicant, BankConnection, BankName, BankTxn, ExpenseCategory, Income, Listing, Notice, TodoPref, Comparable, Expense, Lease, Mortgage, MortgageChange, Payment, Profile, Property, Tenant, Tone, Unit, Valuation,
} from './types';
import { emptyState, seedState, STATE_VERSION, defaultProfile } from './seed';
import { addDays, dueDate, fmtDate, periodOf, todayISO } from '../lib/dates';
import { activeLease, currentLeases, leaseLedger, openRooms } from '../lib/finance';
import { markedPayment, suggestMatch } from '../lib/matching';
import { reminderDraft } from '../lib/templates';
import { fmt } from '../lib/money';
import { BANK_CHECK_HOURS } from '../lib/jurisdiction';
import { levelInfo, propertyLevel, type Level } from '../lib/levels';
import { formById } from '../lib/forms';
import { vendorKey } from '../lib/bankrules';
import { lineKey, type Statement } from '../lib/statements';
import { CATEGORIES } from '../lib/jurisdiction';
import { api, banksOn, getConn, serverMode, setUser } from './api';
import * as sync from './sync';

// Stage 1 store: all data lives in the browser (localStorage). In stage 2 each action below
// becomes an API call; the action names are the contract for the backend.

const KEY = 'keyholder:v1';
/** While admin views the sample, the browser's own data waits here and comes back on sign out. */
const STASH = 'keyholder:v1:stash';
export const uid = (p = 'id') => `${p}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (s.version === STATE_VERSION) return s;
    }
  } catch { /* fall through */ }
  return seedState();
}

function readStash(): AppState | null {
  try {
    const raw = localStorage.getItem(STASH);
    const s = raw ? (JSON.parse(raw) as AppState) : null;
    return s && s.version === STATE_VERSION ? s : null;
  } catch { return null; }
}

/**
 * Preview logins only (Stage 1): these sit in the website's code, so they are a lock, not security.
 * test / test opens the demo (sample properties); admin / admin opens the support dashboard.
 * Real admin accounts with proper passwords come with the backend.
 */
export const PREVIEW_LOGINS = { demo: { username: 'test', password: 'test' }, admin: { username: 'admin', password: 'admin' } } as const;
export type PreviewKind = keyof typeof PREVIEW_LOGINS;
export const isAdmin = (s: AppState) => s.profile.account?.provider === 'admin';
/** The demo or the admin: both look at the sample properties, never at a real account's data. */
export const isPreviewUser = (s: AppState) => s.profile.account?.provider === 'admin' || s.profile.account?.provider === 'demo';

function save(s: AppState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: keep working in memory */ }
}

type Mut = (fn: (d: AppState) => void) => void;

function audit(d: AppState, action: string, detail = '') {
  d.audit.unshift({ id: uid('a'), at: new Date().toISOString(), action, detail });
  if (d.audit.length > 500) d.audit.length = 500;
}

const tenantName = (d: AppState, leaseId: string) => {
  const l = d.leases.find((x) => x.id === leaseId);
  const t = d.tenants.find((x) => x.id === l?.tenantId);
  return t?.names.join(' & ') ?? 'tenant';
};

/** `get` reads the latest state, for actions whose message depends on it (the updater itself may run later). */
function makeActions(mut: Mut, toast: (s: string) => void, get: () => AppState) {
  const today = () => todayISO();

  /** Record a payment, draft (or send) its receipt, and cancel reminders it makes moot (AR-3). */
  function recordPayment(d: AppState, p: Omit<Payment, 'id' | 'createdAt'>): Payment {
    const pay: Payment = { ...p, id: uid('pay'), createdAt: new Date().toISOString() };
    d.payments.push(pay);
    const number = Math.max(1000, ...d.receipts.map((r) => r.number)) + 1;
    const rid = uid('rcpt');
    const lease = d.leases.find((l) => l.id === p.leaseId)!;
    const auto = d.profile.autoSend;
    const nowIso = new Date().toISOString();
    d.receipts.push({ id: rid, number, paymentId: pay.id, status: auto ? 'sent' : 'draft', createdAt: nowIso, sentAt: auto ? nowIso : undefined });
    d.messages.push({
      id: uid('msg'), kind: 'receipt', tenantId: lease.tenantId, leaseId: lease.id, period: p.period, receiptId: rid,
      subject: 'Your rent receipt', body: '', status: auto ? 'sent' : 'draft', edited: false, createdAt: nowIso, sentAt: auto ? nowIso : undefined,
    });
    const line = leaseLedger(lease, d.payments, today()).find((l) => l.period === p.period);
    if (line && line.paid >= line.charge) {
      for (const m of d.messages) if (m.kind === 'reminder' && m.leaseId === lease.id && m.period === p.period && m.status === 'draft') m.status = 'cancelled';
    }
    // Cure tracking (N4-7): if all arrears are paid, a served notice is cancelled by payment.
    const owing = leaseLedger(lease, d.payments, today()).filter((l) => l.due < today() && l.paid < l.charge).length;
    if (!owing) for (const n of d.notices) if (n.leaseId === lease.id && n.status === 'served' && formById(n.formId)?.situation === 'late-rent') { n.status = 'voided-by-payment'; audit(d, 'Notice cancelled by payment', n.kind); }
    audit(d, 'Payment logged', `${fmt(p.amount)} from ${tenantName(d, lease.id)} for ${p.period} (${p.source})`);
    return pay;
  }

  /** Bank and statement lines not looked at yet: money in matched to rent; money out filed by the vendor's remembered choice. */
  function processNew(d: AppState) {
    let matched = 0, filed = 0;
    for (const x of d.txns) {
      if ((x.source !== 'bank' && x.source !== 'statement') || x.status !== 'new' || x.checked) continue;
      x.checked = true;
      const key = vendorKey(x.payer);
      if (x.amount > 0) {
        if (autoMatch(d, x)) { matched++; continue; }
        // A sender the owner said is not rent (and not a tenant's name): set aside without asking.
        if (d.profile.notRentPayers?.includes(key) && !isTenantName(d, x.payer)) x.status = 'ignored';
        continue;
      }
      if (d.profile.personalVendors?.includes(key)) { x.status = 'ignored'; continue; }
      const rule = d.profile.vendorRules?.[key];
      if (!rule || !d.properties.some((p) => p.id === rule.propertyId)) continue;
      const e: Expense = { id: uid('exp'), propertyId: rule.propertyId, date: x.date, amount: -x.amount, vendor: x.payer, category: rule.category, kind: 'current', scope: CATEGORIES.find((c) => c.id === rule.category)?.sharedByDefault ? 'shared' : 'direct', createdAt: new Date().toISOString(), note: x.source === 'statement' ? 'From your statement (filed automatically)' : 'From your bank (filed automatically)' };
      d.expenses.unshift(e); x.status = 'expense'; x.expenseId = e.id; filed++;
    }
    if (matched || filed) d.expenses.sort((a, b) => b.date.localeCompare(a.date));
    return { matched, filed };
  }

  function autoMatch(d: AppState, t: BankTxn) {
    const s = suggestMatch(d, t, today());
    // Rent already marked paid by hand: the deposit is that payment (no second payment, no other tenant).
    if (s?.paymentId) { t.status = 'matched'; t.paymentId = s.paymentId; return true; }
    if (s?.confidence === 'high') {
      const lease = d.leases.find((l) => l.id === s.leaseId)!;
      const pay = recordPayment(d, { leaseId: s.leaseId, period: s.period, amount: t.amount, date: t.date, method: lease.paymentMethod, source: t.source });
      t.status = 'matched'; t.paymentId = pay.id;
      return true;
    }
    return false;
  }

  return {
    // ---- Profile & onboarding ----
    /**
     * Demo or admin sign in (preview): set aside this browser's own data, then open a fresh copy of the sample
     * properties (admin starts on the support dashboard). Signing out puts the set-aside data back.
     */
    signInPreview(kind: PreviewKind) {
      mut((d) => {
        if (!d.profile.sample && (d.profile.onboarded || d.profile.account)) {
          const own = structuredClone(d);
          if (own.profile.account) own.profile.account.signedIn = false;
          try { localStorage.setItem(STASH, JSON.stringify(own)); } catch { /* storage blocked: nothing to keep */ }
        }
        const profile = sampleLandlord({ ...defaultProfile(), onboarded: true, sample: true, tourDone: false,
          account: { provider: kind, email: kind, name: kind === 'admin' ? 'Admin' : 'Demo', signedIn: true, created: today() } });
        Object.assign(d, seedState(profile));
      });
    },
    /**
     * A real team member signed in (with the server): only the support dashboard, no landlord data at all.
     * As with the previews, this browser's own data waits aside and comes back on sign out.
     */
    signInTeam(email: string, name: string) {
      mut((d) => {
        if (!d.profile.sample && (d.profile.onboarded || d.profile.account) && d.profile.account?.provider !== 'admin') {
          const own = structuredClone(d);
          if (own.profile.account) own.profile.account.signedIn = false;
          try { localStorage.setItem(STASH, JSON.stringify(own)); } catch { /* storage blocked: nothing to keep */ }
        }
        const next = emptyState({ ...defaultProfile(), onboarded: true, tourDone: true, name, email, account: { provider: 'admin', email, name, signedIn: true, created: today() } });
        next.banks = [];
        Object.assign(d, next);
      });
    },
    /** Signup, step 1: the account (Google or email). The questions come next; the app opens after them. */
    createAccount(account: { provider: 'google' | 'email'; email: string; name: string }) {
      mut((d) => {
        const profile = { ...defaultProfile(), theme: d.profile.theme, name: account.name, email: account.email, onboarded: false, sample: false, tourDone: false,
          account: { ...account, signedIn: true, created: today() } };
        const next = emptyState(profile);
        next.banks = [];
        Object.assign(d, next);
      });
    },
    /** Signup, last step: save the answers and open the dashboard (the tour starts). */
    completeSignup(p: Partial<Profile>) {
      mut((d) => {
        const a = d.profile.account;
        if (!a) return;
        const profile = { ...d.profile, ...p, name: d.profile.name || a.name, email: a.email, onboarded: true, sample: false, tourDone: false };
        const next = emptyState(profile);
        next.banks = [];
        Object.assign(d, next);
        audit(d, 'Account created', `${a.provider === 'google' ? 'Google' : 'Email'} · ${a.email}`);
      });
    },
    signIn() { mut((d) => { if (d.profile.account) d.profile.account.signedIn = true; }); },
    /** Sign out. For admin this also puts back the data that was set aside at admin sign in. */
    signOut() {
      const own = readStash();
      mut((d) => {
        if (d.profile.account?.provider === 'admin' || d.profile.account?.provider === 'demo') Object.assign(d, own ? structuredClone(own) : seedState());
        else if (d.profile.account) d.profile.account.signedIn = false;
      });
      toast('Signed out. See you soon.');
    },
    setProfile(p: Partial<Profile>) { mut((d) => { Object.assign(d.profile, p); }); },
    resetDemo() { mut((d) => { const prof = { ...d.profile }; Object.assign(d, seedState(prof)); }); toast('Sample data restored.'); },
    clearAll() { mut((d) => { Object.assign(d, emptyState({ ...d.profile })); }); toast('All data cleared. Start by adding a property.'); },

    // ---- Properties & units ----
    saveProperty(p: Property) {
      mut((d) => {
        const i = d.properties.findIndex((x) => x.id === p.id);
        if (i >= 0) { d.properties[i] = p; audit(d, 'Property updated', p.nickname); }
        else { d.properties.push(p); audit(d, 'Property added', p.nickname); }
        // Keep one "what you paid" entry in the value history, in step with the property.
        const pv = d.valuations.find((v) => v.propertyId === p.id && v.source === 'purchase');
        if (p.purchasePrice && p.purchaseDate) {
          const v = { propertyId: p.id, date: p.purchaseDate, source: 'purchase' as const, low: p.purchasePrice, likely: p.purchasePrice, high: p.purchasePrice, confidence: 'high' as const, note: 'Purchase price' };
          if (pv) Object.assign(pv, v); else d.valuations.push({ id: uid('v'), ...v });
        }
      });
    },
    /**
     * Archive a property (sold, or no longer rented): leases still running end that day, its listings close, and it
     * leaves Home, Rentals and the totals. Its records stay; taxes still count it up to that day. Restore undoes it.
     */
    archiveProperty(id: string, on: string, reason: 'sold' | 'not-rented') {
      let name = '';
      mut((d) => {
        const p = d.properties.find((x) => x.id === id); if (!p) return;
        name = p.nickname;
        const unitIds = new Set(d.units.filter((u) => u.propertyId === id).map((u) => u.id));
        let ended = 0;
        for (const l of d.leases) if (unitIds.has(l.unitId) && (!l.end || l.end > on)) { l.end = on; ended++; const t = d.tenants.find((x) => x.id === l.tenantId); if (t && !t.movedOut) t.movedOut = on; }
        d.listings = d.listings.filter((x) => !unitIds.has(x.unitId));
        p.archived = true; p.archivedOn = on; p.archivedReason = reason;
        audit(d, 'Property archived', `${p.nickname}: ${reason === 'sold' ? 'sold' : 'no longer rented'} on ${on}${ended ? `, ${ended} lease${ended === 1 ? '' : 's'} ended` : ''}`);
      });
      toast(`${name} archived. Its records are kept for your taxes.`);
    },
    restoreProperty(id: string) {
      mut((d) => { const p = d.properties.find((x) => x.id === id); if (!p) return; p.archived = false; delete p.archivedOn; delete p.archivedReason; audit(d, 'Property restored', p.nickname); });
      toast('Property restored.');
    },
    /** A unit that never had a tenant (added by mistake): removed with its listing and applications. */
    deleteUnit(unitId: string) {
      let label = '';
      mut((d) => {
        const u = d.units.find((x) => x.id === unitId); if (!u || d.leases.some((l) => l.unitId === unitId)) return;
        label = u.label;
        d.units = d.units.filter((x) => x.id !== unitId);
        d.listings = d.listings.filter((x) => x.unitId !== unitId);
        d.applicants = d.applicants.filter((a) => a.unitId !== unitId);
        audit(d, 'Unit deleted', `Unit ${u.label}`);
      });
      if (label) toast(`Unit ${label} deleted.`);
    },
    saveUnit(u: Unit) {
      mut((d) => {
        const i = d.units.findIndex((x) => x.id === u.id);
        if (i >= 0) d.units[i] = u; else d.units.push(u);
        // Switched to "by the room": a lease that was for the whole unit becomes Room 1's.
        if (u.rentedBy === 'room') for (const l of d.leases) if (l.unitId === u.id && !l.room && (!l.end || l.end >= today())) l.room = 'Room 1';
        audit(d, i >= 0 ? 'Unit updated' : 'Unit added', u.label);
      });
    },

    // ---- Tenants & leases ----
    addTenancy(t: Tenant, l: Lease) {
      mut((d) => {
        d.tenants.push(t); d.leases.push(l);
        const u = d.units.find((x) => x.id === l.unitId); if (u) { u.status = 'occupied'; u.rent = l.rent; }
        audit(d, 'Tenant added', `${t.names.join(' & ')}, lease from ${l.start}`);
      });
      toast(`${t.names[0]} added. Rent of ${fmt(l.rent)} is now on the ledger.`);
    },
    saveTenant(t: Tenant) { mut((d) => { const i = d.tenants.findIndex((x) => x.id === t.id); if (i >= 0) d.tenants[i] = t; audit(d, 'Tenant updated', t.names.join(' & ')); }); },
    /**
     * A tenant added by mistake: removes them, their lease(s), payments, receipts, messages and notices. A bank
     * deposit that had been matched to one of their payments goes back to the list to sort. (Someone who lived
     * there should have their lease ended instead, so the records stay.)
     */
    deleteTenant(tenantId: string) {
      let name = '';
      mut((d) => {
        const t = d.tenants.find((x) => x.id === tenantId); if (!t) return;
        name = t.names.join(' & ');
        const leaseIds = new Set(d.leases.filter((l) => l.tenantId === tenantId).map((l) => l.id));
        const unitIds = new Set(d.leases.filter((l) => leaseIds.has(l.id)).map((l) => l.unitId));
        const payIds = new Set(d.payments.filter((p) => leaseIds.has(p.leaseId)).map((p) => p.id));
        d.receipts = d.receipts.filter((r) => !payIds.has(r.paymentId));
        d.payments = d.payments.filter((p) => !leaseIds.has(p.leaseId));
        d.messages = d.messages.filter((m) => m.tenantId !== tenantId && !leaseIds.has(m.leaseId));
        d.notices = d.notices.filter((n) => !leaseIds.has(n.leaseId));
        for (const x of d.txns) if (x.paymentId && payIds.has(x.paymentId)) { x.status = 'new'; delete x.paymentId; }
        d.leases = d.leases.filter((l) => !leaseIds.has(l.id));
        d.tenants = d.tenants.filter((x) => x.id !== tenantId);
        for (const u of d.units) if (unitIds.has(u.id) && !d.leases.some((l) => l.unitId === u.id && (!l.end || l.end >= today()))) u.status = 'vacant';
        audit(d, 'Tenant deleted', `${name}: lease and ${payIds.size} payment${payIds.size === 1 ? '' : 's'} removed`);
      });
      toast(`${name || 'Tenant'} deleted.`);
    },
    saveLease(l: Lease) { mut((d) => { const i = d.leases.findIndex((x) => x.id === l.id); if (i >= 0) d.leases[i] = l; audit(d, 'Lease updated', l.id); }); },
    endTenancy(leaseId: string, end: string) {
      mut((d) => {
        const l = d.leases.find((x) => x.id === leaseId); if (!l) return;
        l.end = end;
        const t = d.tenants.find((x) => x.id === l.tenantId); if (t) t.movedOut = end;
        const u = d.units.find((x) => x.id === l.unitId); if (u) u.status = 'vacant';
        audit(d, 'Tenancy ended', `${tenantName(d, leaseId)} on ${end}`);
      });
    },
    setPause(tenantId: string, reason?: string) {
      mut((d) => { const t = d.tenants.find((x) => x.id === tenantId); if (t) { t.remindersPaused = reason || undefined; audit(d, reason ? 'Reminders paused' : 'Reminders resumed', `${t.names[0]}${reason ? `: ${reason}` : ''}`); } });
    },

    // ---- Payments & receipts ----
    /** Money in that is not rent. From a tenant, a receipt is made too (sent at once when receipts go out automatically). */
    logIncome(i: Omit<Income, 'id' | 'createdAt'>): string {
      const id = uid('inc');
      let auto = false;
      mut((d) => {
        const nowIso = new Date().toISOString();
        d.income = [...(d.income ?? []), { ...i, id, createdAt: nowIso }];
        const lease = i.leaseId ? d.leases.find((l) => l.id === i.leaseId) : undefined;
        if (lease) {
          auto = d.profile.autoSend;
          const number = Math.max(1000, ...d.receipts.map((r) => r.number)) + 1;
          const rid = uid('rcpt');
          d.receipts.push({ id: rid, number, paymentId: '', incomeId: id, status: auto ? 'sent' : 'draft', createdAt: nowIso, sentAt: auto ? nowIso : undefined });
          d.messages.push({ id: uid('msg'), kind: 'receipt', tenantId: lease.tenantId, leaseId: lease.id, period: periodOf(i.date), receiptId: rid, subject: 'Your payment receipt', body: '', status: auto ? 'sent' : 'draft', edited: false, createdAt: nowIso, sentAt: auto ? nowIso : undefined });
        }
        audit(d, 'Income logged', `${fmt(i.amount)} · ${i.label}${lease ? ` from ${tenantName(d, lease.id)}` : ''}`);
      });
      toast(i.leaseId ? (auto ? `${fmt(i.amount)} logged. Receipt sent.` : `${fmt(i.amount)} logged. Receipt ready to send.`) : `${fmt(i.amount)} logged.`);
      return id;
    },
    voidIncome(id: string) {
      mut((d) => {
        const i = (d.income ?? []).find((x) => x.id === id); if (!i) return;
        i.voided = true;
        for (const r of d.receipts) if (r.incomeId === id) r.status = 'superseded';
        for (const m of d.messages) if (m.kind === 'receipt' && m.status === 'draft' && d.receipts.some((r) => r.id === m.receiptId && r.incomeId === id)) m.status = 'cancelled';
        for (const t of d.txns) if (t.incomeId === id) { t.status = 'new'; t.incomeId = undefined; }
        audit(d, 'Income removed', `${fmt(i.amount)} · ${i.label}`);
      });
      toast('Removed. If it came from the bank, it is back in the list to sort.');
    },
    logPayment(p: Omit<Payment, 'id' | 'createdAt'>) {
      let auto = false;
      mut((d) => { recordPayment(d, p); auto = d.profile.autoSend; });
      toast(auto ? `Payment of ${fmt(p.amount)} logged. Receipt sent.` : `Payment of ${fmt(p.amount)} logged. Receipt drafted for your approval.`);
    },
    /** Edits never overwrite silently (RL-5): void the old payment, log a new one, supersede the receipt. */
    correctPayment(paymentId: string, changes: Partial<Pick<Payment, 'amount' | 'date' | 'period' | 'method' | 'note'>>) {
      mut((d) => {
        const old = d.payments.find((p) => p.id === paymentId); if (!old) return;
        old.voided = true;
        const oldR = d.receipts.find((r) => r.paymentId === paymentId && r.status !== 'superseded');
        const next = recordPayment(d, { ...old, ...changes, source: old.source });
        const newR = d.receipts.find((r) => r.paymentId === next.id)!;
        if (oldR) { oldR.status = 'superseded'; newR.supersedes = oldR.id; newR.note = `Replaces receipt #${oldR.number}`; }
        audit(d, 'Payment corrected', `Receipt #${oldR?.number ?? '—'} superseded`);
      });
      toast('Payment corrected. The old receipt is marked superseded.');
    },
    voidPayment(paymentId: string) {
      mut((d) => {
        const p = d.payments.find((x) => x.id === paymentId); if (!p) return;
        p.voided = true;
        for (const r of d.receipts) if (r.paymentId === paymentId) r.status = 'superseded';
        for (const t of d.txns) if (t.paymentId === paymentId) { t.status = 'new'; t.paymentId = undefined; }
        audit(d, 'Payment voided', `${fmt(p.amount)} for ${p.period}`);
      });
      toast('Payment undone. If it came from the bank feed, it is back in the tray.');
    },
    approveMessage(id: string, edit?: { subject: string; body: string }) {
      let text = '';
      mut((d) => {
        const m = d.messages.find((x) => x.id === id); if (!m) return;
        if (edit) { m.subject = edit.subject; m.body = edit.body; m.edited = true; }
        m.status = 'sent'; m.sentAt = new Date().toISOString();
        if (m.receiptId) { const r = d.receipts.find((x) => x.id === m.receiptId); if (r) { r.status = 'sent'; r.sentAt = m.sentAt; } }
        if (!edit) d.profile.approvedUnchanged += 1;
        const rr = d.receipts.find((r) => r.id === m.receiptId);
        const pay = d.payments.find((p) => p.id === rr?.paymentId) ?? (d.income ?? []).find((x) => x.id === rr?.incomeId);
        text = m.kind === 'receipt' ? `Receipt for ${fmt(pay?.amount ?? 0)} sent to ${tenantName(d, m.leaseId)}.` : `Reminder sent to ${tenantName(d, m.leaseId)}.`;
        audit(d, m.kind === 'receipt' ? 'Receipt sent' : 'Reminder sent', tenantName(d, m.leaseId));
      });
      toast(text);
    },
    /** Sends a receipt again (a copy, same number) — or sends it for the first time if it was still a draft. */
    /** A month marked paid up (paid before Keyholder): record it as a payment on its due date and send the receipt. */
    sendPaidUpReceipt(leaseId: string, period: string, amount: number, date: string) {
      let text = '';
      mut((d) => {
        const lease = d.leases.find((l) => l.id === leaseId); if (!lease || amount <= 0) return;
        const pay = recordPayment(d, { leaseId, period, amount, date, method: lease.paymentMethod, source: 'manual', note: 'Paid before Keyholder' });
        const nowIso = new Date().toISOString();
        const r = d.receipts.find((x) => x.paymentId === pay.id)!;
        if (r.status === 'draft') { r.status = 'sent'; r.sentAt = nowIso; }
        for (const m of d.messages) if (m.kind === 'receipt' && m.receiptId === r.id && m.status === 'draft') { m.status = 'sent'; m.sentAt = nowIso; }
        text = `Receipt #${r.number} sent to ${tenantName(d, leaseId)}.`;
      });
      if (text) toast(text);
    },
    resendReceipt(receiptId: string) {
      let text = '';
      mut((d) => {
        const r = d.receipts.find((x) => x.id === receiptId); if (!r) return;
        const pay = d.payments.find((p) => p.id === r.paymentId);
        const inc = r.incomeId ? (d.income ?? []).find((x) => x.id === r.incomeId) : undefined;
        const lease = d.leases.find((l) => l.id === (pay?.leaseId ?? inc?.leaseId)); if ((!pay && !inc) || !lease) return;
        const nowIso = new Date().toISOString();
        const draft = d.messages.find((m) => m.kind === 'receipt' && m.receiptId === r.id && m.status === 'draft');
        if (draft) { draft.status = 'sent'; draft.sentAt = nowIso; }
        else d.messages.push({ id: uid('msg'), kind: 'receipt', tenantId: lease.tenantId, leaseId: lease.id, period: pay?.period ?? periodOf(inc!.date), receiptId: r.id, subject: inc ? 'Your payment receipt' : 'Your rent receipt', body: '', status: 'sent', edited: false, createdAt: nowIso, sentAt: nowIso });
        if (r.status === 'draft') { r.status = 'sent'; r.sentAt = nowIso; }
        text = `Receipt #${r.number} ${draft ? 'sent' : 'sent again'} to ${tenantName(d, lease.id)}.`;
        audit(d, draft ? 'Receipt sent' : 'Receipt sent again', `#${r.number} · ${tenantName(d, lease.id)}`);
      });
      if (text) toast(text);
    },
    sendReminder(lease: Lease, period: string, tone: Tone, edit?: { subject: string; body: string }) {
      mut((d) => {
        const draft = edit ?? reminderDraft(d, lease, period, tone, today());
        const now = new Date().toISOString();
        d.messages.push({ id: uid('msg'), kind: 'reminder', tenantId: lease.tenantId, leaseId: lease.id, period, tone, subject: draft.subject, body: draft.body, status: 'sent', edited: !!edit, createdAt: now, sentAt: now });
        if (!edit) d.profile.approvedUnchanged += 1;
        audit(d, 'Reminder sent', `${tone} to ${tenantName(d, lease.id)} for ${period}`);
      });
      toast(`Reminder sent. It stops the moment the payment is logged.`);
    },
    skipReminder(lease: Lease, period: string, tone: Tone) {
      mut((d) => { d.messages.push({ id: uid('msg'), kind: 'reminder', tenantId: lease.tenantId, leaseId: lease.id, period, tone, subject: '', body: '', status: 'cancelled', edited: false, createdAt: new Date().toISOString() }); });
    },
    discardMessage(id: string) { mut((d) => { const m = d.messages.find((x) => x.id === id); if (m) m.status = 'cancelled'; }); },
    setAutoSend(on: boolean) { mut((d) => { d.profile.autoSend = on; d.profile.autoSendOffered = true; audit(d, on ? 'Automatic receipts and reminders on' : 'Back to approving each message'); }); },

    // ---- Bank & email ----
    /**
     * Live site: an earlier version let a landlord "connect" a pretend bank that made up deposits. Remove that
     * connection, those deposits, anything they filed or marked as paid, and note each removal in the account's
     * history. Real Plaid connections and their transactions are never touched.
     */
    removePretendBank() {
      let removed = 0;
      mut((d) => {
        const banks = (d.banks ?? []).filter((b) => !realBank(b));
        const fake = d.txns.filter(fakeTxn);
        if (!banks.length && !fake.length) return;
        const realPay = new Set(d.txns.filter((t) => !fakeTxn(t)).flatMap((t) => (t.paymentId ? [t.paymentId] : [])));
        const payIds = new Set([...fake.flatMap((t) => (t.paymentId ? [t.paymentId] : [])), ...d.payments.filter((x) => x.source === 'bank' && !realPay.has(x.id)).map((x) => x.id)]);
        const expIds = new Set(fake.flatMap((t) => (t.expenseId ? [t.expenseId] : [])));
        const rcptIds = new Set(d.receipts.filter((r) => payIds.has(r.paymentId)).map((r) => r.id));
        for (const b of banks) audit(d, 'Practice bank connection removed', `${b.bank} ${b.accountMask}: it was not a real bank connection`);
        if (fake.length) audit(d, 'Made-up bank transactions removed', `${fake.length} from the practice bank connection`);
        for (const x of d.payments.filter((y) => payIds.has(y.id))) audit(d, 'Rent un-marked', `${fmt(x.amount)} on ${x.date}: a made-up deposit had marked it paid`);
        for (const e of d.expenses.filter((y) => expIds.has(y.id))) audit(d, 'Expense removed', `${fmt(e.amount)} ${e.vendor}: filed from a made-up bank transaction`);
        d.messages.forEach((m) => { if (m.receiptId && rcptIds.has(m.receiptId) && m.status === 'draft') m.status = 'cancelled'; });
        d.receipts = d.receipts.filter((r) => !rcptIds.has(r.id));
        d.payments = d.payments.filter((x) => !payIds.has(x.id));
        d.expenses = d.expenses.filter((e) => !expIds.has(e.id));
        d.txns = d.txns.filter((t) => !fakeTxn(t));
        d.banks = (d.banks ?? []).filter(realBank);
        if (!d.banks.length) d.profile.rentArrival = 'manual';
        removed = banks.length + fake.length;
      });
      if (removed) toast(banksOn()
        ? 'The practice bank connection was removed (it made up deposits). Connect your real bank in Settings.'
        : 'Bank checks are not live yet, so the practice bank connection was removed. You mark rent paid yourself for now.');
    },
    connectBank(bank: BankName) {
      if (!banksOn()) return; // live site: no bank-data provider yet
      mut((d) => {
        d.banks = d.banks ?? [];
        d.banks.push({ id: uid('bank'), bank, accountMask: `•••• ${Math.floor(1000 + Math.random() * 8999)}`, status: 'connected', lastSync: new Date().toISOString() });
        d.profile.rentArrival = 'bank';
        audit(d, 'Bank connected', `${bank} (read-only)`);
      });
      toast(`${bank} connected. Keyholder spots rent as soon as it arrives.`);
    },
    reauthBank(id: string) { mut((d) => { const b = d.banks.find((x) => x.id === id); if (b) { b.status = 'connected'; b.lastSync = new Date().toISOString(); } }); toast('Connection renewed.'); },
    disconnectBank(id: string) {
      if (serverMode()) {
        void api('DELETE', `/api/bank/${id}`).then(() => sync.refresh()).then(() => toast('Disconnected. Keyholder no longer sees that account.'), (e) => toast((e as Error).message));
        return;
      }
      mut((d) => { const b = d.banks.find((x) => x.id === id); d.banks = d.banks.filter((x) => x.id !== id); if (!d.banks.length) d.profile.rentArrival = 'manual'; if (b) audit(d, 'Bank disconnected', b.bank); });
      toast('Disconnected. Keyholder no longer sees that account.');
    },
    /** File a bank withdrawal as a rental expense, and remember the vendor for next time. */
    fileBankExpense(txnId: string, propertyId: string, category: ExpenseCategory, remember: boolean) {
      mut((d) => {
        const t = d.txns.find((x) => x.id === txnId); if (!t) return;
        const shared = CATEGORIES.find((c) => c.id === category)?.sharedByDefault ?? false;
        const e: Expense = { id: uid('exp'), propertyId, date: t.date, amount: -t.amount, vendor: t.payer, category, kind: 'current', scope: shared ? 'shared' : 'direct', createdAt: new Date().toISOString(), note: 'From your bank' };
        d.expenses.unshift(e); d.expenses.sort((a, b) => b.date.localeCompare(a.date));
        t.status = 'expense'; t.expenseId = e.id;
        if (remember) { d.profile.vendorRules = { ...(d.profile.vendorRules ?? {}), [vendorKey(t.payer)]: { propertyId, category } }; }
        audit(d, 'Expense filed from bank', `${fmt(-t.amount)} ${t.payer}`);
      });
      toast(remember ? 'Filed. Future payments to this vendor file themselves.' : 'Filed as an expense.');
    },
    /** Tick a bank withdrawal off as a mortgage payment. */
    reconcileMortgage(txnId: string, mortgageId: string) {
      mut((d) => { const t = d.txns.find((x) => x.id === txnId); if (t) { t.status = 'mortgage'; t.mortgageId = mortgageId; audit(d, 'Mortgage payment matched', `${fmt(-t.amount)} ${t.payer}`); } });
      toast('Mortgage payment ticked off.');
    },
    /**
     * Checks the bank for new rent deposits. Stage 1 simulates what the bank-data provider returns;
     * in Stage 2 a scheduled job runs this every BANK_CHECK_HOURS hours for every connected bank.
     * `auto` = run by the schedule: only speak up when rent was found.
     */
    syncBank(auto = false) {
      if (!banksOn()) return; // live site: never make up deposits
      if (serverMode()) {
        // With Plaid: read what Plaid already has (it tells the server in real time; this is the same read).
        void (async () => {
          try {
            const r = await api<{ added: number }>('POST', '/api/bank/sync');
            await sync.refresh();
            if (!auto) toast(r.added ? `${r.added} new bank transaction${r.added === 1 ? '' : 's'}.` : 'Up to date. Nothing new from your bank yet.');
          } catch (e) { if (!auto) toast((e as Error).message); }
        })();
        return;
      }
      let matched = 0, review = 0;
      mut((d) => {
        const connected = (d.banks ?? []).filter((b) => b.status === 'connected');
        if (!connected.length) return;
        const t = today();
        const fresh: BankTxn[] = [];
        for (const l of currentLeases(d, t)) {
          const open = leaseLedger(l, d.payments, t).filter((x) => x.paid < x.charge && x.due <= addDays(t, 3));
          const already = d.txns.some((x) => x.status === 'new' && x.amount > 0 && suggestMatch(d, x, t)?.leaseId === l.id);
          if (!open.length || already || Math.random() < 0.35) continue;
          const ten = d.tenants.find((x) => x.id === l.tenantId)!;
          fresh.push({ id: uid('tx'), source: 'bank', bankId: connected[0].id, date: t, amount: open[0].charge - open[0].paid, payer: ten.names[0].toUpperCase(), memo: 'rent', status: 'new' });
        }
        for (const x of fresh) { d.txns.unshift(x); if (autoMatch(d, x)) matched++; else review++; }
        // Withdrawals from vendors filed before go straight to expenses.
        for (const x of d.txns) {
          if (x.amount >= 0 || x.status !== 'new') continue;
          const rule = d.profile.vendorRules?.[vendorKey(x.payer)];
          if (rule) { const e: Expense = { id: uid('exp'), propertyId: rule.propertyId, date: x.date, amount: -x.amount, vendor: x.payer, category: rule.category, kind: 'current', scope: CATEGORIES.find((c) => c.id === rule.category)?.sharedByDefault ? 'shared' : 'direct', createdAt: new Date().toISOString(), note: 'From your bank (filed automatically)' }; d.expenses.unshift(e); x.status = 'expense'; x.expenseId = e.id; }
        }
        for (const b of connected) b.lastSync = new Date().toISOString();
        audit(d, auto ? 'Banks checked (scheduled)' : 'Banks checked', `${connected.length} bank(s), ${fresh.length} rent deposit(s) found`);
      });
      if (auto && matched + review === 0) return;
      toast(matched + review === 0 ? 'Checked. No new rent yet.' : `Rent found: ${matched} marked paid${review ? `, ${review} to confirm in To do` : ''}.`);
    },
    /**
     * New transactions from the bank (Plaid), looked at once: a deposit that clearly is a tenant's rent is
     * marked paid (receipt drafted); others wait for the landlord to confirm. Bills from a vendor filed before
     * are filed again the same way.
     */
    processBankTxns() {
      let r = { matched: 0, filed: 0 };
      mut((d) => { r = processNew(d); });
      if (r.matched || r.filed) toast([r.matched && `${r.matched} rent payment${r.matched === 1 ? '' : 's'} marked paid`, r.filed && `${r.filed} bill${r.filed === 1 ? '' : 's'} filed`].filter(Boolean).join(', ') + ' from your bank.');
    },
    /**
     * An uploaded statement: its lines become transactions (sorted like the bank's: money in is rent or not, money
     * out is an expense). Lines already in Keyholder (an overlapping statement, or the same line from a connected
     * bank within 3 days) are skipped. Rent already marked paid is matched to its deposit, never paid twice.
     */
    importStatement(st: Statement, meta: { name: string; bank: string; account?: string; kind: 'bank' | 'card' }, include: boolean[]): { added: number; duplicates: number } {
      let added = 0, duplicates = 0, r = { matched: 0, filed: 0 };
      mut((d) => {
        const id = uid('stmt');
        const seen = new Map<string, number>();
        for (const t of d.txns) { const k = lineKey({ date: t.date, amount: t.amount, description: t.payer }); seen.set(k, (seen.get(k) ?? 0) + 1); }
        const inFile = new Map<string, number>();
        const lines = st.lines.filter((_, i) => include[i] !== false);
        for (const l of lines) {
          const k = lineKey(l);
          const n = (inFile.get(k) ?? 0) + 1; inFile.set(k, n);
          // The same line already here (as many times as it appears in this file), or from a connected bank nearby.
          const near = d.txns.some((t) => t.source === 'bank' && t.amount === l.amount && Math.abs(Date.parse(t.date) - Date.parse(l.date)) <= 3 * 86400_000);
          if ((seen.get(k) ?? 0) >= n || near) { duplicates++; continue; }
          d.txns.push({ id: `st-${id.slice(5)}-${added}`, source: 'statement', statementId: id, date: l.date, amount: l.amount, payer: l.description.slice(0, 80), memo: l.ref ?? '', status: 'new' });
          added++;
        }
        d.txns.sort((x, y) => y.date.localeCompare(x.date));
        const dates = lines.map((l) => l.date).sort();
        d.statements = [...(d.statements ?? []), { id, name: meta.name.slice(0, 120), bank: meta.bank, account: meta.account, kind: meta.kind, format: st.format, from: st.from ?? dates[0], to: st.to ?? dates[dates.length - 1], lines: added, check: st.check, importedAt: new Date().toISOString() }];
        audit(d, 'Statement uploaded', `${meta.bank}${meta.account ? ` ${meta.account}` : ''}: ${added} lines${duplicates ? `, ${duplicates} already here` : ''}`);
        r = processNew(d);
      });
      toast(`${added} line${added === 1 ? '' : 's'} added${duplicates ? ` (${duplicates} already here)` : ''}.${r.matched ? ` ${r.matched} rent matched.` : ''}${r.filed ? ` ${r.filed} bill${r.filed === 1 ? '' : 's'} filed.` : ''}`);
      return { added, duplicates };
    },
    /** Removes an uploaded statement and its lines that were not used yet (filed or matched ones stay). */
    removeStatement(id: string) {
      mut((d) => {
        d.txns = d.txns.filter((t) => !(t.statementId === id && t.status === 'new'));
        const s = (d.statements ?? []).find((x) => x.id === id);
        d.statements = (d.statements ?? []).filter((x) => x.id !== id);
        if (s) audit(d, 'Statement removed', s.name);
      });
    },
    /** The day this property's money is kept for taxes (empty: January 1 of the tax year). */
    setRecordsFrom(propertyId: string, date?: string) {
      mut((d) => { const p = d.properties.find((x) => x.id === propertyId); if (!p) return; if (date) p.recordsFrom = date; else delete p.recordsFrom; audit(d, 'Records kept from', `${p.nickname}: ${date ?? 'January 1'}`); });
    },
    /** A short message at the bottom of the screen (for screens that talk to the server themselves). */
    say(text: string) { toast(text); },
    /** Switch to marking rent paid by hand. */
    useManualTracking() {
      mut((d) => { d.profile.rentArrival = 'manual'; for (const b of d.banks ?? []) audit(d, 'Bank disconnected', b.bank); d.banks = []; });
      toast('Done. You will mark rent paid yourself.');
    },
    /** "Is this tenant in good standing?": rent counts as paid up to `through` (null: what Keyholder shows is right). */
    setStanding(leaseId: string, through: string | null) {
      mut((d) => {
        const l = d.leases.find((x) => x.id === leaseId); if (!l) return;
        l.standingChecked = true;
        if (through) l.paidThrough = through; else delete l.paidThrough;
        const t = d.tenants.find((x) => x.id === l.tenantId);
        audit(d, 'Rent paid up to', `${t?.names.join(' & ') ?? 'Tenant'}: ${through ? `paid through ${through} before Keyholder` : 'owes what Keyholder shows'}`);
      });
      toast(through ? 'Saved. Rent before then counts as paid.' : 'Saved. Keyholder keeps tracking what is owed.');
    },
    /** A deposit filed as other income (a bill share, parking…): remembered for that sender, to suggest next time. */
    txnIsIncome(txnId: string, incomeId: string) {
      mut((d) => {
        const t = d.txns.find((x) => x.id === txnId); const inc = (d.income ?? []).find((x) => x.id === incomeId); if (!t || !inc) return;
        t.status = 'matched'; t.incomeId = incomeId;
        d.profile.incomePayers = { ...(d.profile.incomePayers ?? {}), [vendorKey(t.payer)]: { kind: inc.kind, leaseId: inc.leaseId } };
      });
    },
    confirmMatch(txnId: string, leaseId: string, period: string, learnAlias: boolean) {
      mut((d) => {
        const t = d.txns.find((x) => x.id === txnId); if (!t) return;
        const lease = d.leases.find((l) => l.id === leaseId)!;
        const pay = recordPayment(d, { leaseId, period, amount: t.amount, date: t.date, method: lease.paymentMethod, source: t.source });
        t.status = 'matched'; t.paymentId = pay.id;
        if (learnAlias) {
          const ten = d.tenants.find((x) => x.id === lease.tenantId);
          if (ten && !ten.aliases.includes(t.payer) && !ten.names.some((n) => n.toLowerCase() === t.payer.toLowerCase())) ten.aliases.push(t.payer);
        }
      });
      toast('Matched. Payment logged and receipt drafted.');
    },
    /** "Whose rent is it?": the deposit is rent already marked paid by hand; attach it to that payment. */
    linkDeposit(txnId: string, paymentId: string) {
      mut((d) => {
        const t = d.txns.find((x) => x.id === txnId); const p = d.payments.find((x) => x.id === paymentId); if (!t || !p) return;
        t.status = 'matched'; t.paymentId = p.id;
        audit(d, 'Deposit matched to rent already marked paid', `${fmt(t.amount)} from ${t.payer} (${tenantName(d, p.leaseId)}, ${p.period})`);
      });
      toast('Matched to the rent you already marked paid.');
    },
    /**
     * Money in that is not rent, or money out that is personal (not a rental cost): set aside, and remembered for
     * that sender or vendor so it is never asked about again (on Home, Rentals or Expenses).
     */
    ignoreTxn(id: string) {
      mut((d) => {
        const t = d.txns.find((x) => x.id === id); if (!t) return;
        t.status = 'ignored';
        const key = vendorKey(t.payer); const list = t.amount > 0 ? 'notRentPayers' : 'personalVendors';
        if (key && !(t.amount > 0 && isTenantName(d, t.payer))) d.profile[list] = [...new Set([...(d.profile[list] ?? []), key])];
        audit(d, t.amount > 0 ? 'Deposit marked not rent' : 'Payment marked personal', `${fmt(Math.abs(t.amount))} ${t.amount > 0 ? 'from' : 'to'} ${t.payer}`);
      });
      toast('Got it. Keyholder remembers and won\'t ask again.');
    },
    unignoreTxn(id: string) {
      mut((d) => {
        const t = d.txns.find((x) => x.id === id); if (!t) return;
        t.status = 'new'; const key = vendorKey(t.payer);
        d.profile.notRentPayers = d.profile.notRentPayers?.filter((k) => k !== key);
        d.profile.personalVendors = d.profile.personalVendors?.filter((k) => k !== key);
      });
    },

    // ---- Expenses ----
    saveExpense(e: Expense, fromTxn?: string) {
      mut((d) => {
        const i = d.expenses.findIndex((x) => x.id === e.id);
        if (i >= 0) d.expenses[i] = e; else d.expenses.unshift(e);
        d.expenses.sort((a, b) => b.date.localeCompare(a.date));
        if (fromTxn) { const t = d.txns.find((x) => x.id === fromTxn); if (t) { t.status = 'expense'; t.expenseId = e.id; } }
        // From the bank (now or earlier): the vendor's property and category are remembered for its next payments.
        const t = d.txns.find((x) => x.expenseId === e.id);
        if (t) d.profile.vendorRules = { ...(d.profile.vendorRules ?? {}), [vendorKey(t.payer)]: { propertyId: e.propertyId, category: e.category } };
        audit(d, i >= 0 ? 'Expense updated' : 'Expense filed', `${fmt(e.amount)} ${e.vendor}`);
      });
      toast(`Filed: ${fmt(e.amount)} at ${e.vendor || 'unknown vendor'}.`);
    },
    deleteExpense(id: string) { mut((d) => { const e = d.expenses.find((x) => x.id === id); d.expenses = d.expenses.filter((x) => x.id !== id); for (const t of d.txns) if (t.expenseId === id) { t.status = 'new'; t.expenseId = undefined; } if (e) audit(d, 'Expense deleted', `${fmt(e.amount)} ${e.vendor}`); }); },

    // ---- Phase 2 ----
    addValuation(v: Omit<Valuation, 'id'>, quiet = false) { mut((d) => { d.valuations.push({ ...v, id: uid('v') }); audit(d, 'Valuation recorded', `${v.note ?? v.source} ${fmt(v.likely)}`); }); if (!quiet) toast('Valuation saved to the history.'); },
    removeValuation(id: string) { mut((d) => { d.valuations = d.valuations.filter((v) => v.id !== id); }); },
    /** Deposits waiting in the bank list that are rent already marked paid by hand: attached to those payments. */
    linkMarkedDeposits() {
      mut((d) => {
        for (const t of d.txns) {
          if (t.status !== 'new' || t.amount <= 0) continue;
          const p = markedPayment(d, t); if (!p) continue;
          t.status = 'matched'; t.paymentId = p.id;
          audit(d, 'Deposit matched to rent already marked paid', `${fmt(t.amount)} from ${t.payer} (${tenantName(d, p.leaseId)}, ${p.period})`);
        }
      });
    },
    /** Estimates saved by earlier versions (Repliers, price trend, nearby sales) are removed; only what you entered stays. */
    dropOldEstimates() {
      mut((d) => {
        const old = d.valuations.filter((v) => OLD_ESTIMATE.has(v.source));
        if (!old.length) return;
        d.valuations = d.valuations.filter((v) => !OLD_ESTIMATE.has(v.source));
        audit(d, 'Old automated estimates removed', `${old.length}: Keyholder now uses what you paid, or your own estimate`);
      });
    },
    saveComparable(c: Comparable) { mut((d) => { const i = d.comparables.findIndex((x) => x.id === c.id); if (i >= 0) d.comparables[i] = c; else d.comparables.push(c); }); },
    removeComparable(id: string) { mut((d) => { d.comparables = d.comparables.filter((c) => c.id !== id); }); },

    // ---- To-do: hide for a while, or ignore for good ----
    setTodoPref(key: string, pref: TodoPref | null) {
      mut((d) => { d.todoPrefs = d.todoPrefs ?? {}; if (pref) d.todoPrefs[key] = pref; else delete d.todoPrefs[key]; });
      if (pref?.ignored) toast('Ignored. You can bring it back at the bottom of Home.');
      else if (pref?.hiddenUntil) toast(`Hidden until ${pref.hiddenUntil}.`);
    },
    markDepositReturned(leaseId: string) { mut((d) => { const l = d.leases.find((x) => x.id === leaseId); if (l) { l.depositReturned = true; audit(d, 'Deposit settled', leaseId); } }); toast('Deposit settled. The unit is ready to list.'); },
    updateApplicant(id: string, patch: Partial<Applicant>) { mut((d) => { const a = d.applicants.find((x) => x.id === id); if (a) Object.assign(a, patch); }); },

    // ---- Finding a tenant ----
    saveListing(l: Listing) { mut((d) => { const i = d.listings.findIndex((x) => x.unitId === l.unitId); if (i >= 0) d.listings[i] = l; else d.listings.push(l); audit(d, 'Listing saved', l.unitId); }); toast('Listing saved.'); },
    sendApplicationLink(unitLabel: string, to: string) { mut((d) => audit(d, 'Application form sent', `Unit ${unitLabel} to ${to}`)); toast(`Application form sent to ${to}.`); },
    setApplicantStatus(id: string, status: Applicant['status']) {
      let name = '';
      mut((d) => { const a = d.applicants.find((x) => x.id === id); if (a) { a.status = status; name = a.names[0]; audit(d, `Applicant ${status}`, a.names.join(' & ')); } });
      if (status === 'declined') toast(`Decline message sent to ${name || 'the applicant'}.`);
      if (status === 'offered') toast(`Offer sent to ${name || 'the applicant'}.`);
    },
    /**
     * Turn an accepted applicant into a tenant with a draft lease. A unit rented as a whole is then full:
     * the listing closes and other applicants get a polite decline. A unit rented by the room gets a lease
     * for that room, and the listing and other applications stay open until every room is taken.
     */
    acceptApplicant(id: string, start: string, rent: number, room?: string) {
      const s0 = get();
      const u0 = s0.units.find((x) => x.id === s0.applicants.find((a) => a.id === id)?.unitId);
      const full = !u0 || u0.rentedBy !== 'room' || openRooms(s0, u0, today()).filter((r) => r !== room).length === 0;
      mut((d) => {
        const a = d.applicants.find((x) => x.id === id); if (!a) return;
        const u = d.units.find((x) => x.id === a.unitId);
        const rooms = u?.rentedBy === 'room';
        a.status = 'accepted';
        const tid = uid('t');
        const people = a.people?.length ? a.people.map((p) => ({ name: p.name, email: p.email, phone: p.phone })) : undefined;
        d.tenants.push({ id: tid, unitId: a.unitId, names: a.names, email: a.email, phone: a.phone, people, noticeMethod: 'email', emailConsent: true, emailConsentDate: start, aliases: [] });
        d.leases.push({ id: uid('l'), unitId: a.unitId, tenantId: tid, room: rooms ? room : undefined, start, rent, dueDay: 1, paymentMethod: 'etransfer', lmrDeposit: rent, utilities: '', parking: false, pets: a.pets, emailNoticeConsent: true });
        if (u) { u.status = 'occupied'; if (!rooms) u.rent = rent; }
        if (full) {
          d.listings = d.listings.filter((l) => l.unitId !== a.unitId);
          for (const o of d.applicants) if (o.unitId === a.unitId && o.id !== id && o.status !== 'declined' && o.status !== 'accepted') o.status = 'declined';
        }
        audit(d, 'Applicant accepted', `${a.names.join(' & ')}${rooms && room ? `, ${room},` : ''} from ${start}`);
      });
      toast(full ? 'Tenant added and lease drafted. Other applicants were sent a polite decline.' : 'Tenant added and lease drafted. The other applications stay open for the free rooms.');
    },

    // ---- Late-rent notices ----
    /** Records an approved notice, form or agreement. Returns its id. */
    serveNotice(n: Omit<Notice, 'id' | 'createdAt' | 'status'>): string {
      const f = formById(n.formId);
      const status: Notice['status'] = f?.kind === 'application' ? 'filed' : f?.kind === 'notice' ? 'served' : 'signed';
      const id = uid('n');
      mut((d) => { d.notices.push({ ...n, id, createdAt: new Date().toISOString(), status }); audit(d, `${n.kind} ${status}`, `${f?.title ?? ''}${n.terminationDate ? ` · ${n.terminationDate}` : ''}${n.official ? ` · official form ${n.official.version}` : ''}`); });
      toast(status === 'filed' ? `${n.kind} prepared with the ledger, notice and proof of service.` : status === 'served' ? `${n.kind} approved and recorded with proof of service.` : `${n.kind} saved with the lease.`);
      return id;
    },
    /** The official form of a served notice went to the tenants by email. */
    markNoticeEmailed(id: string) { mut((d) => { const n = d.notices.find((x) => x.id === id); if (n) { n.emailedAt = new Date().toISOString(); audit(d, `${n.kind} emailed to the tenant`, 'Official form attached'); } }); },

    // ---- Phase 3 ----
    /** A mortgage change from a date (renewal, new rate or payment, new tax amount); earlier payments keep theirs. */
    changeMortgage(id: string, c: MortgageChange) {
      mut((d) => {
        const m = d.mortgages.find((x) => x.id === id); if (!m) return;
        m.changes = [...(m.changes ?? []).filter((x) => x.from !== c.from), c].sort((a, b) => a.from.localeCompare(b.from));
        audit(d, 'Mortgage changed', `From ${c.from}${c.ratePct !== undefined ? ` · ${c.ratePct}%` : ''}${c.payment !== undefined ? ` · payment ${fmt(c.payment)}` : ''}${c.taxWithPayment !== undefined ? ` · property tax ${fmt(c.taxWithPayment)} a payment` : ''}`);
      });
      toast(`Saved. Payments from ${fmtDate(c.from)} use the new amounts; earlier ones stay as they were.`);
    },
    removeMortgageChange(id: string, from: string) {
      mut((d) => { const m = d.mortgages.find((x) => x.id === id); if (m) { m.changes = (m.changes ?? []).filter((x) => x.from !== from); audit(d, 'Mortgage change removed', `From ${from}`); } });
    },
    /** The yearly property tax paid to the city, from a date (earlier years keep the old amount). */
    changePropertyTax(propertyId: string, annual: number, from: string) {
      mut((d) => {
        const p = d.properties.find((x) => x.id === propertyId); if (!p) return;
        const h = (p.propertyTaxHistory ?? []).filter((x) => x.from !== from);
        if (!h.length && p.annualPropertyTax && p.annualPropertyTax !== annual) h.push({ from: '1900-01-01', annual: p.annualPropertyTax });
        h.push({ from, annual });
        p.propertyTaxHistory = h.sort((a, b) => a.from.localeCompare(b.from));
        p.annualPropertyTax = p.propertyTaxHistory[p.propertyTaxHistory.length - 1].annual;
        audit(d, 'Property tax changed', `${p.nickname}: ${fmt(annual)} a year from ${from}`);
      });
      toast('Property tax saved.');
    },
    saveMortgage(m: Mortgage) { mut((d) => { const i = d.mortgages.findIndex((x) => x.id === m.id); if (i >= 0) d.mortgages[i] = m; else d.mortgages.push(m); audit(d, 'Mortgage saved', `${m.lender} ${fmt(m.principal)}`); }); toast('Mortgage saved. Payments are now split into principal and interest.'); },
    removeMortgage(id: string) { mut((d) => { d.mortgages = d.mortgages.filter((m) => m.id !== id); audit(d, 'Mortgage removed'); }); },
  };
}

export type Actions = ReturnType<typeof makeActions>;

interface Ctx { state: AppState; act: Actions; today: string; toasts: { id: number; text: string }[] }
const StoreCtx = createContext<Ctx | null>(null);

/** Sample properties need a landlord to sign receipts and notices; use a sample one if the visitor has not given a name. */
function sampleLandlord(p: Profile): Profile {
  return p.name ? p : { ...p, name: 'Alex Morgan', email: p.email || 'alex.morgan@example.com' };
}

/** Valuation sources from earlier versions (automated estimates); Keyholder keeps only purchase, owner and appraisal. */
const OLD_ESTIMATE = new Set<Valuation['source']>(['avm', 'index', 'comparables']);

/** Live site: a bank connection made through Plaid, and a transaction that came from it ("pl-" + Plaid's id). */
const realBank = (b: BankConnection) => b.via === 'plaid';
const fakeTxn = (t: BankTxn) => t.source === 'bank' && !t.id.startsWith('pl-');
/** The sender is one of the tenants (a name or a learned alias): their deposits are always asked about. */
const isTenantName = (d: AppState, payer: string) => {
  const p = payer.toLowerCase();
  return d.tenants.some((t) => [...t.names, ...t.aliases].some((n) => n && (p.includes(n.toLowerCase()) || n.toLowerCase().includes(p))));
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const n = useRef(0);
  useEffect(() => save(state), [state]);

  const toast = useCallback((text: string) => {
    const id = ++n.current;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const mut: Mut = useCallback((fn) => setState((s) => { const d = structuredClone(s); fn(d); return d; }), []);
  const latest = useRef(state);
  latest.current = state;
  const act = useMemo(() => {
    const base = makeActions(mut, toast, () => latest.current);
    // Stage 2: signing out also ends the session on the server, after saving anything not yet saved.
    // A landlord's own data then leaves this browser (it is safe in their account).
    const signOut = () => {
      const u = getConn().user;
      if (!serverMode() || !u) return base.signOut();
      const account = latest.current.profile.account;
      const wasOwner = sync.owned(latest.current);
      void (async () => {
        await sync.flush();
        await api('POST', '/api/auth/logout').catch(() => {});
        setUser(null);
        base.signOut();
        if (wasOwner && account) sync.forget(account);
      })();
    };
    return { ...base, signOut };
  }, [mut, toast]);
  // Stage 2: keep the signed-in landlord's data saved on the server.
  // Connected while rendering, before any screen's effects run: a screen that opens straight onto a server
  // step (e.g. coming back from Google) may load the landlord's data in its very first effect.
  useMemo(() => sync.attach(() => latest.current, (x) => { latest.current = x; setState(x); }, toast), [toast]);
  useEffect(() => { sync.onState(state); }, [state]);
  useEffect(() => {
    if (!serverMode()) return;
    const u = getConn().user;
    const a = latest.current.profile.account;
    if (u?.role === 'owner') void sync.hydrate().catch(() => {});
    // The browser thinks it is signed in but the server session has ended: back to Sign in.
    else if (!u && a?.signedIn && (a.provider === 'email' || a.provider === 'google')) mut((d) => { if (d.profile.account) d.profile.account.signedIn = false; });
    sync.startPulling();
  }, [mut]);
  // A deposit for rent already marked paid by hand is attached to it, whichever came first.
  const linkable = useMemo(() => state.txns.some((t) => t.status === 'new' && t.amount > 0 && !!markedPayment(state, t)), [state]);
  useEffect(() => { if (linkable && (sync.owned(state) || !serverMode())) act.linkMarkedDeposits(); }, [linkable, state, act]);
  // Estimates saved by earlier versions: removed once (only the landlord's own figures are kept).
  const oldEstimates = state.valuations.some((v) => OLD_ESTIMATE.has(v.source));
  useEffect(() => { if (oldEstimates && (sync.owned(state) || !serverMode())) act.dropOldEstimates(); }, [oldEstimates, state, act]);
  // Live site: clear out a practice bank connection left from before (real Plaid ones stay, even while banks are off).
  const pretend = serverMode() && ((state.banks ?? []).some((b) => !realBank(b)) || state.txns.some(fakeTxn));
  useEffect(() => { if (pretend && sync.owned(state)) act.removePretendBank(); }, [pretend, state, act]);
  // Bank transactions that arrived from Plaid (the server wrote them): look at each new one once.
  const unchecked = state.txns.some((t) => (t.source === 'bank' || t.source === 'statement') && t.status === 'new' && !t.checked);
  useEffect(() => { if (unchecked && sync.owned(state)) act.processBankTxns(); }, [unchecked, state, act]);
  // The preview's simulated bank check (every few hours while the app is open). With Plaid, the server gets
  // new transactions in real time instead.
  const lastSync = (state.banks ?? []).filter((b) => b.status === 'connected').map((b) => b.lastSync).sort()[0];
  useEffect(() => {
    if (!lastSync || serverMode()) return;
    const due = new Date(lastSync).getTime() + BANK_CHECK_HOURS * 3600_000 - Date.now();
    const id = setTimeout(() => act.syncBank(true), Math.max(1000, due));
    return () => clearTimeout(id);
  }, [lastSync, act]);
  // Celebrate when a property moves up a level (Bronze → Silver → Gold).
  const levelsRef = useRef<Map<string, Level> | null>(null);
  useEffect(() => {
    const now = new Map(state.properties.map((p) => [p.id, propertyLevel(state, p)]));
    const before = levelsRef.current;
    levelsRef.current = now;
    if (!before) return;
    for (const p of state.properties) {
      const was = before.get(p.id), is = now.get(p.id)!;
      if (was && levelInfo(is).rank > levelInfo(was).rank) {
        toast(is === 'gold' ? `${p.nickname} is now Gold. Mortgage and full tax numbers are ready.` : `${p.nickname} is now Silver. You can see what it's worth.`);
      }
    }
  }, [state, toast]);
  const today = todayISO();
  const value = useMemo(() => ({ state, act, today, toasts }), [state, act, today, toasts]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('useStore outside StoreProvider');
  return c;
}


// Small selectors used across screens.
export function unitTenant(state: AppState, unitId: string, today: string) {
  const lease = activeLease(state, unitId, today);
  const tenant = lease ? state.tenants.find((t) => t.id === lease.tenantId) : undefined;
  return { lease, tenant };
}

/** The receipt still to send for a month that is paid (recorded, receipt drafted but not sent yet), if any. */
export function receiptToSend(state: AppState, line: { payments: Payment[] } | undefined) {
  if (!line) return undefined;
  for (const p of line.payments) {
    const r = state.receipts.find((x) => x.paymentId === p.id && x.status === 'draft');
    if (r) return r;
  }
  return undefined;
}

/**
 * The month a lease's rent status is about: this month, or, for a lease that starts in a later month (moving in
 * Dec 1), that first month, so paying it ahead shows as paid everywhere (Home, Rentals, Tenants).
 */
export function currentLine(state: AppState, lease: Lease | undefined, today: string) {
  if (!lease) return undefined;
  const first = periodOf(lease.start);
  if (first > periodOf(today)) {
    const l = leaseLedger(lease, state.payments, today, first).find((x) => x.period === first);
    if (l) return l;
  }
  const p = periodOf(today);
  return leaseLedger(lease, state.payments, today).find((l) => l.period === p) ?? { period: p, due: dueDate(p, lease.dueDay), charge: lease.rent, paid: 0, payments: [], state: 'upcoming' as const, daysLate: 0, balance: 0 };
}
