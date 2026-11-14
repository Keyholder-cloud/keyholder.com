import { useMemo, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { useStore } from '../data/store';
import { hasSpace } from '../lib/finance';
import { FindTenantTab, NoticesTab, UnitsTab } from './Rentals';
import type { Property } from '../data/types';
import { propertyLevel, atLeast } from '../lib/levels';
import { LevelInvite, LevelUpForm, PropertyCard } from '../components/levels';
import { daysBetween, fmtDate } from '../lib/dates';
import { adjustedCostBase, amortization, mortgageBalanceAt, mortgagePaidBetween, owedAt, ownEstimate, propertyValue } from '../lib/finance';
import { LENDER_MAX_LTV, SELLING_COST_PCT, borrowingRoom, gainSincePurchase, rentVsMarket, returnComparison, roughSale } from '../lib/silver';
import { fmt, fmt0 } from '../lib/money';
import { RentRoll } from '../components/domain';
import { MortgageForm, OwnerEstimateForm, PropertyForm } from '../components/forms';
import { Empty, Figure } from '../components/ui';
import { Icon } from '../components/Icon';

export function PropertyDetail() {
  const { id, tab = 'units' } = useParams();
  const { state, today } = useStore();
  const [edit, setEdit] = useState(false);
  const p = state.properties.find((x) => x.id === id);
  if (!p) return <div className="page"><Empty title="That property isn't here." action={<Link to="/rentals" className="btn">Back to Rentals</Link>} /></div>;
  const hasEmpty = state.units.some((u) => u.propertyId === p.id && hasSpace(state, u, today));
  const cur = tab === 'overview' ? 'units' : tab;
  const base = `/rent/property/${p.id}`;

  return (
    <div className="page">
      <Link to="/rentals" className="crumb"><Icon name="back" size={16} />Back to Rentals</Link>
      <h1 className="sr-only">{p.nickname}</h1>
      <div className="prop-head">
        <PropertyCard property={p} active banner />
        <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" size={16} />Edit details</button>
      </div>
      <nav className="tabs" aria-label="Property sections">
        <NavLink end to={base} className={cur === 'units' ? 'active' : ''}>Units and tenants</NavLink>
        {hasEmpty && <NavLink to={`${base}/find`}>Find a tenant</NavLink>}
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
      {cur === 'find' && <FindTenantTab propertyId={p.id} />}
      {cur === 'notices' && <NoticesTab propertyId={p.id} />}
      {cur === 'value' && <ValueTab id={p.id} />}
      {cur === 'mortgage' && (atLeast(propertyLevel(state, p), 'gold') ? <MortgageTab id={p.id} /> : (
        <LevelInvite property={p} to="gold" title="Track your mortgage" points={['See what you still owe and what you paid off this year', 'Get mortgage interest into your taxes', 'Full tax numbers with depreciation', 'Your gain if you sold']} />
      ))}
      {edit && <PropertyForm property={p} onClose={() => setEdit(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Value: what you paid, or your own estimate, less what is owed. Keyholder does not estimate home values.
// ---------------------------------------------------------------------------------
function ValueTab({ id }: { id: string }) {
  const { state, today, act } = useStore();
  const [form, setForm] = useState<'owner' | 'paid' | null>(null);
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
            <p className="soft" style={{ marginTop: 0 }}>Add what you paid and what is still owed. Keyholder shows the property's value as what you paid (or your own estimate, for example from an appraisal), less what is owed.</p>
            <div className="btn-row">
              <button className="btn primary" id="add-paid" onClick={() => setForm('paid')}><Icon name="plus" size={16} />Add what you paid</button>
              <button className="btn" id="add-own" onClick={() => setForm('owner')}><Icon name="edit" size={16} />Add my own estimate</button>
            </div>
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

      {p.purchasePrice && p.purchaseDate ? <SilverInsights p={p} /> : (
        <LevelInvite property={p} to="silver" title="See what this property is doing for you" points={['What it is worth to you, less what is owed', 'What your money earns compared with savings, a GIC and stocks', 'Whether your rent is below what similar units rent for', 'How much you could borrow against it', 'Roughly what you would walk away with if you sold']} />
      )}

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
  const p = state.properties.find((x) => x.id === id)!;
  const m = state.mortgages.find((x) => x.propertyId === id);
  const rows = useMemo(() => (m ? amortization(m) : []), [m]);
  const acb = adjustedCostBase(state, p);
  const value = propertyValue(state, p, today).value;
  const sellCost = Math.round(value * 0.05);
  const gain = value - sellCost - acb;
  const capex = state.expenses.filter((e) => e.propertyId === id && e.kind === 'capital');

  if (!m) {
    return (
      <>
        <div className="sheet"><Empty title="No mortgage added." action={<button className="btn primary" onClick={() => setEdit('new')}>Add mortgage</button>}>Paid off? You can skip this.</Empty></div>
        {edit && <MortgageForm propertyId={id} onClose={() => setEdit(null)} />}
      </>
    );
  }
  const bal = mortgageBalanceAt(m, today, rows);
  const ytd = mortgagePaidBetween(m, `${today.slice(0, 4)}-01-01`, today, rows);
  const daysToRenew = daysBetween(today, m.termEnd);
  const next = rows.find((r) => r.date > today);
  const upcoming = rows.filter((r) => r.date > today);

  return (
    <>
      {daysToRenew >= 0 && daysToRenew <= 120 && <div className="callout brass"><strong>Renews in {daysToRenew} days</strong> ({fmtDate(m.termEnd)}). A good time to compare rates.</div>}
      <div className="figures">
        <div><div className="label">Still owed</div><Figure cents={bal} size="sm" /></div>
        <div><div className="label">Interest this year</div><Figure cents={ytd.interest} size="sm" /></div>
        <div><div className="label">Paid off this year</div><Figure cents={ytd.principal} size="sm" className="in" /></div>
      </div>
      <div className="sheet" style={{ marginTop: 16 }}>
        <div className="spread">
          <div>
            {next && <p style={{ margin: 0 }}><strong>Next payment {fmtDate(next.date)}: {fmt(next.payment)}</strong></p>}
            <p className="small soft" style={{ margin: 0 }}>{m.lender} · {m.ratePct.toFixed(2)}% · renews {fmtDate(m.termEnd)}</p>
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
            <tbody>{upcoming.map((r) => (
              <tr key={r.n}><td className="date">{fmtDate(r.date)}</td><td className="num">{fmt(r.payment)}</td><td className="num">{fmt(r.interest)}</td><td className="num in">{fmt(r.principal)}</td><td className="num">{fmt(r.balance)}</td></tr>
            ))}</tbody>
          </table>
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
    </>
  );
}

// ---------------------------------------------------------------------------------
// Silver: what it could do for you
// ---------------------------------------------------------------------------------
function SilverInsights({ p }: { p: Property }) {
  const { state, today } = useStore();
  const ret = returnComparison(state, p, today);
  const units = state.units.filter((u) => u.propertyId === p.id);
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
        <h3>Rent compared with the area</h3>
        <ul className="rows">{units.map((u) => {
          const r = rentVsMarket(p, u);
          return (
            <li key={u.id} className="row" style={{ gridTemplateColumns: '64px 1fr auto' }}>
              <span className="margin">Unit {u.label}</span>
              <span><span className="title">{fmt0(u.rent)} now · about {fmt0(r.market)} nearby</span><span className="sub" style={{ display: 'block' }}>{u.bedrooms}-bedroom{r.fallback ? ' · Canada-wide average' : ''}</span></span>
              <span className={r.gap > 5000 ? 'in' : 'soft'}>{r.gap > 5000 ? `${fmt0(r.gap)} below` : r.gap < -5000 ? `${fmt0(-r.gap)} above` : 'About right'}</span>
            </li>
          );
        })}</ul>
        <p className="tiny soft">Many provinces limit rent increases. We suggest the allowed amount at renewal.</p>
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
