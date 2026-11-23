import { useState } from 'react';
import type { Lease, Tone } from '../data/types';
import { useStore } from '../data/store';
import { fmtDate, fmtPeriod } from '../lib/dates';
import { markedCandidates } from '../lib/matching';
import { vendorKey } from '../lib/bankrules';
import { currentLeases, leaseLedger, leasePlace } from '../lib/finance';
import { fmt } from '../lib/money';
import { reminderDraft, TONES } from '../lib/templates';
import { tenantEmails, toLine } from '../lib/people';
import type { TrayItem } from '../lib/tray';
import { Letterhead } from '../components/domain';
import { Drawer, Empty, Seg } from '../components/ui';
import { Icon } from '../components/Icon';
import { OtherIncomeForm } from '../components/forms';
import { incomeKindLabel } from '../lib/receiptData';

// Drawers used by Home's journey cards: writing a reminder, and matching a deposit to a tenant.

export function ReminderDrawer({ lease, period, tone: initial, onClose }: { lease: Lease; period: string; tone: Tone; onClose: () => void }) {
  const { state, act, today } = useStore();
  const [tone, setTone] = useState<Tone>(initial);
  const draft = reminderDraft(state, lease, period, tone, today);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [touched, setTouched] = useState(false);
  const t = state.tenants.find((x) => x.id === lease.tenantId);
  const pick = (x: Tone) => { setTone(x); if (!touched) { const d = reminderDraft(state, lease, period, x, today); setSubject(d.subject); setBody(d.body); } };
  return (
    <Drawer title="Reminder" onClose={onClose} wide footer={<>
      <button className="btn ghost" onClick={() => { act.setPause(lease.tenantId, 'Paused from a reminder'); onClose(); }}><Icon name="pause" size={16} />Pause for {t?.names[0]}</button>
      <button className="btn primary" disabled={!t || !tenantEmails(t).length} onClick={() => { act.sendReminder(lease, period, tone, touched ? { subject, body } : undefined); onClose(); }}>Send now</button>
    </>}>
      <div className="spread" style={{ marginBottom: 12 }}>
        <Seg label="Tone" value={tone} onChange={pick} options={TONES.map((x) => ({ id: x.id, label: x.label }))} />
        <span className="small soft">{TONES.find((x) => x.id === tone)?.blurb}</span>
      </div>
      <div className="small soft to-line" style={{ marginBottom: 8 }}>To: {toLine(t)}</div>
      <div className="letter">
        <Letterhead state={state} />
        <input aria-label="Subject" value={subject} onChange={(e) => { setSubject(e.target.value); setTouched(true); }} style={{ fontWeight: 600, marginBottom: 8 }} />
        <textarea aria-label="Message" value={body} onChange={(e) => { setBody(e.target.value); setTouched(true); }} />
      </div>
      <p className="letter-foot">Sends now. Cancelled if rent arrives first.</p>
      {tone === 'firm' && <div className="callout">A reminder isn't a legal notice. If rent stays unpaid, we can prepare the official one next.</div>}
    </Drawer>
  );
}

export function MatchDrawer({ item, onClose }: { item: Extract<TrayItem, { kind: 'match' }>; onClose: () => void }) {
  const { state, act, today } = useStore();
  const options = currentLeases(state, today).flatMap((l) => {
    const u = state.units.find((x) => x.id === l.unitId)!;
    const t = state.tenants.find((x) => x.id === l.tenantId)!;
    return leaseLedger(l, state.payments, today).filter((x) => x.paid < x.charge).map((x) => ({ lease: l, tenant: t, unit: u, line: x }));
  });
  // Nothing chosen when the deposit does not say whose it is (rooms often have the same rent): you pick.
  const [sel, setSel] = useState(item.suggestion ? `${item.suggestion.leaseId}|${item.suggestion.period}` : options.length === 1 ? `${options[0].lease.id}|${options[0].line.period}` : '');
  const [learn, setLearn] = useState(true);
  // Rent already marked paid by hand that this deposit could be (rooms with the same rent).
  const marked = markedCandidates(state, item.txn).map((p) => {
    const l = state.leases.find((x) => x.id === p.leaseId); const t = state.tenants.find((x) => x.id === l?.tenantId); const u = state.units.find((x) => x.id === l?.unitId);
    return { p, l, t, u };
  }).filter((x) => x.l && x.t);
  const [leaseId, period] = sel.split('|');
  const chosen = options.find((o) => o.lease.id === leaseId);
  const markedPick = sel.startsWith('paid|') ? sel.slice(5) : '';
  // Does the amount look like anyone's rent? If not, it is probably a bill share or other income: offer that first.
  const rentLike = options.some((o) => o.line.charge - o.line.paid === item.txn.amount || o.lease.rent === item.txn.amount) || marked.length > 0;
  const remembered = state.profile.incomePayers?.[vendorKey(item.txn.payer)];
  // Whose it is, from the sender's name (or what this sender was last time).
  const payer = item.txn.payer.toLowerCase();
  const guess = remembered?.leaseId ?? state.leases.find((l) => !l.end || l.end >= today ? state.tenants.find((t) => t.id === l.tenantId)?.names.concat(state.tenants.find((t) => t.id === l.tenantId)?.aliases ?? []).some((n) => n.toLowerCase().split(/\s+/).some((w) => w.length > 2 && payer.includes(w))) : false)?.id;
  const [other, setOther] = useState(false);
  if (other) return <OtherIncomeForm onClose={onClose} prefill={{ amount: item.txn.amount, date: item.txn.date, txnId: item.txn.id, source: item.txn.source === 'bank' ? 'bank' : 'statement', leaseId: guess, kind: remembered?.kind ?? 'bill' }} />;
  const otherFirst = !rentLike || !!remembered;
  return (
    <Drawer title={`${fmt(item.txn.amount)} from ${item.txn.payer}`} onClose={onClose} footer={<>
      <button className="btn ghost" id="md-not-rent" onClick={() => { act.ignoreTxn(item.txn.id); onClose(); }}>Not rental income</button>
      <button className={`btn ${otherFirst ? 'primary' : ''}`} id="md-other" onClick={() => setOther(true)}>Bill share or other</button>
      {(options.length > 0 || marked.length > 0) && <button className={`btn ${otherFirst ? '' : 'primary'}`} disabled={!sel} onClick={() => { if (markedPick) act.linkDeposit(item.txn.id, markedPick); else act.confirmMatch(item.txn.id, leaseId, period, learn); onClose(); }}>This is their rent</button>}
    </>}>
      {otherFirst && <p className="callout" id="md-other-hint" style={{ marginTop: 0 }}><Icon name="info" size={16} /> {remembered ? `Last time, money from this sender was a ${incomeKindLabel(remembered.kind).toLowerCase()}.` : "This amount doesn't match anyone's rent."} Is it a bill share or other income? Choose <strong>Bill share or other</strong>.</p>}
      {!item.suggestion && !otherFirst && (options.length > 1 || marked.length > 0) && <p className="small soft" style={{ marginTop: 0 }}>The sender's name doesn't say whose rent this is. Choose the tenant.</p>}
      {options.length === 0 && !marked.length ? <Empty title="No rent is owed right now.">So this is probably a bill share or other income: choose <strong>Bill share or other</strong>. If it is not rental income at all, choose <strong>Not rental income</strong> and Keyholder remembers the sender.</Empty> : (
        <div className="stack" role="radiogroup">
          {marked.map(({ p, l, t, u }) => {
            const v = `paid|${p.id}`;
            return (
              <button key={v} role="radio" aria-checked={sel === v} className="choice" style={{ width: '100%' }} onClick={() => setSel(v)}>
                <span className="t">{t!.names.join(' & ')} — {leasePlace(u, l)}</span>
                <span className="s">{fmtPeriod(p.period)} · already marked paid {fmtDate(p.date)}</span>
              </button>
            );
          })}
          {options.map((o) => {
            const v = `${o.lease.id}|${o.line.period}`;
            return (
              <button key={v} role="radio" aria-checked={sel === v} className="choice" style={{ width: '100%' }} onClick={() => setSel(v)}>
                <span className="t">{o.tenant.names.join(' & ')} — {leasePlace(o.unit, o.lease)}</span>
                <span className="s">{fmtPeriod(o.line.period)} · {fmt(o.line.charge - o.line.paid)} owing</span>
              </button>
            );
          })}
        </div>
      )}
      {chosen && !chosen.tenant.names.some((n) => n.toLowerCase() === item.txn.payer.toLowerCase()) && (
        <label className="check" style={{ marginTop: 16 }}><input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} /><span>Next time, match “{item.txn.payer}” to {chosen.tenant.names[0]} automatically</span></label>
      )}
    </Drawer>
  );
}
