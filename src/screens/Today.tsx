import { useMemo } from 'react';
import { StandingCheck } from '../components/Standing';
import { banksOn, useConn } from '../data/api';
import { twoStepToOffer } from '../components/TwoStep';
import { isHidden } from '../lib/journey';
import { Icon } from '../components/Icon';
import { Link } from 'react-router-dom';
import { useStore } from '../data/store';
import { addDays, fmtDay, periodOf } from '../lib/dates';
import { activeLeases, hasSpace, leaseLedger } from '../lib/finance';
import { RentRows } from '../components/Journey';
import { trayItems } from '../lib/tray';
import { BankStatus } from '../components/domain';
import { SceneEmptyHome } from '../components/Art';
import { Greeting, MonthReview, YearToDate, NextStep, RentCard } from '../components/HomeCards';
import type { Lease, Tenant, Unit } from '../data/types';
import type { LedgerLine } from '../lib/finance';

// Home answers one question first: "Am I okay this month?" Then: what to do next, and what's coming.

export function Today() {
  const { state, act, today } = useStore();
  const { user, config } = useConn();
  const offerTwoStep = twoStepToOffer(user, config?.twoStep);
  const p = periodOf(today);
  const todo = useMemo(() => trayItems(state, today), [state, today]);
  const pending = new Set(todo.flatMap((t) => (t.kind === 'match' && t.suggestion ? [t.suggestion.leaseId] : [])));
  const units = state.units.filter((u) => state.properties.some((x) => x.id === u.propertyId && !x.archived));

  if (!state.properties.length || !state.tenants.length) {
    // Start here: three steps with a progress bar, for people starting with their own data.
    const steps = [
      { done: state.properties.length > 0, title: 'Add your property', sub: 'The address and how many units.', to: '/rentals', btn: 'Add property', icon: 'home' },
      { done: state.tenants.length > 0, title: 'Add your tenant', sub: 'Their name, rent and the day it is due.', to: state.properties[0] ? `/rent/property/${state.properties[0].id}/add-tenant` : '/rentals', btn: 'Add tenant', icon: 'user' },
      { done: state.banks.some((b) => b.status === 'connected') || state.profile.rentArrival === 'manual', title: 'Choose how rent is tracked', sub: banksOn() ? 'Connect your banks, or tap "Mark paid" yourself.' : 'Tap "Mark paid" when rent comes in. Bank checks are coming soon.', to: '/settings#rent-tracking', btn: 'Choose', icon: 'bank' },
      // Live accounts: two-step sign-in (optional; the step stays until it is on).
      ...(offerTwoStep ? [{ done: false, title: 'Turn on two-step sign-in', sub: 'Optional: a code from an app on your phone after your password.', to: '/settings#two-step', btn: 'Turn on', icon: 'lock' }] : []),
    ];
    const n = steps.filter((x) => x.done).length;
    const next = steps.findIndex((x) => !x.done);
    return (
      <div className="page">
        <div className="start-hero">
          <div>
            <h1 style={{ marginBottom: 8 }}>Welcome{state.profile.name ? `, ${state.profile.name.split(' ')[0]}` : ''}.</h1>
            <p className="page-sub">{next === 0 ? "Let's add your first property. Three steps, and Keyholder starts tracking your rent for you." : next === 1 ? 'Your property is in. Next, add your tenant.' : 'Almost done: choose how rent is tracked.'}</p>
          </div>
          <div className="start-art" aria-hidden><SceneEmptyHome /></div>
        </div>
        <div className="sheet start-here" data-tour="start-here">
          <div className="start-head"><h2>Start here</h2><span className="small soft">{n} of {steps.length} done</span></div>
          <div className="start-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={n}><i style={{ width: `${(n / steps.length) * 100}%` }} /></div>
          <ol className="start-steps">{steps.map((x, i) => (
            <li key={x.title} className={x.done ? 'done' : i === next ? 'now' : ''}>
              <span className="start-n">{x.done ? '✓' : i + 1}</span>
              <span><strong>{x.title}</strong><span className="small soft">{x.sub}</span></span>
              {!x.done && <Link className={`btn${i === next ? ' primary' : ''}`} to={x.to}>{x.btn}</Link>}
            </li>
          ))}</ol>
          <p className="small soft">Want to look around first? <Link to="/welcome">See what Keyholder does</Link></p>
        </div>
      </div>
    );
  }

  type Row = { unit: Unit; vacant: true } | { unit: Unit; vacant: false; line: LedgerLine; lease: Lease; tenant: Tenant };
  // One row per lease (each rented room is its own), plus one for any unit or room still free.
  const rows: Row[] = units.flatMap((u): Row[] => {
    const out = activeLeases(state, u.id, today).flatMap((l): Row[] => {
      const line = leaseLedger(l, state.payments, today).find((x) => x.period === p);
      const t = state.tenants.find((x) => x.id === l.tenantId)!;
      return line ? [{ unit: u, vacant: false, line, lease: l, tenant: t }] : [];
    });
    return hasSpace(state, u, today) ? [...out, { unit: u, vacant: true }] : out;
  });
  const occupied = rows.filter((r): r is Extract<Row, { vacant: false }> => !r.vacant);
  const paid = occupied.filter((r) => r.line.state === 'paid').length;
  const late = occupied.filter((r) => !pending.has(r.lease.id) && (r.line.state === 'late' || (r.line.state === 'partial' && r.line.daysLate > 0)));
  const notDue = occupied.length > 0 && occupied.every((r) => r.line.due > today);

  let headline: React.ReactNode;
  if (notDue) headline = <>Rent is due {fmtDay(occupied[0].line.due)}.</>;
  else if (!late.length && pending.size) headline = <>{paid} of {occupied.length} paid. Please confirm {pending.size === 1 ? 'one payment' : `${pending.size} payments`}.</>;
  else if (!late.length) headline = <><em className="all-in"><span className="all-in-ic" aria-hidden><Icon name="home" size={16} /></span>All rent is in.</em> Nice work.</>;
  else headline = <>{paid} of {occupied.length} paid. <span className="bad">{late.length === 1 ? `${firstName(late[0])} is late.` : `${late.length} tenants are late.`}</span></>;

  return (
    <div className="page home">
      <h1 className="sr-only">Home</h1>
      <div className="home-top"><Greeting /></div>
      <div className="home-grid">
        <div className="home-main">
          <StandingCheck />
          <RentCard headline={headline} />
          {/* All rent in: nothing to check, so the bank line steps aside. */}
          {!(occupied.length > 0 && !late.length && !pending.size && !notDue && paid === occupied.length) && <div className="track-top"><BankStatus /></div>}
          {offerTwoStep && !isHidden(state, 'two-step', today) && (
            <div className="sheet two-step-nudge" id="two-step-nudge">
              <span className="tile-ic lilac" aria-hidden><Icon name="lock" size={18} /></span>
              <div><strong>Turn on two-step sign-in</strong><span className="small soft">Optional: after your password, a code from an app on your phone. It keeps your tenants' information safe.</span></div>
              <div className="btn-row"><Link className="btn primary" to="/settings#two-step">Turn on</Link><button className="btn ghost" onClick={() => act.setTodoPref('two-step', { hiddenUntil: addDays(today, 30) })}>Not now</button></div>
            </div>
          )}
          <NextStep />
          <RentRows />
        </div>
        <aside className="home-side" aria-label="More for this month">
          <YearToDate />
          <MonthReview />
        </aside>
      </div>

    </div>
  );
}

function firstName(r: { tenant?: { names: string[] } }) { return r.tenant?.names[0].split(' ')[0] ?? 'A tenant'; }
