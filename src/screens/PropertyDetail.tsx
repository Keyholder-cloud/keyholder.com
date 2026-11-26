import { useMemo, useState } from 'react';
import { Link, NavLink, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useStore } from '../data/store';
import { FindTenantPage, NoticesTab, TenantsList, UnitsTab } from './Rentals';
import { ArchivePropertyDrawer } from '../components/PropertyActions';
import type { Property } from '../data/types';
import { propertyLevel, atLeast } from '../lib/levels';
import { LevelSteps, LevelUpForm, PropertyCard } from '../components/levels';
import { daysBetween, fmtDate } from '../lib/dates';
import { adjustedCostBase, amortization, mortgageBalanceAt, mortgagePaidBetween, mortgageTermsOn, owedAt, ownEstimate, PERIODS_PER_YEAR, propertyTaxOn, propertyValue } from '../lib/finance';
import { LENDER_MAX_LTV, SELLING_COST_PCT, borrowingRoom, gainSincePurchase, returnComparison, roughSale } from '../lib/silver';
import { fmt, fmt0 } from '../lib/money';
import { RentRoll } from '../components/domain';
import { MortgageForm, OwnerEstimateForm, PropertyForm } from '../components/forms';
import { Drawer, Empty, Field, Figure, MoneyInput } from '../components/ui';
import type { Mortgage } from '../data/types';
import { Icon } from '../components/Icon';
import { useMore } from '../components/More';

export function PropertyDetail() {
  const { id, tab = 'units' } = useParams();
  const { state, act } = useStore();
  const nav = useNavigate();
  const [edit, setEdit] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const p = state.properties.find((x) => x.id === id);
  if (!p) return <div className="page"><Empty title="That property isn't here." action={<Link to="/rentals" className="btn">Back to Rentals</Link>} /></div>;
  const cur = tab === 'overview' ? 'units' : tab;
  const base = `/rent/property/${p.id}`;
  // Find a tenant is its own page for this property (not a tab).
  if (cur === 'find') return <FindTenantPage propertyId={p.id} />;

  return (
    <div className="page">
      <Link to="/rentals" className="crumb"><Icon name="back" size={16} />Back to Rentals</Link>
      <h1 className="sr-only">{p.nickname}</h1>
      {p.archived && (
        <div className="callout warn archived-note" id="archived-note">
          <strong>Archived{p.archivedOn ? ` · ${p.archivedReason === 'not-rented' ? 'no longer rented' : 'sold'} ${fmtDate(p.archivedOn)}` : ''}.</strong> It is hidden from Home, Rentals and your totals; its records are kept for your taxes.
          <div className="btn-row" style={{ marginTop: 10 }}><button className="btn" onClick={() => act.restoreProperty(p.id)}>Restore</button></div>
        </div>
      )}
      <div className="prop-head">
        <PropertyCard property={p} active banner />
        <div className="prop-head-act">
          <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" size={16} />Edit details</button>
          {!p.archived && <button className="btn ghost" id="archive-property" onClick={() => setArchiving(true)}>Archive property</button>}
        </div>
      </div>
      <nav className="tabs" aria-label="Property sections">
        <NavLink end to={base} className={cur === 'units' ? 'active' : ''}>Units</NavLink>
        <NavLink to={`${base}/tenants`} className={cur === 'tenants' || cur === 'add-tenant' ? 'active' : ''}>Tenants</NavLink>
        <NavLink to={`${base}/notices`}>Late rent and notices</NavLink>
        <NavLink to={`${base}/value`}>Value</NavLink>
        <NavLink to={`${base}/mortgage`}>Mortgage</NavLink>
      </nav>
      {cur === 'units' && (
        <>
          <UnitsTab propertyId={p.id} />
          {state.units.some((u) => u.propertyId === p.id) && <section className="section"><h2 className="section-title">Rent, last 12 months</h2><div className="sheet"><RentRoll propertyId={p.id} /></div></section>}
        </>
      )}
      {(cur === 'tenants' || cur === 'add-tenant') && <TenantsList propertyId={p.id} />}
      {cur === 'notices' && <NoticesTab propertyId={p.id} />}
      {cur === 'value' && <ValueTab id={p.id} />}
      {cur === 'mortgage' && (atLeast(propertyLevel(state, p), 'gold') ? <MortgageTab id={p.id} /> : <LevelSteps property={p} />)}
      {edit && <PropertyForm property={p} onClose={() => setEdit(false)} />}
      {archiving && <ArchivePropertyDrawer property={p} onClose={() => setArchiving(false)} onDone={() => nav('/rentals')} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Value: what you paid, or your own estimate, less what is owed. Keyholder does not estimate home values.
// ---------------------------------------------------------------------------------
function ValueTab({ id }: { id: string }) {
  const { state, today, act } = useStore();
  // From setup progress ("Do it"): ?open=paid opens "What you paid" right away.
  const loc = useLocation();
  const [form, setForm] = useState<'owner' | 'paid' | null>(() => (new URLSearchParams(loc.search).get('open') === 'paid' ? 'paid' : null));
  const p = state.properties.find((x) => x.id === id)!;
  const vi = propertyValue(state, p, today);
  const o = owedAt(state, p, today);
  const share = p.ownershipPct / 100;
  const gain = gainSincePurchase(state, p, today);
  const mine = ownEstimate(state, id, today);
  // Only what the landlord entered: what they paid, their estimates and appraisals.
  const history = state.valuations.filter((v) => v.propertyId === id && (v.source === 'purchase' || v.source === 'owner' || v.source === 'assessment')).sort((a, b) => b.date.localeCompare(a.date));
  const LABEL: Record<string, string> = { purchase: 'What you paid', owner: 'Your estimate', assessment: 'Appraisal' };

  return (
    <>
      <div className="sheet worth" id="worth">
        {vi.basis === 'none' ? (
          <>
            <h3 style={{ marginTop: 0 }}>What it's worth to you</h3>
            <p className="soft" style={{ marginTop: 0 }}>Worth is what you paid (or your own estimate), less what is still owed. Start with step 1 below.</p>
          </>
        ) : (
          <>
            <div className="worth-grid">
              <div><div className="small soft">Worth</div><div className="figure">{fmt0(vi.value)}</div><div className="tiny soft">{vi.source}</div></div>
              <div><div className="small soft">Still owed</div><div className="figure">{o.known ? fmt0(o.owed) : '—'}</div><div className="tiny soft">{p.mortgageFree ? 'No mortgage' : state.mortgages.some((m) => m.propertyId === id) ? 'From your mortgage' : o.known ? 'Your figure' : <button className="link-btn" onClick={() => setForm('paid')}>Add what is owed</button>}</div></div>
              <div><div className="small soft">Yours{p.ownershipPct < 100 ? ` (${p.ownershipPct}%)` : ''}</div><div className="figure in">{o.known ? fmt0(Math.round((vi.value - o.owed) * share)) : '—'}</div><div className="tiny soft">Worth less what is owed</div></div>
            </div>
            {gain && <p className="small" style={{ margin: '12px 0 0' }}>By your estimate, it is {gain.gain >= 0 ? 'up' : 'down'} <strong>{fmt0(Math.abs(gain.gain))}</strong> ({gain.gain >= 0 ? '+' : '−'}{Math.abs(gain.pct).toFixed(0)}%) since you bought it for {fmt0(gain.paid)}.</p>}
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn" id="add-own" onClick={() => setForm('owner')}><Icon name="edit" size={16} />{mine ? 'Update my own estimate' : 'Add my own estimate'}</button>
              {!p.purchasePrice && <button className="btn" onClick={() => setForm('paid')}><Icon name="plus" size={16} />Add what you paid</button>}
            </div>
            <p className="tiny soft" style={{ margin: '8px 0 0' }}>{mine ? 'Your own estimate is used until you add a newer one.' : 'Optional: add your own estimate, for example from a recent appraisal, to use instead of what you paid.'}</p>
          </>
        )}
      </div>

      {/* One path up: step 1 (what you paid) now, step 2 (the mortgage) greyed until then. */}
      {!(p.purchasePrice && p.purchaseDate) && <LevelSteps property={p} onOwnEstimate={vi.basis === 'none' ? () => setForm('owner') : undefined} />}
      {p.purchasePrice && p.purchaseDate && <SilverInsights p={p} />}

      {history.length > 0 && (
        <section className="section">
          <h2 className="section-title">Values you entered</h2>
          <ul className="rows sheet" style={{ padding: '0 16px' }}>{history.map((v) => (
            <li key={v.id} className="row"><span className="margin">{fmtDate(v.date)}</span>
              <span><span className="title">{fmt0(v.likely)}</span><span className="sub" style={{ display: 'block' }}>{LABEL[v.source]}{v.note && v.source !== 'purchase' ? ` · ${v.note}` : ''}</span></span>
              {v.source !== 'purchase' ? <button className="btn small ghost" onClick={() => act.removeValuation(v.id)} aria-label={`Remove the value from ${fmtDate(v.date)}`}><Icon name="trash" size={16} /></button> : <span />}</li>
          ))}</ul>
        </section>
      )}
      {form === 'owner' && <OwnerEstimateForm propertyId={id} onClose={() => setForm(null)} />}
      {form === 'paid' && <LevelUpForm property={p} to="silver" onClose={() => setForm(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------------
// Gold — mortgage, payment schedule, cost base
// ---------------------------------------------------------------------------------
function MortgageTab({ id }: { id: string }) {
  const { state, today } = useStore();
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  const [renew, setRenew] = useState(false);
  const p = state.properties.find((x) => x.id === id)!;
  const m = state.mortgages.find((x) => x.propertyId === id);
  const rows = useMemo(() => (m ? amortization(m) : []), [m]);
  const upcoming = rows.filter((r) => r.date > today);
  const [upShown, upMore] = useMore(upcoming);
  const acb = adjustedCostBase(state, p);
  const value = propertyValue(state, p, today).value;
  const sellCost = Math.round(value * 0.05);
  const gain = value - sellCost - acb;
  const capex = state.expenses.filter((e) => e.propertyId === id && e.kind === 'capital');

  if (!m) {
    return (
      <>
        <WhatYouPay propertyId={id} />
        <div className="sheet" style={{ marginTop: 16 }}><Empty title="No mortgage added." action={<button className="btn primary" onClick={() => setEdit('new')}>Add mortgage</button>}>Paid off? You can skip this.</Empty></div>
        {edit && <MortgageForm propertyId={id} onClose={() => setEdit(null)} />}
      </>
    );
  }
  const bal = mortgageBalanceAt(m, today, rows);
  const ytd = mortgagePaidBetween(m, `${today.slice(0, 4)}-01-01`, today, rows);
  const termEnd = mortgageTermsOn(m, today).termEnd;
  const daysToRenew = daysBetween(today, termEnd);
  const next = rows.find((r) => r.date > today);

  return (
    <>
      {daysToRenew >= 0 && daysToRenew <= 120 && <div className="callout brass spread" id="renew-note"><span><strong>Renews in {daysToRenew} days</strong> ({fmtDate(termEnd)}). A good time to compare rates.</span><button className="btn small" id="renew-update" onClick={() => setRenew(true)}>Update after renewal</button></div>}
      <WhatYouPay propertyId={id} />
      <div className="figures">
        <div><div className="label">Still owed</div><Figure cents={bal} size="sm" /></div>
        <div><div className="label">Interest this year</div><Figure cents={ytd.interest} size="sm" /></div>
        <div><div className="label">Paid off this year</div><Figure cents={ytd.principal} size="sm" className="in" /></div>
      </div>
      <div className="sheet" style={{ marginTop: 16 }}>
        <div className="spread">
          <div>
            {next && <p style={{ margin: 0 }}><strong>Next payment {fmtDate(next.date)}: {fmt(next.payment)}</strong></p>}
            <p className="small soft" style={{ margin: 0 }}>{m.lender} · {mortgageTermsOn(m, today).ratePct.toFixed(2)}% · renews {fmtDate(termEnd)}</p>
          </div>
          <button className="btn" onClick={() => setEdit(m.id)}><Icon name="edit" size={16} />Edit</button>
        </div>
        {p.rentalSharePct < 100 && <p className="small soft" style={{ margin: '12px 0 0' }}>You can deduct {p.rentalSharePct}% of the interest, the part for the rental.</p>}
      </div>

      <details className="more">
        <summary>Show all payments</summary>
        <div className="more-body table-scroll">
          <table className="ledger">
            <thead><tr><th>Date</th><th className="num">Payment</th><th className="num">Interest</th><th className="num">Paid off</th><th className="num">Still owed</th></tr></thead>
            <tbody>{upShown.map((r) => (
              <tr key={r.n}><td className="date">{fmtDate(r.date)}</td><td className="num">{fmt(r.payment)}</td><td className="num">{fmt(r.interest)}</td><td className="num in">{fmt(r.principal)}</td><td className="num">{fmt(r.balance)}</td></tr>
            ))}</tbody>
          </table>{upMore}
          <p className="tiny soft">Paid off on {rows.length ? fmtDate(rows[rows.length - 1].date) : '—'} if the rate stays the same.</p>
        </div>
      </details>

      <details className="more">
        <summary>What it cost you, and if you sold</summary>
        <div className="more-body grid2" style={{ gap: 16 }}>
          <div className="sheet">
            <h3 style={{ marginBottom: 8 }}>What it cost you</h3>
            <div className="kv">
              <div>Price</div><div>{fmt0(p.purchasePrice ?? 0)}</div>
              <div>Closing costs</div><div>{fmt0(p.closingCosts ?? 0)}</div>
              <div>Land transfer tax</div><div>{fmt0(p.landTransferTax ?? 0)}</div>
              <div>Upgrades{capex.length ? ` (${capex.length})` : ''}</div><div>{fmt0((p.improvementsAtPurchase ?? 0) + capex.reduce((a, e) => a + e.amount, 0))}</div>
              <div><strong>Total</strong></div><div><strong>{fmt0(acb)}</strong></div>
            </div>
          </div>
          <div className="sheet">
            <h3 style={{ marginBottom: 8 }}>If you sold today</h3>
            <div className="kv">
              <div>Worth (what you paid, or your estimate)</div><div>{fmt0(value)}</div>
              <div>Selling costs (about 5%)</div><div>−{fmt0(sellCost)}</div>
              <div>What it cost you</div><div>−{fmt0(acb)}</div>
              <div><strong>Gain</strong></div><div><strong>{fmt0(gain)}</strong></div>
            </div>
            <p className="tiny soft" style={{ marginTop: 8 }}>{p.ownerOccupied ? `Your own home part is usually tax-free. The rented ${p.rentalSharePct}% usually is not. ` : ''}An estimate. Ask your accountant before selling.</p>
          </div>
        </div>
      </details>
      {edit && <MortgageForm propertyId={id} mortgage={edit === 'new' ? undefined : m} onClose={() => setEdit(null)} />}
      {renew && <MortgageChangeDrawer m={m} renewal onClose={() => setRenew(false)} />}
    </>
  );
}

const FREQ_WORD: Record<Mortgage['frequency'], string> = { monthly: 'month', 'semi-monthly': 'half month', biweekly: 'two weeks', weekly: 'week' };

/**
 * What you pay for the property, in one place: the mortgage payment (and the property tax in it, when the lender
 * collects it) and the property tax. Each has a Change button; a change starts on a date, so earlier months keep
 * what they were.
 */
function WhatYouPay({ propertyId }: { propertyId: string }) {
  const { state, today, act } = useStore();
  const p = state.properties.find((x) => x.id === propertyId)!;
  const m = state.mortgages.find((x) => x.propertyId === propertyId);
  const [open, setOpen] = useState<'mortgage' | 'tax' | null>(null);
  const rows = useMemo(() => (m ? amortization(m) : []), [m]);
  const next = rows.find((r) => r.date >= today);
  const terms = m ? mortgageTermsOn(m, next?.date ?? today) : null;
  const perYear = m ? PERIODS_PER_YEAR[m.frequency] : 12;
  const taxEach = terms?.tax ?? 0;
  const cityTax = propertyTaxOn(p, today);
  const history = [
    ...(m?.changes ?? []).map((c) => ({ from: c.from, text: [c.ratePct !== undefined ? `rate ${c.ratePct.toFixed(2)}%` : '', c.payment !== undefined ? `payment ${fmt(c.payment)}` : c.ratePct !== undefined ? 'payment worked out from the rate' : '', c.taxWithPayment !== undefined ? (c.taxWithPayment ? `property tax ${fmt(c.taxWithPayment)} a payment, with the mortgage` : 'property tax no longer with the mortgage') : '', c.termEnd ? `renews ${fmtDate(c.termEnd)}` : ''].filter(Boolean).join(' · '), note: c.note, remove: () => act.removeMortgageChange(m!.id, c.from) })),
    ...(p.propertyTaxHistory ?? []).filter((h) => h.from > '1900-01-01').map((h) => ({ from: h.from, text: `property tax ${fmt0(h.annual)} a year, paid to the city`, note: undefined, remove: undefined })),
  ].sort((a, b) => b.from.localeCompare(a.from));
  return (
    <div className="sheet pay-card" id="what-you-pay" style={{ marginTop: 16 }}>
      <h2 style={{ marginBottom: 10 }}>What you pay</h2>
      {m && next && <div className="pay-row" id="pay-mortgage">
        <div>
          <div className="pay-k"><Icon name="bank" size={16} />Mortgage</div>
          <div className="pay-v"><strong>{fmt(next.payment)}</strong> every {FREQ_WORD[m.frequency]}<span className="soft"> · next {fmtDate(next.date)}</span></div>
          <div className="small soft">{m.lender} · {terms!.ratePct.toFixed(2)}% · renews {fmtDate(terms!.termEnd)}</div>
          {taxEach > 0 && <div className="small pay-total">+ {fmt(taxEach)} property tax collected by {m.lender} · <strong>{fmt(next.payment + taxEach)}</strong> leaves your account</div>}
        </div>
        <button className="btn small" id="pay-mortgage-change" onClick={() => setOpen('mortgage')}><Icon name="edit" size={14} />Change</button>
      </div>}
      <div className="pay-row" id="pay-tax">
        <div>
          <div className="pay-k"><Icon name="home" size={16} />Property tax</div>
          {taxEach > 0
            ? <><div className="pay-v"><strong>{fmt0(taxEach * perYear)}</strong> a year<span className="soft"> · paid with your mortgage</span></div><div className="small soft">{fmt(taxEach)} in each payment; {m!.lender} pays the city. Counted as property tax, not mortgage.</div></>
            : cityTax ? <><div className="pay-v"><strong>{fmt0(cityTax)}</strong> a year<span className="soft"> · paid to the city yourself</span></div><div className="small soft">Add each bill under Expenses when you pay it.</div></>
              : <div className="pay-v soft">Not added yet</div>}
        </div>
        <button className="btn small" id="pay-tax-change" onClick={() => setOpen('tax')}><Icon name="edit" size={14} />{taxEach > 0 || cityTax ? 'Change' : 'Add'}</button>
      </div>
      {history.length > 0 && <details className="more" style={{ marginTop: 8 }}><summary className="small">Changes ({history.length})</summary>
        <ul className="pay-history">{history.map((h, i) => <li key={`${h.from}-${i}`}><span className="mono">{fmtDate(h.from)}</span><span>{h.text}{h.note ? ` (${h.note})` : ''}</span>{h.remove && <button className="btn ghost small icon-only" aria-label="Remove this change" title="Remove this change" onClick={() => { if (window.confirm('Remove this change? Payments from that date go back to what they were.')) h.remove!(); }}><Icon name="trash" size={14} /></button>}</li>)}</ul>
      </details>}
      {open === 'mortgage' && m && <MortgageChangeDrawer m={m} onClose={() => setOpen(null)} />}
      {open === 'tax' && <PropertyTaxDrawer propertyId={propertyId} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** A new rate or payment from a date (a renewal, or a variable rate that moved). */
function MortgageChangeDrawer({ m, renewal, onClose }: { m: Mortgage; renewal?: boolean; onClose: () => void }) {
  const { act, today } = useStore();
  const rows = useMemo(() => amortization(m), [m]);
  const cur = mortgageTermsOn(m, today);
  const nextDate = rows.find((r) => r.date >= today)?.date ?? today;
  const [from, setFrom] = useState(renewal ? cur.termEnd : nextDate);
  const [rate, setRate] = useState(cur.ratePct.toFixed(2));
  const [payment, setPayment] = useState<number | undefined>(rows.find((r) => r.date >= today)?.payment);
  const [auto, setAuto] = useState(false);
  const [termYears, setTermYears] = useState(String(m.termYears ?? 5));
  const rateN = Number(rate);
  const ok = !!from && rateN > 0 && rateN < 30 && (auto || (payment ?? 0) > 0);
  const save = () => {
    const termEnd = renewal ? `${Number(from.slice(0, 4)) + (Number(termYears) || 5)}${from.slice(4)}` : undefined;
    act.changeMortgage(m.id, { from, ratePct: rateN, ...(auto ? {} : { payment }), ...(termEnd ? { termEnd } : {}), ...(renewal ? { note: 'renewal' } : {}) });
    onClose();
  };
  return (
    <Drawer title={renewal ? 'Update after renewal' : 'Change the mortgage payment'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" id="mc-save" disabled={!ok} onClick={save}>Save</button></>}>
      <p className="small soft" style={{ marginTop: 0 }}>Payments from this date use the new amounts. Earlier payments stay as they were.</p>
      <Field label="From" htmlFor="mc-from"><input id="mc-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <div className="grid2">
        <Field label="Interest rate (%)" htmlFor="mc-rate"><input id="mc-rate" className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        {renewal && <Field label="New term (years)" htmlFor="mc-term"><input id="mc-term" className="input" inputMode="numeric" value={termYears} onChange={(e) => setTermYears(e.target.value.replace(/\D/g, ''))} /></Field>}
      </div>
      <Field label="New payment (interest and principal, without property tax)" htmlFor="mc-pay" hint="As on your lender's renewal letter or statement.">
        <MoneyInput id="mc-pay" value={auto ? undefined : payment} onChange={(c) => { setPayment(c); setAuto(false); }} placeholder={auto ? 'Worked out from the rate' : undefined} />
      </Field>
      <label className="check"><input type="checkbox" id="mc-auto" checked={auto} onChange={(e) => setAuto(e.target.checked)} />I don't know it yet: work it out from the rate</label>
    </Drawer>
  );
}

/** Property tax: paid with the mortgage (an amount in each payment) or to the city (a yearly amount), from a date. */
function PropertyTaxDrawer({ propertyId, onClose }: { propertyId: string; onClose: () => void }) {
  const { state, act, today } = useStore();
  const p = state.properties.find((x) => x.id === propertyId)!;
  const m = state.mortgages.find((x) => x.propertyId === propertyId);
  const rows = useMemo(() => (m ? amortization(m) : []), [m]);
  const nextDate = rows.find((r) => r.date >= today)?.date ?? `${today.slice(0, 4)}-01-01`;
  const cur = m ? mortgageTermsOn(m, nextDate).tax : 0;
  const [how, setHow] = useState<'mortgage' | 'city'>(m && cur > 0 ? 'mortgage' : 'city');
  const [each, setEach] = useState<number | undefined>(cur || undefined);
  const [annual, setAnnual] = useState<number | undefined>(propertyTaxOn(p, today));
  const [from, setFrom] = useState(m && cur > 0 ? nextDate : `${today.slice(0, 4)}-01-01`);
  const perYear = m ? PERIODS_PER_YEAR[m.frequency] : 12;
  const ok = !!from && (how === 'mortgage' ? (each ?? 0) > 0 : (annual ?? 0) > 0);
  const save = () => {
    if (how === 'mortgage' && m) act.changeMortgage(m.id, { from, taxWithPayment: each! });
    else {
      if (m && cur > 0) act.changeMortgage(m.id, { from, taxWithPayment: 0 });
      act.changePropertyTax(propertyId, annual!, from);
    }
    onClose();
  };
  return (
    <Drawer title="Property tax" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" id="pt-save" disabled={!ok} onClick={save}>Save</button></>}>
      <Field label="How is it paid?">
        <div className="seg" role="radiogroup" aria-label="How property tax is paid">
          <button type="button" role="radio" id="pt-mortgage" aria-checked={how === 'mortgage'} disabled={!m} title={m ? undefined : 'Add the mortgage first'} onClick={() => setHow('mortgage')}>With my mortgage</button>
          <button type="button" role="radio" id="pt-city" aria-checked={how === 'city'} onClick={() => setHow('city')}>To the city myself</button>
        </div>
      </Field>
      {how === 'mortgage'
        ? <Field label={`Property tax in each ${m ? FREQ_WORD[m.frequency] : 'month'}'s payment`} htmlFor="pt-each" hint={each ? `${fmt0(each * perYear)} a year. ${m!.lender} pays the city; Keyholder counts it as property tax, not mortgage.` : 'On your mortgage statement, often called "tax account" or "property tax".'}>
            <MoneyInput id="pt-each" value={each} onChange={setEach} />
          </Field>
        : <Field label="Property tax a year" htmlFor="pt-annual" hint="From your city's tax bill. Add each payment under Expenses when you pay it."><MoneyInput id="pt-annual" value={annual} onChange={setAnnual} /></Field>}
      <Field label="From" htmlFor="pt-from" hint="Earlier payments stay as they were."><input id="pt-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------
// Silver: what it could do for you
// ---------------------------------------------------------------------------------
function SilverInsights({ p }: { p: Property }) {
  const { state, today } = useStore();
  const ret = returnComparison(state, p, today);
  const room = borrowingRoom(state, p, today);
  const sale = roughSale(state, p, today);
  const max = Math.max(ret.yours ?? 0, ...ret.rows.map((r) => r.pct), 1);
  return (
    <div className="silver-grid">
      <section className="sheet">
        <h3>Your money is earning</h3>
        {ret.yours === null ? <p className="small soft">Add what is owed on the mortgage to see this.</p> : (
          <ul className="bars-h">
            <li className="you"><span>This property</span><i style={{ width: `${(Math.max(0, ret.yours) / max) * 100}%` }} /><strong>{ret.yours.toFixed(1)}%</strong></li>
            {ret.rows.map((r) => <li key={r.label}><span>{r.label}</span><i style={{ width: `${(r.pct / max) * 100}%` }} /><strong>{r.pct.toFixed(1)}%</strong></li>)}
          </ul>
        )}
        <p className="tiny soft">Rent left over and mortgage paid down in the last 12 months, divided by your money in it (worth less what is owed).</p>
        <ul className="tiny soft bench-sources">{ret.rows.map((r) => <li key={r.key}>{r.label} {r.pct}%: {r.source}, {fmtDate(r.asOf)}</li>)}</ul>
      </section>

      <section className="sheet">
        <h3>Room to borrow</h3>
        {room === null ? <p className="small soft">Add what is owed on the mortgage to see this.</p> : <>
          <div className="figure sm">{fmt0(room)}</div>
          <p className="small soft">About how much a lender might let you borrow against it ({LENDER_MAX_LTV}% of its worth, minus what you owe). A lender will value it themselves. Not an offer.</p>
        </>}
      </section>

      <section className="sheet">
        <h3>If you sold today</h3>
        {sale === null ? <p className="small soft">Add what is owed on the mortgage to see this.</p> : <>
          <div className="figure sm">{fmt0(sale.net)}</div>
          <p className="small soft">Worth {fmt0(sale.value)} − selling costs about {fmt0(sale.costs)} ({SELLING_COST_PCT}%) − mortgage {fmt0(sale.owed)}. Before tax. Gold works out the exact figure, with tax.</p>
        </>}
      </section>
    </div>
  );
}
