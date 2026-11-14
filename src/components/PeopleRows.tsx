import { useState } from 'react';
import type { Lease } from '../data/types';
import { useStore } from '../data/store';
import { fmtDay } from '../lib/dates';
import type { LedgerLine } from '../lib/finance';
import { fmt } from '../lib/money';
import { personLines, type PersonLine } from '../lib/shares';
import { PaymentForm } from './forms';
import { StatusPill } from './Guide';
import { Icon } from './Icon';

/**
 * A shared lease: one row per person under the unit, each with their share of this month's rent, where they stand,
 * and their own "Mark paid" (the receipt goes to them). `home` matches Home's rent list; `rentals` the Rentals list.
 */
export function PeopleRows({ lease, line, look }: { lease: Lease; line: LedgerLine; look: 'home' | 'rentals' }) {
  const { state } = useStore();
  return <>{personLines(state, lease, line).map((p) => <PersonRow key={p.idx} lease={lease} line={line} p={p} look={look} />)}</>;
}

function PersonRow({ lease, line, p, look }: { lease: Lease; line: LedgerLine; p: PersonLine; look: 'home' | 'rentals' }) {
  const [pay, setPay] = useState(false);
  const last = line.payments.filter((x) => x.person === p.idx).pop()?.date;
  const tone = p.state === 'late' ? 'late' : p.state === 'paid' ? 'paid' : p.state === 'partial' ? 'partial' : 'due';
  const label = p.state === 'paid' ? 'Paid'
    : p.state === 'partial' ? `${fmt(p.owing)} owed`
    : p.state === 'late' ? `Late · ${p.daysLate} day${p.daysLate === 1 ? '' : 's'}`
    : line.state === 'upcoming' ? `Due ${fmtDay(line.due)}` : 'Due today';
  const first = p.name.split(' ')[0];
  const act = p.owing > 0
    ? <button className="btn" onClick={() => setPay(true)} aria-label={`Mark ${first} paid`}>Mark paid</button>
    : look === 'home' ? <span className="paid-on">{last ? fmtDay(last) : ''}</span> : null;
  const form = pay && <PaymentForm leaseId={lease.id} person={p.idx} onClose={() => setPay(false)} />;
  if (look === 'home') {
    return (
      <li className={`rent-row person-row ${tone === 'late' ? 'late' : ''}`} data-person={p.idx}>
        <span className="who-link"><span className="person-dot" aria-hidden /><span className="who-text"><span className="who">{first}</span><span className="person-share">{fmt(p.share)} share</span></span></span>
        <StatusPill tone={tone}>{tone === 'paid' && <Icon name="check" size={16} />}{label}</StatusPill>
        <span className="row-act">{act}</span>
        {form}
      </li>
    );
  }
  return (
    <li className={`unit-row person-row ${tone === 'late' ? 'late' : ''}`} data-person={p.idx}>
      <span className="unit-label person-dot-wrap" aria-hidden><span className="person-dot" /></span>
      <span className="unit-who"><strong>{p.name}</strong><span>{fmt(p.share)} share{p.paid > 0 && p.owing > 0 ? ` · ${fmt(p.paid)} paid` : ''}</span></span>
      <span className="unit-state"><span className={`status ${tone}`}>{tone === 'paid' && <Icon name="check" size={16} />}{label}</span></span>
      <span className="row-act">{act}</span>
      {form}
    </li>
  );
}
