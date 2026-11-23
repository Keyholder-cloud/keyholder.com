import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { AppState } from '../data/types';
import { useStore } from '../data/store';
import { Icon } from './Icon';
import { currentLeases, leaseLedger, picture, portfolio } from '../lib/finance';
import { addMonths, daysBetween, fmtPeriod, periodOf } from '../lib/dates';
import { fmt0 } from '../lib/money';
import { allJourneyCards, isHidden, prefKey } from '../lib/journey';
import { trayItems } from '../lib/tray';
import { StepButton } from './Journey';

// Home, organised around "this month": one answer per card, details one tap away.

/** "Good morning, Alex" with today's date. */
export function Greeting() {
  const { state, today } = useStore();
  const h = new Date().getHours();
  const hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const first = state.profile.name?.split(' ')[0];
  return (
    <div className="greet">
      <p className="greet-date">{new Intl.DateTimeFormat('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${today}T12:00:00`))}</p>
      <h2 className="greet-hi">{hello}{first ? `, ${first}` : ''}</h2>
    </div>
  );
}

function monthRent(state: AppState, today: string) {
  const p = periodOf(today);
  // Payments Keyholder found but the owner has not confirmed yet are "to confirm", not late.
  const pending = new Set(trayItems(state, today).flatMap((t) => (t.kind === 'match' && t.suggestion ? [t.suggestion.leaseId] : [])));
  let expected = 0, collected = 0, paid = 0, late = 0, due = 0, confirm = 0, dueDate = '';
  for (const l of currentLeases(state, today)) {
    const u = state.units.find((x) => x.id === l.unitId);
    if (!u || !state.properties.some((x) => x.id === u.propertyId && !x.archived)) continue;
    const line = leaseLedger(l, state.payments, today).find((x) => x.period === p); if (!line) continue;
    expected += line.charge; collected += Math.min(line.paid, line.charge);
    if (line.state === 'paid') paid++; else if (pending.has(l.id)) confirm++; else if (line.daysLate > 0) late++; else due++;
    if (!dueDate || line.due < dueDate) dueDate = line.due;
  }
  return { expected, collected, paid, late, due, confirm, dueDate, period: p };
}

/** The one number landlords check: how much of this month's rent is in. */
export function RentCard({ headline }: { headline: React.ReactNode }) {
  const { state, today } = useStore();
  const m = useMemo(() => monthRent(state, today), [state, today]);
  const pctIn = m.expected ? Math.round((m.collected / m.expected) * 100) : 0;
  const allIn = m.expected > 0 && m.collected >= m.expected;
  return (
    <section className={`rent-card${allIn ? ' all-in-card' : ''}`} aria-label={`Rent for ${fmtPeriod(m.period)}`}>
      <div className="rent-card-main">
        <p className="rent-card-k">Rent for {fmtPeriod(m.period)}</p>
        <p className="pulse">{headline}</p>
        <div className="rent-meter" role="img" aria-label={`${fmt0(m.collected)} of ${fmt0(m.expected)} collected`}>
          <div className="rent-meter-nums"><strong>{fmt0(m.collected)}</strong><span>of {fmt0(m.expected)} collected</span></div>
          <div className="rent-bar"><i style={{ width: `${pctIn}%` }} /></div>
        </div>
      </div>
    </section>
  );
}

/** The single most important thing to do right now (nothing shows when nothing needs you). */
export function NextStep() {
  const { state, today } = useStore();
  const card = useMemo(() => allJourneyCards(state, today).filter((c) => !isHidden(state, prefKey(c), today)).sort((a, b) => a.priority - b.priority)[0], [state, today]);
  // Nothing to do: no card at all (less to read).
  if (!card) return null;
  return (
    <section className={`next-card${card.urgent ? ' urgent' : ''}`}>
      <span className={`tile-ic big ${card.urgent ? 'rose' : 'lilac'}`}><Icon name={card.urgent ? 'bell' : 'sparkle'} size={24} /></span>
      <div className="next-body">
        <p className="next-k">Your next step</p>
        <h3>{card.title.split(' & ').map((n) => n.split(' ')[0]).join(' & ')}</h3>
        <p className="next-text">{card.text}</p>
      </div>
      <div className="next-act"><StepButton c={card} /></div>
    </section>
  );
}



/** Running costs and mortgage payments (the Cash flow page's "Money out"). Improvements are kept apart: they are shown on their own and handled at tax time. */
const moneyOut = (p: { opex: number; mortgageInterest: number; mortgagePrincipal: number }) => p.opex + p.mortgageInterest + p.mortgagePrincipal;

/** This year so far: what you own (properties, units rented, value) and the cash flow since January 1. */
export function YearToDate() {
  const { state, today } = useStore();
  const y = useMemo(() => {
    const from = `${today.slice(0, 4)}-01-01`;
    const props = state.properties.filter((p) => !p.archived);
    const units = state.units.filter((u) => props.some((p) => p.id === u.propertyId));
    const rented = units.filter((u) => u.status !== 'vacant').length;
    const pf = portfolio(state, today);
    return { p: picture(state, from, today), props: props.length, units: units.length, rented, value: pf.value, owed: pf.owed, net: pf.yours };
  }, [state, today]);
  if (!y.props) return null;
  return (
    <section className="side-card" aria-label="Year to date" id="ytd">
      <h2 className="side-title">Portfolio summary</h2>
      <p className="side-sub">Overview</p>
      <div className="ytd-over">
        <div><span>Net worth</span><strong id="ytd-net">{y.value ? fmt0(y.net) : '—'}</strong></div>
        <div><span>Units rented</span><strong>{y.rented} of {y.units}</strong></div>
      </div>
      <p className="side-sub" id="ytd-cash">Cash flow, {today.slice(0, 4)} so far</p>
      <div className="review-grid">
        <div title={y.p.otherIncome ? `Rent ${fmt0(y.p.rentCollected)} and other income ${fmt0(y.p.otherIncome)}` : undefined}><span>{y.p.otherIncome ? 'Money in' : 'Rent in'}</span><strong>{fmt0(y.p.rentCollected + y.p.otherIncome)}</strong></div>
        <div title="Running costs and mortgage payments: the same as Cash flow"><span>Money out</span><strong>{fmt0(moneyOut(y.p))}</strong></div>
        <div className={`kept${y.p.kept < 0 ? ' neg' : ''}`}><span>You kept</span><strong>{fmt0(y.p.kept)}</strong></div>
      </div>
      {y.p.capital > 0 && <Link className="ytd-improve" id="ytd-improve" to="/paperwork/taxes#improvements"><Icon name="wrench" size={14} /><span title="Kept apart from Money out: handled at tax time">Improvements · not in Money out</span><strong>{fmt0(y.p.capital)}</strong><Icon name="next" size={14} /></Link>}
      <Link className="side-link" to="/portfolio">See the full picture<Icon name="next" size={16} /></Link>
    </section>
  );
}


/** Small milestones that build the habit. */
export function Milestones() {
  const { state, today } = useStore();
  const items = useMemo(() => {
    const sent = state.receipts.filter((r) => r.status === 'sent').length;
    const months = new Set(state.payments.map((p) => p.period)).size;
    const tenure = state.properties.length ? Math.max(...state.properties.map((p) => (p.purchaseDate ? daysBetween(p.purchaseDate, today) : 0))) : 0;
    return [
      { icon: 'receipt', label: 'First receipt sent', done: sent > 0, tone: 'mint' },
      { icon: 'camera', label: '10 costs saved', done: state.expenses.length >= 10, tone: 'peach' },
      { icon: 'calendar', label: '3 months of rent tracked', done: months >= 3, tone: 'sky' },
      { icon: 'star', label: 'A year with your rental', done: tenure >= 365 || addMonths(today, -12) >= (state.leases.map((l) => l.start).sort()[0] ?? today), tone: 'sun' },
    ];
  }, [state, today]);
  const n = items.filter((i) => i.done).length;
  return (
    <section className="side-card" aria-label="Milestones">
      <h2 className="side-title">Milestones <span className="side-count">{n} of {items.length}</span></h2>
      <ul className="badges">{items.map((i) => <li key={i.label} className={i.done ? 'on' : ''}><span className={`tile-ic sm ${i.done ? i.tone : 'off'}`}><Icon name={i.done ? i.icon : 'lock'} size={16} /></span>{i.label}</li>)}</ul>
    </section>
  );
}
