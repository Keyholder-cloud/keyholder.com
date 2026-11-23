import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { receiptData } from '../lib/receiptData';
import type { AppState, Receipt } from '../data/types';
import { useStore } from '../data/store';
import { addPeriods, fmtMonthShort, fmtPeriod, periodOf } from '../lib/dates';
import { byRoom, leaseLedger, type ChargeState } from '../lib/finance';
import { Icon } from './Icon';
import { Link } from 'react-router-dom';
import { BANK_CHECK_HOURS } from '../lib/jurisdiction';
import { banksOn, paidPlan, serverMode } from '../data/api';

function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? '' : 's'} ago`;
}

// ---------- How rent is tracked: one line that says it plainly ----------
export function BankStatus({ compact }: { compact?: boolean }) {
  const { state, act } = useStore();
  const banks = (state.banks ?? []).filter((x) => x.status === 'connected');
  const b = banks.map((x) => x).sort((p, q) => p.lastSync.localeCompare(q.lastSync))[0];
  if (!b) {
    return (
      <div className={`track-line${compact ? ' compact' : ''}`}>
        <Icon name="check" size={18} />
        <span>You mark rent paid yourself.</span>
        {banksOn() && <Link to="/settings#rent-tracking">Check my bank automatically instead</Link>}
      </div>
    );
  }
  return (
    <div className={`track-line${compact ? ' compact' : ''}`}>
      <Icon name="bank" size={18} />
      <span><strong>{banks.map((x) => x.bank).join(' and ')}</strong> {serverMode() ? 'updates as your bank reports' : `checked every ${BANK_CHECK_HOURS} h`} · last {ago(b.lastSync)}</span>
      {paidPlan() && <button className="btn small" id="bank-check-now" onClick={() => act.syncBank()}>Check now</button>}
    </div>
  );
}

const STATE_LABEL: Record<ChargeState, string> = { paid: 'Paid', late: 'Late', partial: 'Partial', due: 'Due', upcoming: 'Upcoming' };


export const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

// ---------- Rent Roll strip: 12 months, one row per unit ----------
export function RentRoll({ propertyId }: { propertyId?: string }) {
  const { state, today } = useStore();
  const nav = useNavigate();
  const end = periodOf(today);
  const months = Array.from({ length: 12 }, (_, i) => addPeriods(end, i - 11));
  const units = state.units.filter((u) => (!propertyId || u.propertyId === propertyId) && state.properties.find((p) => p.id === u.propertyId && !p.archived));
  if (!units.length) return null;
  return (
    <div className="rentroll" role="table" aria-label="Rent roll, last 12 months">
      <div className="rr-row rr-head" role="row"><span role="columnheader" /> {months.map((m) => <span key={m} role="columnheader">{fmtMonthShort(m)[0]}</span>)}</div>
      {units.flatMap((u) => {
        const all = state.leases.filter((l) => l.unitId === u.id);
        // A unit rented by the room: a row per room (each room's rent is its own); otherwise one row for the unit.
        const tracks = byRoom(u)
          ? [...new Set(all.map((l) => l.room ?? l.id))].map((k) => ({ key: k, room: all.find((l) => (l.room ?? l.id) === k)?.room, leases: all.filter((l) => (l.room ?? l.id) === k) }))
          : [{ key: u.id, room: undefined as string | undefined, leases: all }];
        const prop = state.properties.find((p) => p.id === u.propertyId);
        const name = propertyId ? `Unit ${u.label}` : `${prop?.nickname.split(' ')[0]} ${u.label}`;
        return tracks.map(({ key, room, leases }) => {
        const lines = new Map<string, { state: ChargeState; tenantId: string }>();
        for (const l of leases) for (const line of leaseLedger(l, state.payments, today)) lines.set(line.period, { state: line.state, tenantId: l.tenantId });
        return (
          <div className="rr-row" role="row" key={`${u.id}-${key}`}>
            <span className="rr-label" role="rowheader">{byRoom(u) ? `${name} · ${room ?? state.tenants.find((t) => t.id === leases[0]?.tenantId)?.names[0].split(' ')[0] ?? ''}` : name}</span>
            {months.map((m) => {
              const c = lines.get(m);
              if (!c) return <span key={m} className="cell none" role="cell" aria-label={`${fmtPeriod(m)}: no lease`} />;
              return <button key={m} role="cell" className={`cell ${c.state === 'upcoming' ? '' : c.state}`} title={`${fmtPeriod(m)}: ${STATE_LABEL[c.state]}`} aria-label={`${fmtPeriod(m)}: ${STATE_LABEL[c.state]}`} onClick={() => nav(`/rent/tenant/${c.tenantId}`)} />;
            })}
          </div>
        );
        });
      })}
      <div className="legend">
        <span><i style={{ background: 'var(--pine)' }} />Paid</span>
        <span><i style={{ background: 'repeating-linear-gradient(45deg, var(--brass) 0 2px, transparent 2px 4px)', border: '1px solid var(--brass)' }} />Partial</span>
        <span><i style={{ border: '2px solid var(--rust)' }} />Late</span>
        <span><i style={{ border: '1px solid var(--rule)' }} />Upcoming</span>
      </div>
    </div>
  );
}

// ---------- Letters: receipts and messages previewed as paper ----------
export function Letterhead({ state }: { state: AppState }) {
  return (
    <div className="lh">
      <div>
        <div className="serif">{state.profile.name || 'Your name'}</div>
        <div className="tiny" style={{ color: '#55605B' }}>{state.profile.email || 'you@example.com'}{state.profile.phone ? ` · ${state.profile.phone}` : ''}</div>
      </div>
      <div className="tiny" style={{ textAlign: 'right', color: '#55605B' }}>Prepared with Keyholder</div>
    </div>
  );
}

/**
 * A rent receipt, exactly as the tenant gets it: the same details and the same layout as the PDF attached to the
 * email (src/lib/receiptPdf.ts), with a button to download that very PDF.
 */
export function ReceiptLetter({ receipt }: { receipt: Receipt }) {
  const { state, today } = useStore();
  const [busy, setBusy] = useState(false);
  const d = receiptData(state, receipt, (receipt.sentAt ?? today).slice(0, 10));
  if (!d) return null;
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const old = receipt.status === 'superseded';
  const download = async () => {
    setBusy(true);
    try {
      const { receiptPdf } = await import('../lib/receiptPdf');
      const url = URL.createObjectURL(new Blob([(await receiptPdf(d)) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url; a.download = `Rent receipt ${d.number} - ${d.period}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally { setBusy(false); }
  };
  const rows: [string, string][] = [['Receipt number', String(d.number)], ['Rent period', d.period], ['Date paid', day(d.paidOn)], ['Paid by', d.method], ['Received from', d.tenant], ['Rental', d.rental]];
  if (d.note) rows.push(['Note', d.note]);
  return (
    <>
      <div className="rcpt print-me" id="receipt-view">
        <div className="rcpt-head">
          <div><strong>RENT RECEIPT</strong><span>Official receipt for rent received</span></div>
          <div className="r"><strong>No. {d.number}</strong><span>Issued {day(d.issued)}</span></div>
        </div>
        <div className="rcpt-body">
          <div className="rcpt-parties">
            <div><span className="rcpt-k">FROM (LANDLORD)</span><b>{d.landlord.name}</b>{d.landlord.email && <span className="soft">{d.landlord.email}</span>}{d.landlord.phone && <span className="soft">{d.landlord.phone}</span>}</div>
            <div><span className="rcpt-k">RECEIVED FROM (TENANT)</span><b>{d.tenant}</b></div>
          </div>
          <span className="rcpt-k">RENTAL</span><div>{d.rental}</div>
          <div className="rcpt-amount">
            <div><span className="rcpt-k">AMOUNT RECEIVED</span><strong>{d.amount}</strong></div>
            <div className="r"><b>Rent for {d.period}</b><span className={d.balance ? 'owing' : 'full'}>{d.balance ? `Still owing for the month: ${d.balance}` : 'Paid in full for the month'}</span></div>
          </div>
          <table className="rcpt-rows"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
          <div className="rcpt-sign">
            <div><span>Received with thanks,</span><b>{d.landlord.name}</b><span className="rcpt-k">Landlord</span></div>
            <span className={`rcpt-stamp${old ? ' old' : ''}`}>{old ? 'SUPERSEDED' : 'PAID'}</span>
          </div>
          <p className="rcpt-foot">Keep this receipt for your records. It can be used as proof of rent paid (for example, for a tax credit or a new rental).<br />Issued for {d.landlord.name} by Keyholder · keyholder.cloud</p>
        </div>
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}><button className="btn" id="receipt-pdf" onClick={download} disabled={busy}><Icon name="download" size={16} />{busy ? 'Making the PDF…' : 'Download PDF'}</button></div>
    </>
  );
}

export const methodLabel = (m: string) => ({ etransfer: 'Interac e-Transfer', cheque: 'Cheque', cash: 'Cash', 'direct-deposit': 'Direct deposit', other: 'Other' } as Record<string, string>)[m] ?? m;

