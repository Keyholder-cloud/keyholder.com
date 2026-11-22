import { createPortal } from 'react-dom';
import { PLAID_PRIVACY_URL } from './Security';
import { UploadStatementButton } from '../components/StatementUpload';
import { currentTaxYear, gapCount, recordsFromIn, yearCheck, type Gap } from '../lib/taxyear';
import { PageSub } from '../components/Guide';
import { useMemo, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import type { BankName, BankTxn, Expense, ExpenseCategory, Property } from '../data/types';
import { bankToSort, readWithdrawal } from '../lib/bankrules';
import { useStore } from '../data/store';
import { propertyLevel } from '../lib/levels';
import { addDays, addPeriods, fmtDate, fmtMonthShort, periodOf } from '../lib/dates';
import { picture, rentalPortion, taxPack } from '../lib/finance';
import { CATEGORIES, OTHER_BANKS, POPULAR_BANKS, category } from '../lib/jurisdiction';
import { banksOn, serverMode } from '../data/api';
import { connectWithPlaid } from '../data/plaid';
import * as sync from '../data/sync';
import { fmt, fmt0 } from '../lib/money';
import { ExpenseForm, MortgageForm } from '../components/forms';
import { Drawer, Empty, Field, Figure, Seg, Term, embedded } from '../components/ui';
import { Icon } from '../components/Icon';
import { CategoryIcon, SceneReceipts } from '../components/Art';

export function Money() {
  const { tab = 'expenses' } = useParams();
  const tabs = [{ id: 'expenses', label: 'Expenses' }, { id: 'cash-flow', label: 'Cash flow' }];
  const cur = tab === 'summary' || tab === 'picture' ? 'cash-flow' : tab;
  return (
    <div className="page">
      <div className="page-head"><h1>Money</h1></div>
      <nav className="tabs" aria-label="Money sections">
        {tabs.map((t) => <NavLink key={t.id} to={`/money/${t.id}`} className={cur === t.id ? 'active' : ''}>{t.label}</NavLink>)}
      </nav>
      {cur === 'cash-flow' ? <ThePicture /> : <Expenses />}
    </div>
  );
}

/** Taxes: its own tab. */
/**
 * A small bank button for Income and Expenses: "Link bank" to connect one (Plaid on the live site, the
 * simulation in the preview), or "Check bank" once one is connected. Nothing while bank checks are off.
 */
export function LinkBankButton() {
  const { state, act } = useStore();
  const [open, setOpen] = useState(false);
  if (!banksOn()) return null;
  const linked = (state.banks ?? []).some((b) => b.status === 'connected');
  return (
    <>
      {linked
        ? <button className="btn small link-bank" onClick={() => act.syncBank()}><Icon name="sync" size={16} />Check bank</button>
        : <button className="btn small link-bank" onClick={() => setOpen(true)}><Icon name="bank" size={16} />Link bank</button>}
      {open && (serverMode() ? <PlaidConnect onClose={() => setOpen(false)} /> : <ConnectBank onClose={() => setOpen(false)} />)}
    </>
  );
}

/** Expenses (its own page in the menu): every bill and receipt, and "Add an expense" with the camera. */
export function ExpensesPage() {
  const [adding, setAdding] = useState(false);
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="title-ic"><span className="tile-ic peach" aria-hidden><Icon name="receipt" size={22} /></span>Expenses</h1><PageSub>Bills and receipts, sorted for tax time</PageSub></div>
        <div className="btn-row"><LinkBankButton /><UploadStatementButton /><button className="btn primary add-expense" data-tour="add-expense" onClick={() => setAdding(true)}><Icon name="plus" size={18} />Add an expense</button></div></div>
      <Expenses />
      {adding && <ExpenseForm onClose={() => setAdding(false)} />}
    </div>
  );
}

// =====================================================================================
/** Withdrawals from connected banks, waiting to be sorted: expense (which property, which type) or mortgage. */
export function BankReview() {
  const { state, act, today } = useStore();
  const list = bankToSort(state);
  const [setup, setSetup] = useState<{ pid: string; txn: BankTxn } | null>(null);
  if (!list.length) return null;
  const props = state.properties.filter((p) => !p.archived);
  return (
    <section className="section" id="bank">
      <h2 className="section-title">From your banks · {list.length} to sort</h2>
      <div className="sheet tight"><ul className="unit-list">{list.map((t) => {
        const r = readWithdrawal(state, t);
        const bank = state.banks.find((b) => b.id === t.bankId)?.bank;
        return <BankRow key={t.id} t={t} r={r} bank={bank} props={props} onSetup={(pid) => setSetup({ pid, txn: t })} onFile={(pid, cat) => act.fileBankExpense(t.id, pid, cat, true)} onMortgage={(mid) => act.reconcileMortgage(t.id, mid)} onIgnore={() => act.ignoreTxn(t.id)} />;
      })}</ul></div>
      <p className="tiny soft" style={{ marginTop: 8 }}>Once you file a vendor, its future payments file themselves. Checked {today}.</p>
      {setup && <MortgageForm propertyId={setup.pid} prefill={{ lender: state.banks.find((b) => b.id === setup.txn.bankId)?.bank ?? setup.txn.payer.split(' ')[0], paymentOverride: -setup.txn.amount, frequency: 'monthly' }} onClose={() => setSetup(null)} />}
    </section>
  );
}

function BankRow({ t, r, bank, props, onFile, onMortgage, onSetup, onIgnore }: { t: BankTxn; r: ReturnType<typeof readWithdrawal>; bank?: string; props: Property[]; onFile: (pid: string, cat: ExpenseCategory) => void; onMortgage: (mid: string) => void; onSetup: (pid: string) => void; onIgnore: () => void }) {
  const [pid, setPid] = useState(r.propertyId ?? props[0]?.id ?? '');
  const [cat, setCat] = useState<ExpenseCategory>(r.category ?? 'other');
  const name = props.find((p) => p.id === r.propertyId)?.nickname;
  return (
    <li className="unit-row bank-row">
      <span className="unit-label long">{bank ?? 'Bank'}</span>
      <span className="unit-who"><strong>{fmt(-t.amount)} to {t.payer}</strong><span>{fmtDate(t.date)} · {r.kind === 'mortgage' ? (r.mortgageId ? `${r.why} (${name})` : r.why) : r.why}</span></span>
      {r.kind === 'expense' ? (
        <span className="bank-choose">
          <select className="input" aria-label="Property" value={pid} onChange={(e) => setPid(e.target.value)}>{props.map((p) => <option key={p.id} value={p.id}>{p.nickname}</option>)}</select>
          <select className="input" aria-label="Type" value={cat} onChange={(e) => setCat(e.target.value as ExpenseCategory)}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        </span>
      ) : <span />}
      <span className="row-act">
        {r.kind === 'expense' && <button className="btn primary" disabled={!pid} onClick={() => onFile(pid, cat)}>Add expense</button>}
        {r.kind === 'mortgage' && r.mortgageId && <button className="btn primary" onClick={() => onMortgage(r.mortgageId!)}>{r.matchesSchedule ? 'Tick off' : 'Tick off anyway'}</button>}
        {r.kind === 'mortgage' && !r.mortgageId && <button className="btn primary" disabled={!r.propertyId && !pid} onClick={() => onSetup(r.propertyId ?? pid)}>Set up mortgage</button>}
        <button className="btn ghost" title="Not a rental cost: Keyholder remembers this vendor" onClick={onIgnore}>Personal</button>
      </span>
    </li>
  );
}

export function Expenses() {
  const { state, today } = useStore();
  const [form, setForm] = useState<Expense | 'new' | null>(null);
  const [prop, setProp] = useState('all');
  const [kind, setKind] = useState<'all' | 'current' | 'capital'>('all');
  // Tax years: the current one first (active); the list shows that year only.
  const cur = currentTaxYear(today);
  const [year, setYear] = useState(cur);
  const years = taxYears(state, today);
  const list = state.expenses.filter((e) => e.date.startsWith(String(year)) && (prop === 'all' || e.propertyId === prop) && (kind === 'all' || e.kind === kind));
  const active = state.properties.filter((p) => !p.archived);
  const rcProp = active.find((p) => p.id === prop) ?? active[0];
  const total = list.reduce((a, e) => a + rentalPortion(e, state.properties.find((p) => p.id === e.propertyId)?.rentalSharePct ?? 100), 0);
  const months = new Map<string, Expense[]>();
  for (const e of list) { const k = periodOf(e.date); months.set(k, [...(months.get(k) ?? []), e]); }

  return (
    <>
      <nav className="tax-years" aria-label="Tax years" id="tax-years">{years.map((y) => {
        const tot = state.expenses.filter((e) => e.date.startsWith(String(y))).reduce((a, e) => a + e.amount, 0);
        const gaps = gapCount(state, y, today);
        return (
          <button key={y} className={`tax-year${y === year ? ' on' : ''}`} aria-pressed={y === year} onClick={() => setYear(y)}>
            <span className="ty-y">{y}{y === cur && <span className="ty-cur">Current</span>}</span>
            <span className="ty-t mono">{fmt(tot)}</span>
            <span className={`ty-g${gaps ? ' gap' : ''}`}>{gaps ? <><Icon name="alert" size={12} />{gaps} missing</> : <><Icon name="check" size={12} />Complete</>}</span>
          </button>
        );
      })}</nav>
      <BankReview />
      <div className="spread" style={{ marginBottom: 16 }}>
        <div className="btn-row">
          <select className="input" style={{ width: 'auto' }} value={prop} onChange={(e) => setProp(e.target.value)} aria-label="Property filter">
            <option value="all">All properties</option>
            {state.properties.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.nickname}</option>)}
          </select>
          {<Seg label="Kind" value={kind} onChange={setKind} options={[{ id: 'all', label: 'All' }, { id: 'current', label: 'Running costs' }, { id: 'capital', label: 'Improvements' }]} />}
        </div>
      </div>
      {list.length === 0 ? (
        <div className="sheet"><Empty title={`No expenses for ${year} yet.`} art={<SceneReceipts />} action={<button className="btn primary" onClick={() => setForm('new')}><Icon name="plus" size={16} />Add an expense</button>}>Add them one by one, or upload your bank statements for the year: Keyholder sorts every line.</Empty></div>
      ) : (
        <>
          <p className="small soft">{list.length} entries · <strong className="mono">{fmt(total)}</strong> counted toward the rental{state.properties.some((p) => p.rentalSharePct < 100) ? ' (after rental-share split)' : ''}</p>
          {[...months.entries()].map(([m, es]) => (
            <section className="section" key={m}>
              <h2 className="section-title">{fmtMonthShort(m)} {m.slice(0, 4)} <span className="mono">{fmt(es.reduce((a, e) => a + e.amount, 0))}</span></h2>
              <div className="sheet tight table-scroll"><table className="ledger">
                <tbody>{es.map((e) => {
                  const p = state.properties.find((x) => x.id === e.propertyId);
                  const portion = rentalPortion(e, p?.rentalSharePct ?? 100);
                  return (
                    <tr key={e.id} className="click" onClick={() => setForm(e)} tabIndex={0} onKeyDown={(k) => k.key === 'Enter' && setForm(e)}>
                      <td className="date">{fmtDate(e.date)}</td>
                      <td style={{ width: 48 }}>{e.receiptImage ? <img src={e.receiptImage} alt="" className="thumb" /> : e.cashNoReceipt ? <span className="tiny soft" title="Paid in cash, no receipt: this entry is the record">cash</span> : <span className="no-photo" title="No receipt photo yet" aria-label="No receipt photo"><Icon name="camera" size={14} /></span>}</td>
                      <td><span className="exp-cell"><CategoryIcon id={e.category} /><span><strong>{e.vendor || 'Unknown vendor'}</strong><span className="tiny soft" style={{ display: 'block' }}>{category(e.category).label} · {p?.nickname}{e.unitId ? ` · Unit ${state.units.find((u) => u.id === e.unitId)?.label}` : ''}{e.note ? ` · ${e.note}` : ''}</span></span></span></td>
                      <td>{e.kind === 'capital' && <span className="pill" style={{ borderColor: 'var(--brass)', color: 'var(--brass)' }}>Improvement</span>}{e.scope === 'personal' && <span className="pill">Personal</span>}</td>
                      <td className="num">{fmt(e.amount)}{portion !== e.amount && <div className="tiny soft">{fmt(portion)} rental</div>}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            </section>
          ))}
        </>
      )}
      {rcProp && <RegularCosts prop={rcProp} year={year} />}
      {form && <ExpenseForm expense={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
    </>
  );
}

/** Tax years to show on Expenses: the current one and back to the earliest records (at least last year), newest first. */
export function taxYears(state: ReturnType<typeof useStore>['state'], today: string): number[] {
  const cur = currentTaxYear(today);
  const first = Math.min(cur - 1, ...state.expenses.map((e) => Number(e.date.slice(0, 4))), ...state.payments.map((p) => Number(p.date.slice(0, 4))));
  const ys: number[] = [];
  for (let y = Math.max(cur + (today.slice(5) > '04-30' ? 0 : 1), cur); y >= Math.max(first, cur - 6); y--) ys.push(y);
  return ys;
}

// =====================================================================================
// How rent is tracked: two choices only — mark it yourself, or connect a bank (Plaid: new transactions as soon as the bank reports them).
// =====================================================================================
/** How rent is tracked (shown in Settings). */
/** Settings → Preferences → Rent tracking, on one line: mark it myself or check my bank; each bank as a chip. */
export function RentTracking() {
  const { state, act } = useStore();
  const [connect, setConnect] = useState(false);
  const [confirmManual, setConfirmManual] = useState(false);
  const banks = state.banks ?? [];
  const manual = banks.length === 0;
  const soon = !banksOn();
  // A bank that asks to sign in again (Plaid's window in "update" mode).
  const reconnect = (id: string) => { connectWithPlaid(id).then((r) => { if (r) { void sync.refresh(); act.say(`${r.bank} is connected again.`); } }, (e) => act.say((e as Error).message)); };
  return (
    <>
      <span className="seg-icons" role="radiogroup" aria-label="How rent is tracked">
        <button role="radio" id="rt-manual" aria-checked={manual} title="Tap Mark paid when rent comes in" onClick={() => !manual && setConfirmManual(true)}><Icon name="hand" size={15} />I mark it</button>
        <button role="radio" id="rt-bank" aria-checked={!manual} disabled={soon} title={soon ? 'Bank checks are coming soon' : 'Keyholder spots rent, bills and mortgage payments in your bank (view only)'} onClick={() => manual && setConnect(true)}>
          <Icon name="bank" size={15} />My bank{soon && <span className="soon-tag">{serverMode() ? 'Coming soon' : 'Not available right now'}</span>}
        </button>
      </span>
      {banks.map((b) => (
        <span key={b.id} className={`chip bank-chip${b.status === 'needs-reauth' ? ' warn' : ''}`} title={b.status === 'connected' ? `Last checked ${new Date(b.lastSync).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Needs you to sign in again'}>
          <Icon name="bank" size={14} />{b.bank}{b.accountMask ? ` ${b.accountMask}` : ''}
          {b.status === 'needs-reauth' && <button className="chip-btn" onClick={() => (serverMode() ? reconnect(b.id) : act.reauthBank(b.id))}>Sign in again</button>}
          <button className="chip-x" aria-label={`Disconnect ${b.bank}`} title="Disconnect" onClick={() => act.disconnectBank(b.id)}><Icon name="close" size={12} /></button>
        </span>
      ))}
      {!manual && <button className="chip" id="rt-check" title="Check every bank now" onClick={() => act.syncBank()}><Icon name="sync" size={14} />Check now</button>}
      {!manual && <button className="chip" id="rt-add" title="Add another bank (view only: Keyholder can never move money)" onClick={() => setConnect(true)}><Icon name="plus" size={14} />Add bank</button>}
      {connect && (serverMode() ? <PlaidConnect onClose={() => setConnect(false)} /> : <ConnectBank onClose={() => setConnect(false)} />)}
      {confirmManual && createPortal(
        <div className="acct-modal" role="alertdialog" aria-modal="true" aria-labelledby="rt-confirm-h">
          <div className="scrim" onClick={() => setConfirmManual(false)} />
          <div className="acct-modal-card rt-confirm" id="rt-confirm">
            <h2 id="rt-confirm-h"><Icon name="hand" size={20} />Mark rent yourself?</h2>
            <p>This <strong>disconnects {banks.map((b) => `${b.bank}${b.accountMask ? ` ${b.accountMask}` : ''}`).join(' and ')}</strong>. Keyholder stops seeing new deposits and bills there, and you tap Mark paid when rent comes in.</p>
            <p className="small soft">Rent, expenses and matches already made stay. You can connect your bank again any time.</p>
            <div className="btn-row">
              <button className="btn ghost" autoFocus onClick={() => setConfirmManual(false)}>Keep my bank</button>
              <button className="btn danger" id="rt-manual-confirm" onClick={() => { setConfirmManual(false); act.useManualTracking(); }}><Icon name="close" size={16} />Disconnect and mark it myself</button>
            </div>
          </div>
        </div>, document.body)}
    </>
  );
}

/** Live site: connect a bank through Plaid (the landlord signs in at their bank in Plaid's window). */
function PlaidConnect({ onClose }: { onClose: () => void }) {
  const { act } = useStore();
  const toast = act.say;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await connectWithPlaid();
      if (r) { await sync.refresh(); toast(`${r.bank} connected.${r.added ? ` ${r.added} transaction${r.added === 1 ? '' : 's'} read.` : ''} Keyholder spots rent as soon as it arrives.`); onClose(); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Drawer title="Connect your bank" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button id="plaid-go" className="btn primary" disabled={busy} onClick={go}>{busy ? 'Opening…' : 'Continue to your bank'}</button></>}>
      <p>Keyholder uses <strong>Plaid</strong> to see deposits and bills in your bank account: rent from tenants, and costs like insurance, utilities and mortgage payments.</p>
      <ul className="plain-list">
        <li><Icon name="lock" size={16} />You sign in at your bank, in Plaid's window. Keyholder never sees your password.</li>
        <li><Icon name="check" size={16} />View only: Keyholder can never move money.</li>
        <li><Icon name="bell" size={16} />New transactions arrive as soon as your bank reports them. Rent that clearly matches a tenant is marked paid.</li>
        <li><Icon name="close" size={16} />Disconnect any time in Settings.</li>
      </ul>
      <p className="small soft consent-line" id="plaid-consent">By choosing "Continue to your bank", you agree that Plaid may collect your bank data and share it with Keyholder, as described in <a href={PLAID_PRIVACY_URL} target="_blank" rel="noopener noreferrer">Plaid's End User Privacy Policy</a>, and that Keyholder uses it as described in <a href="#/welcome/security#bank" target="_blank" rel="noopener noreferrer">Security &amp; privacy</a>.</p>
      {err && <p className="small acct-error" role="alert">{err}</p>}
    </Drawer>
  );
}

function ConnectBank({ onClose }: { onClose: () => void }) {
  const { act } = useStore();
  const [bank, setBank] = useState<BankName | null>(null);
  const [q, setQ] = useState('');
  const [working, setWorking] = useState(false);
  const matches = q.trim() ? [...POPULAR_BANKS, ...OTHER_BANKS].filter((b) => b.toLowerCase().includes(q.trim().toLowerCase())) : [];
  const choice = (b: string) => (
    <button key={b} className="choice" aria-pressed={bank === b} onClick={() => setBank(b)}>
      <span className="t">{b}</span>
    </button>
  );
  if (working) return <Drawer title="Connecting" onClose={onClose}><Empty title={`Connecting to ${bank}…`}>This takes a few seconds.</Empty></Drawer>;
  return (
    <Drawer title="Which bank gets your rent?" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!bank} onClick={() => { setWorking(true); setTimeout(() => { act.connectBank(bank!); onClose(); }, 900); }}>{bank ? `Connect ${bank}` : 'Choose a bank'}</button></>}>
      <div className="choices">{POPULAR_BANKS.map(choice)}</div>
      <Field label="Somewhere else?" htmlFor="cb-q"><input id="cb-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type your bank or credit union" /></Field>
      {matches.length > 0 && <div className="choices">{matches.slice(0, 6).map(choice)}</div>}
      <div className="callout pine" style={{ marginTop: 16 }}>You sign in on your bank's page. We never see your password or move money.</div>
      <p className="tiny soft">Preview only: no real bank is contacted.</p>
    </Drawer>
  );
}

// =====================================================================================
// The picture — "See the math" (PRD 7.10)
// =====================================================================================
export function ThePicture() {
  const { state, today } = useStore();
  const [range, setRange] = useState<'month' | 'ytd' | 't12'>('t12');
  const [prop, setProp] = useState<string>('all');
  const from = range === 'month' ? `${periodOf(today)}-01` : range === 'ytd' ? `${today.slice(0, 4)}-01-01` : addDays(today, -364);
  const pic = useMemo(() => picture(state, from, today, { propertyId: prop === 'all' ? undefined : prop }), [state, from, today, prop]);
  const months = Array.from({ length: 12 }, (_, i) => addPeriods(periodOf(today), i - 11));
  const monthly = months.map((m) => {
    const end = m === periodOf(today) ? today : addDays(`${addPeriods(m, 1)}-01`, -1);
    return { m, p: picture(state, `${m}-01`, end, { propertyId: prop === 'all' ? undefined : prop }) };
  });
  const max = Math.max(1, ...monthly.map((x) => Math.max(x.p.rentCollected, x.p.opex + x.p.capital + x.p.mortgageInterest + x.p.mortgagePrincipal)));

  const row = (label: React.ReactNode, v: number, opts: { strong?: boolean; neg?: boolean; note?: string } = {}) => (
    <tr><td>{opts.strong ? <strong>{label}</strong> : label}{opts.note && <div className="tiny soft">{opts.note}</div>}</td><td className="num">{opts.neg && v ? '−' : ''}{opts.strong ? <strong>{fmt(Math.abs(v))}</strong> : fmt(Math.abs(v))}</td></tr>
  );

  return (
    <>
      <div className="btn-row" style={{ marginBottom: 16 }}>
        <Seg label="Range" value={range} onChange={setRange} options={[{ id: 'month', label: 'This month' }, { id: 'ytd', label: 'Year to date' }, { id: 't12', label: 'Last 12 months' }]} />
        <select className="input" style={{ width: 'auto' }} value={prop} onChange={(e) => setProp(e.target.value)} aria-label="Property">
          <option value="all">Whole portfolio</option>
          {state.properties.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.nickname}</option>)}
        </select>
      </div>
      <div className="figures four" style={{ marginBottom: 24 }}>
        <div><div className="label">Money in</div><Figure cents={pic.rentCollected} size="sm" className="in" /></div>
        <div><div className="label">Money out</div><Figure cents={pic.opex + pic.capital + pic.mortgageInterest + pic.mortgagePrincipal} size="sm" /></div>
        <div><div className="label">Left over</div><Figure cents={pic.kept} size="sm" className={pic.kept < 0 ? 'urgent' : ''} /></div>
        <div><div className="label">Left from each $1,000 of rent</div><span className="figure sm">{fmt0(Math.max(0, pic.keptPer1000) * 100)}</span></div>
      </div>
      <div className="split">
        <div className="sheet">
          <h2 style={{ marginBottom: 12 }}>Month by month</h2>
          <div className="bars" role="img" aria-label="Monthly rent in and money out, last 12 months">
            {monthly.map(({ m, p }) => {
              const out = p.opex + p.capital + p.mortgageInterest + p.mortgagePrincipal;
              return (
                <div key={m} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, alignItems: 'end', height: '100%' }} title={`${m}: in ${fmt(p.rentCollected)}, out ${fmt(out)}, kept ${fmt(p.kept)}`}>
                  <div className="bar" style={{ height: `${(p.rentCollected / max) * 100}%` }} />
                  <div className="bar out" style={{ height: `${(out / max) * 100}%` }} />
                </div>
              );
            })}
          </div>
          <div className="bar-labels">{monthly.map(({ m }) => <span key={m}>{fmtMonthShort(m)[0]}</span>)}</div>
          <div className="legend"><span><i style={{ background: 'var(--pine)' }} />Rent in</span><span><i style={{ background: 'var(--ink-soft)' }} />Money out</span></div>
          <details style={{ marginTop: 16 }}><summary className="small">Show as a table</summary>
            <table className="ledger"><thead><tr><th>Month</th><th className="num">In</th><th className="num">Out</th><th className="num">Kept</th></tr></thead>
              <tbody>{monthly.map(({ m, p }) => <tr key={m}><td>{fmtMonthShort(m)} {m.slice(0, 4)}</td><td className="num">{fmt(p.rentCollected)}</td><td className="num">{fmt(p.opex + p.capital + p.mortgageInterest + p.mortgagePrincipal)}</td><td className="num">{fmt(p.kept)}</td></tr>)}</tbody></table>
          </details>
        </div>
        <div className="sheet">
          <h2 style={{ marginBottom: 8 }}>How it adds up</h2>
          <table className="ledger"><tbody>
            {row('Rent collected', pic.rentCollected)}
            {pic.arrearsLoss > 0 && row('Rent still owing', pic.arrearsLoss, { note: 'Not counted above until it arrives' })}
            {pic.vacancyLoss > 0 && row('Lost to vacancy', pic.vacancyLoss)}
            {row('Running costs', pic.opex, { neg: true, note: 'Repairs, utilities, property tax, insurance' })}
            {row('Left before the mortgage', pic.noi, { strong: true })}
            {pic.hasMortgageData && !pic.mortgageIsRough && row('Mortgage interest', pic.mortgageInterest, { neg: true, note: 'Deductible' })}
            {pic.hasMortgageData && !pic.mortgageIsRough && row('Mortgage paid off', pic.mortgagePrincipal, { neg: true, note: 'This builds what you own' })}
            {pic.mortgageIsRough && row('Mortgage payments (rough)', pic.mortgageInterest + pic.mortgagePrincipal, { neg: true })}
            {pic.capital > 0 && row('Upgrades', pic.capital, { neg: true })}
            {row('Left over', pic.kept, { strong: true })}
          </tbody></table>
          <ul className="plain-facts">
            {pic.rentCollected > 0 && <li>Running costs take <strong>{pic.expenseRatio.toFixed(0)}%</strong> of the rent.</li>}
            {pic.hasMortgageData && !pic.mortgageIsRough && pic.mortgageInterest + pic.mortgagePrincipal > 0 && <li>Rent covers the mortgage <strong>{(pic.noi / (pic.mortgageInterest + pic.mortgagePrincipal)).toFixed(1)} times</strong>. Banks like to see 1.2 or more.</li>}
          </ul>
          {!pic.hasMortgageData && <p className="tiny soft" style={{ marginTop: 12 }}>No mortgage yet. Add it on the property's Mortgage tab.</p>}
        </div>
      </div>
    </>
  );
}


// =====================================================================================
// Regular costs landlords often forget, many of them paid in cash. One tap adds one, marked
// "paid in cash, no receipt" (the entry is the record), except driving, which needs a trip log.
const REGULAR: { label: string; cat: ExpenseCategory; how: string; cash: boolean }[] = [
  { label: 'Snow removal', cat: 'repairs', how: 'Each visit, or the season', cash: true },
  { label: 'Lawn care and yard work', cat: 'repairs', how: 'Mowing, leaves, weeding', cash: true },
  { label: 'Cleaning between tenants', cat: 'repairs', how: 'Move-out clean', cash: true },
  { label: 'Small repairs and handyman', cat: 'repairs', how: 'Fixed like for like', cash: true },
  { label: 'Pest control', cat: 'repairs', how: 'Visits and traps', cash: true },
  { label: 'Garbage and junk removal', cat: 'repairs', how: 'Dump runs, bulky pickup', cash: true },
  { label: 'Keys and lock changes', cat: 'repairs', how: 'New keys for a new tenant', cash: true },
  { label: 'Smoke alarm batteries and filters', cat: 'supplies', how: 'Batteries, furnace filters, bulbs', cash: true },
  { label: 'Stamps and printing', cat: 'office', how: 'Notices and letters', cash: true },
  { label: 'Driving to the property', cat: 'vehicle', how: 'Keep a trip log: date, km, why', cash: false },
  { label: 'Legal fees', cat: 'professional', how: 'Lawyer, paralegal, Landlord and Tenant Board filing', cash: false },
  { label: 'Management or admin fees', cat: 'management', how: 'Property manager, bookkeeping, admin help', cash: false },
  { label: 'Other', cat: 'other', how: 'Anything not in a category above', cash: false },
];

/**
 * Regular costs a landlord may be missing, for one property and year. Each one stays suggested until an expense
 * is added for it or it is ignored ("Other" is always there, for anything not in a category).
 */
export function RegularCosts({ prop, year }: { prop: Property; year: number }) {
  const { state, act, today } = useStore();
  const [add, setAdd] = useState<(typeof REGULAR)[number] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const mine = state.expenses.filter((e) => e.propertyId === prop.id && e.date.startsWith(String(year)));
  const key = (r: (typeof REGULAR)[number]) => `rc:${prop.id}:${year}:${r.label}`;
  const count = (r: (typeof REGULAR)[number]) => mine.filter((e) => e.category === r.cat && e.vendor.toLowerCase().startsWith(r.label.toLowerCase())).length;
  const ignored = (r: (typeof REGULAR)[number]) => !!state.todoPrefs?.[key(r)]?.ignored;
  const other = REGULAR.find((r) => r.cat === 'other')!;
  const list = REGULAR.filter((r) => r !== other);
  const pending = list.filter((r) => !count(r) && !ignored(r));
  const settled = list.filter((r) => count(r) || ignored(r));
  const row = (r: (typeof REGULAR)[number]) => {
    const n = count(r), off = ignored(r);
    return (
      <li key={r.label} className={off ? 'rc-ignored' : undefined}>
        <button className="rc-item" onClick={() => setAdd(r)}>
          <CategoryIcon id={r.cat} />
          <span><strong>{r.label}</strong><span className="tiny soft">{r.how}</span></span>
          <span className={`rc-n${n ? ' done' : ''}`}>{n ? <><Icon name="check" size={14} />{n}</> : off ? <span className="tiny">Ignored</span> : <Icon name="plus" size={16} />}</span>
        </button>
        {r !== other && !n && (
          <button className="rc-x" title={off ? 'Suggest it again' : 'Not for this property: stop suggesting it'} aria-label={off ? `Suggest ${r.label} again` : `Ignore ${r.label}`}
            onClick={() => act.setTodoPref(key(r), off ? {} : { ignored: true })}><Icon name={off ? 'sync' : 'close'} size={14} /></button>
        )}
      </li>
    );
  };
  return (
    <section className="sheet regular-costs" aria-labelledby="rc-title" id="regular-costs">
      <h2 id="rc-title" style={{ marginBottom: 4 }}>Regular costs you may be missing</h2>
      <p className="small soft" style={{ marginTop: 0 }}>{pending.length ? `${pending.length} to check for ${prop.nickname} in ${year}. Tap one to add it, or × if it does not apply.` : `All checked for ${prop.nickname} in ${year}.`} Paid in cash? It still counts if you keep a record.</p>
      <ul className="rc-list">{pending.map(row)}{row(other)}</ul>
      {settled.length > 0 && <button className="btn ghost small" onClick={() => setShowDone((x) => !x)}>{showDone ? 'Hide' : 'Show'} {settled.length} added or ignored</button>}
      {showDone && <ul className="rc-list">{settled.map(row)}</ul>}
      <p className="tiny soft" style={{ marginBottom: 0 }}>For each one, keep the date, who you paid, what for and how much: Keyholder saves that as your record. Not sure if something counts? Ask your accountant.</p>
      {add && <ExpenseForm onClose={() => setAdd(null)} prefill={{ propertyId: prop.id, vendor: add === other ? '' : add.label, category: add.cat, scope: category(add.cat).sharedByDefault ? 'shared' : 'direct', ...(add.cash ? { cashNoReceipt: true } : {}), ...(String(year) < today.slice(0, 4) ? { date: `${year}-12-31` } : {}) }} />}
    </section>
  );
}

/**
 * Close a tax year for a property (Paperwork → Taxes only): statements for every month from the records date,
 * rent, mortgage payments, property tax and insurance. Done: offer the year before.
 */
function CloseTheYear({ p, year, onYear }: { p: Property; year: number; onYear: (y: number) => void }) {
  const { state, act, today } = useStore();
  const c = yearCheck(state, p, year, today);
  const cur = currentTaxYear(today);
  const by = (k: Gap['kind']) => c.gaps.filter((g) => g.kind === k);
  const missing = c.months.filter((m) => !c.covered.includes(m) && by('statement').some((g) => g.month === m));
  const monthShort = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('en-CA', { month: 'short' });
  const steps: { id: string; title: string; done: boolean; body: React.ReactNode }[] = [
    { id: 'from', title: `Records kept from ${fmtDate(c.from)}`, done: true, body: <p className="tiny soft" style={{ margin: 0 }}>January 1 unless you started later: change it with "From" above.</p> },
    { id: 'statements', title: `Bank statements: ${c.covered.length} of ${c.months.length} month${c.months.length === 1 ? '' : 's'}`, done: !by('statement').length, body: <>
      {missing.length > 0 && <p className="close-months">{missing.map((m) => <span key={m} className="chip off">{monthShort(m)}</span>)}</p>}
      <p className="tiny soft" style={{ margin: '4px 0 8px' }}>Upload every month from {fmtDate(c.from)} to {year === cur ? 'today' : `December 31, ${year}`}, for each account rent goes into or bills come out of. Keyholder sorts every line: rent, mortgage, property tax, insurance and other costs.</p>
      <div className="btn-row"><UploadStatementButton className="btn small primary" label="Upload statements" /><LinkBankButton /></div>
    </> },
    { id: 'rent', title: `Rent: ${by('rent').length ? `${by('rent').length} not marked paid` : 'all marked paid'}`, done: !by('rent').length, body: null },
    { id: 'mortgage', title: `Mortgage payments: ${p.mortgageFree ? 'no mortgage' : !state.mortgages.some((m) => m.propertyId === p.id) ? 'add the mortgage first' : by('mortgage').length ? `${by('mortgage').length} month${by('mortgage').length === 1 ? '' : 's'} missing` : 'every month'}`, done: !by('mortgage').length, body: null },
    { id: 'tax', title: 'Property tax and insurance', done: !by('property-tax').length && !by('insurance').length, body: null },
  ];
  const gapsOf = (id: string): Gap[] => (id === 'rent' ? by('rent') : id === 'mortgage' ? by('mortgage') : id === 'tax' ? [...by('property-tax'), ...by('insurance')] : []);
  return (
    <section className="sheet close-year" id="close-year" aria-labelledby="cy-title">
      <div className="spread"><h2 id="cy-title" style={{ margin: 0 }}>Close {year} for {p.nickname}</h2>
        <span className={`chip ${c.done ? 'on' : ''}`}>{c.done ? <><Icon name="check" size={14} />Documented</> : `${c.gaps.length} missing`}</span></div>
      {!c.done && <p className="small soft" style={{ margin: '4px 0 12px' }}>{year === cur ? `Start with ${year}: your taxes are most accurate when every month has its statement, rent and payments.` : `Going back to ${year}: the same steps.`} Missing information may make your taxes inaccurate.</p>}
      <ol className="close-steps">{steps.map((st, i) => (
        <li key={st.id} className={st.done ? 'done' : ''}>
          <span className="cs-n" aria-hidden>{st.done ? <Icon name="check" size={14} /> : i + 1}</span>
          <div>
            <strong>{st.title}</strong>
            {st.body}
            {gapsOf(st.id).length > 0 && <ul className="close-gaps">{gapsOf(st.id).slice(0, 8).map((g) => (
              <li key={g.key}><Link to={g.to}>{g.text}</Link><button className="btn ghost small" title="Not needed: stop flagging it" onClick={() => act.setTodoPref(g.key, { ignored: true })}>Ignore</button></li>
            ))}{gapsOf(st.id).length > 8 && <li className="tiny soft">and {gapsOf(st.id).length - 8} more</li>}</ul>}
          </div>
        </li>
      ))}</ol>
      {c.ignored.length > 0 && <p className="tiny soft">{c.ignored.length} ignored · <button className="linkish" onClick={() => c.ignored.forEach((g) => act.setTodoPref(g.key, {}))}>Flag them again</button></p>}
      {c.done && (
        <div className="callout pine close-next" id="close-next"><Icon name="check" size={18} />
          <span><strong>{year} is documented for {p.nickname}.</strong> {year > cur - 6 ? `Would you like to go back to ${year - 1}? The same steps, with that year's statements.` : ''}</span>
          {year > cur - 6 && <button className="btn small" onClick={() => onYear(year - 1)}>Do {year - 1}</button>}
        </div>
      )}
    </section>
  );
}

// =====================================================================================
// Phase 3 — Tax Pack (T776)
// =====================================================================================
export function TaxPackPage() {
  const { state, act, today } = useStore();
  const props = state.properties.filter((p) => !p.archived);
  const [pid, setPid] = useState(props[0]?.id ?? '');
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentTaxYear(today));
  const p = props.find((x) => x.id === pid);
  // Started part way through the year? The spreadsheet covers from the first day with records (changeable).
  const [fromPick, setFromPick] = useState('');
  const yearStart = `${year}-01-01`, yearEnd = `${year}-12-31`;
  // The day records start for this property (saved with it): January 1 of the tax year unless set later.
  const from = (p && recordsFromIn(p, year)) ?? yearStart;
  void fromPick;
  // Only worth a note when records start more than a month into the year.
  const partYear = from >= `${year}-02-01`;
  const until = year === thisYear ? today : yearEnd;
  const pack = useMemo(() => (p ? taxPack(state, p, year, from) : null), [state, p, year, from]);
  if (!p || !pack) return <div className="sheet"><Empty title="Add a property to build a Tax Pack." /></div>;
  const fixes = pack.preflight.filter((x) => x.severity === 'fix').length;

  const exportCsv = () => {
    const units = new Set(state.units.filter((u) => u.propertyId === p.id).map((u) => u.id));
    const leases = state.leases.filter((l) => units.has(l.unitId));
    const rows: string[][] = [
      ['Keyholder tax spreadsheet', p.nickname],
      ['Covers', `${from} to ${until}`],
    ];
    if (partYear) rows.push(['Note', `Records in Keyholder start on ${from}. Rent and costs before that date are not included.`]);
    rows.push([], ['Line', 'Description', 'Amount']);
    rows.push(['8141', 'Gross rents', (pack.grossRents / 100).toFixed(2)]);
    for (const l of pack.lines) rows.push([l.t776, l.craLabel, (l.amount / 100).toFixed(2)]);
    rows.push(['9936', 'Capital cost allowance', (pack.ccaClaimed / 100).toFixed(2)]);
    rows.push(['', 'Net income', (pack.netIncome / 100).toFixed(2)]);
    rows.push([], ['Rent received'], ['Date', 'Tenant', 'For', 'Amount']);
    for (const pay of state.payments.filter((x) => !x.voided && leases.some((l) => l.id === x.leaseId) && x.date >= from && x.date <= yearEnd).sort((a, b) => a.date.localeCompare(b.date))) {
      const t = state.tenants.find((x) => x.id === leases.find((l) => l.id === pay.leaseId)?.tenantId);
      rows.push([pay.date, t?.names.join(' & ') ?? '', pay.period, (pay.amount / 100).toFixed(2)]);
    }
    rows.push([], ['Costs'], ['Date', 'Paid to', 'Category', 'T776 line', 'Kind', 'Amount', 'Rental portion', 'Record']);
    for (const e of state.expenses.filter((x) => x.propertyId === p.id && x.date >= from && x.date <= yearEnd).sort((a, b) => a.date.localeCompare(b.date))) {
      const c = category(e.category);
      rows.push([e.date, e.vendor, c.label, c.t776, e.kind, (e.amount / 100).toFixed(2), (rentalPortion(e, p.rentalSharePct) / 100).toFixed(2),
        e.receiptImage ? 'Receipt photo' : e.cashNoReceipt ? 'Paid in cash, no receipt (this entry is the record)' : 'No receipt yet']);
    }
    const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `keyholder-tax-${p.nickname.replace(/\W+/g, '-')}-${from}-to-${until}.csv`; a.click();
  };

  const fixList = pack.preflight;
  return (
    <>
      <div className="spread" style={{ marginBottom: 16 }}>
        <div className="btn-row">
          {props.length > 1 && <select className="input" style={{ width: 'auto' }} value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Property">{props.map((x) => <option key={x.id} value={x.id}>{x.nickname}</option>)}</select>}
          <Seg label="Tax year" value={year} onChange={setYear} options={taxYears(state, today).slice(0, 4).reverse().map((y) => ({ id: y, label: y === thisYear ? `${y} so far` : String(y) }))} />
        </div>
        <div className="btn-row tax-tools">
          <label className="tax-from" htmlFor="tax-from" title="The day you start keeping this property's money in Keyholder. January 1 unless you started later.">From<input id="tax-from" type="date" className="input" value={from} min={yearStart} max={yearEnd} onChange={(e) => { setFromPick(e.target.value); act.setRecordsFrom(p.id, !e.target.value || e.target.value <= yearStart ? undefined : e.target.value); }} /></label>
          <button className="btn" onClick={exportCsv} disabled={embedded} title={embedded ? 'Downloads work on the Keyholder website' : undefined}><Icon name="download" size={16} />Spreadsheet</button>
          {!embedded && <button className="btn primary" onClick={() => window.print()}><Icon name="print" size={16} />Print for accountant</button>}
        </div>
      </div>
      {partYear && (
        <div className="callout tax-start" role="note">
          <Icon name="calendar" size={18} />
          <p><strong>Started part way through the year? That's fine.</strong> Your spreadsheet starts on {fmtDate(from)}{year === thisYear ? '' : ` and ends ${fmtDate(until)}`}, the day your records start. Costs from before then count too: add them any time with their real date{fromPick ? '' : ', and the start moves back'}.</p>
        </div>
      )}

      <CloseTheYear p={p} year={year} onYear={setYear} />

      <div className="sheet">
        <h2 style={{ marginBottom: 8 }}>{fixes ? `${fixes} thing${fixes > 1 ? 's' : ''} to fix` : fixList.length ? 'Almost ready' : 'Ready for your accountant'}</h2>
        {fixList.length === 0 ? <p className="soft" style={{ margin: 0 }}>Nothing missing.</p> : (
          <ul className="rows">{fixList.map((x) => (
            <li key={x.id} className="row" style={{ gridTemplateColumns: '32px 1fr' }}>
              <span className={x.severity === 'fix' ? 'urgent' : 'soft'}><Icon name={x.severity === 'fix' ? 'alert' : 'info'} size={20} /></span>
              <span>{x.text}</span>
            </li>
          ))}</ul>
        )}
        {fixes > 0 && <Link to="/expenses" className="btn" style={{ marginTop: 12 }}>Go to expenses</Link>}
      </div>

      <RegularCosts prop={p} year={year} />

      <div className="sheet print-me">
        <h2 style={{ marginBottom: 4 }}>{year} rental income · {p.nickname}</h2>
        {partYear && <p className="small" style={{ margin: '0 0 4px' }}>From {fmtDate(from)} (when your records start)</p>}
        <p className="small soft" style={{ marginTop: 0 }}>Line numbers match CRA form T776.</p>
        <table className="ledger tax-totals">
          <tbody>
            <tr><td>Rent received</td><td className="line">8141</td><td className="num">{fmt(pack.grossRents)}</td></tr>
            <tr><td>Expenses</td><td className="line" /><td className="num">−{fmt(pack.totalExpenses)}</td></tr>
            {propertyLevel(state, p) === 'gold' && <tr><td><Term def="Capital Cost Allowance: a yearly deduction for wear on the building and appliances">Depreciation (CCA)</Term>{!p.claimCCA && <span className="tiny soft"> · not claimed</span>}</td><td className="line">9936</td><td className="num">−{fmt(pack.ccaClaimed)}</td></tr>}
          </tbody>
          <tfoot><tr><td>Taxable rental income{p.ownershipPct < 100 && <span className="tiny soft"> · your {p.ownershipPct}%: {fmt(pack.ownerShare)}</span>}</td><td className="line" /><td className={`num ${pack.netIncome < 0 ? 'urgent' : ''}`}>{fmt(pack.netIncome)}</td></tr></tfoot>
        </table>

        <details className="more" open={false}>
          <summary>Expenses by type</summary>
          <div className="more-body">
            <table className="ledger tax-totals"><tbody>
              {pack.lines.map((l) => <tr key={l.t776}><td>{l.label}</td><td className="line">{l.t776}</td><td className="num">{fmt(l.amount)}</td></tr>)}
            </tbody></table>
            {p.rentalSharePct < 100 && <p className="tiny soft">Shared costs counted at {p.rentalSharePct}%, the part you rent out.</p>}
          </div>
        </details>

        {pack.cca.length > 0 && propertyLevel(state, p) === 'gold' && (
          <details className="more">
            <summary>Depreciation details</summary>
            <div className="more-body table-scroll">
              <table className="ledger">
                <thead><tr><th>Class</th><th className="num">Start of year</th><th className="num">Added</th><th className="num">Rate</th><th className="num">Claimed</th><th className="num">End of year</th></tr></thead>
                <tbody>{pack.cca.map((r) => <tr key={r.cls}><td>{r.label}</td><td className="num">{fmt(r.opening)}</td><td className="num">{fmt(r.additions)}</td><td className="num">{r.ratePct}%</td><td className="num">{fmt(r.claimed)}</td><td className="num">{fmt(r.closing)}</td></tr>)}</tbody>
              </table>
              <p className="tiny soft">Half rate in the year you buy. It can't create a loss, and some may be paid back when you sell.</p>
            </div>
          </details>
        )}
        {propertyLevel(state, p) !== 'gold' && <p className="small" style={{ marginTop: 16 }}><strong>Missing mortgage interest and depreciation.</strong> <Link to={`/rent/property/${p.id}/mortgage`}>Reach Gold for {p.nickname}</Link> to include them. They usually lower your tax.</p>}
        <p className="tiny soft" style={{ marginTop: 16 }}>We prepare the numbers. We don't file returns or give tax advice.</p>
      </div>
    </>
  );
}
