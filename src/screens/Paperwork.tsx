import { BackToMore, PageSub } from '../components/Guide';
import { OfficialPdfButton } from '../components/OfficialForm';
import { useState } from 'react';
import { Link, Navigate, NavLink, useLocation, useParams } from 'react-router-dom';
import { VisitNotices } from '../components/VisitNotice';
import type { IncomeKind, Lease, Message, Province, Receipt } from '../data/types';
import { AUTHORITY_URL, SITUATIONS, formsFor } from '../lib/forms';
import { FormWizard, SituationPicker } from '../components/FormWizard';
import { useStore } from '../data/store';
import { addDays, addMonths, fmtDate, fmtPeriod, fmtTime } from '../lib/dates';
import { PROVINCES, province } from '../lib/jurisdiction';
import { LinkBankButton, TaxPackPage } from './Money';
import { MarkRentPaid, OtherIncomeForm } from '../components/forms';
import { incomeKindLabel } from '../lib/receiptData';
import { fmt } from '../lib/money';
import { messageBody } from '../lib/templates';
import { Letterhead, ReceiptLetter } from '../components/domain';
import { Drawer, Empty, Seg, Stamp, embedded } from '../components/ui';
import { Icon } from '../components/Icon';
import { paidUpRent } from '../lib/finance';
import { ResendReceipt, useMore } from '../components/More';
import { SceneTap, SceneWelcome } from '../components/Art';

export function Paperwork() {
  const { tab = 'leases' } = useParams();
  const loc = useLocation();
  const tabs = [{ id: 'leases', label: 'Leases' }, { id: 'notices', label: 'Notices and letters' }, { id: 'forms', label: 'Forms' }, { id: 'taxes', label: 'Taxes' }];
  // Income and expenses have their own pages now; old links still land there.
  if (tab === 'expenses') return <Navigate to="/expenses" replace />;
  if (tab === 'income' || tab === 'receipts') return <Navigate to="/income" replace />;
  const cur = tab === 'letters' || tab === 'log' ? 'notices' : tabs.some((t) => t.id === tab) ? tab : 'leases';
  return (
    <div className="page">
      <BackToMore /><div className="page-head"><div><h1 className="title-ic"><span className="tile-ic peach" aria-hidden><Icon name="paper" size={22} /></span>Paperwork</h1><PageSub>Leases, notices, forms and taxes</PageSub></div></div>
      <nav className="tabs" aria-label="Paperwork sections">{tabs.map((t) => <NavLink key={t.id} to={`/paperwork/${t.id}`} className={cur === t.id ? 'active' : ''}>{t.label}</NavLink>)}</nav>
      {cur === 'leases' && <Leases />}
      {cur === 'forms' && <FormsLibrary />}
      {cur === 'taxes' && <><p className="soft" style={{ marginTop: 0 }}>Your year's rent and costs, ready for your tax return (T776).</p><TaxPackPage /></>}
      {cur === 'notices' && <><VisitNotices openFor={new URLSearchParams(loc.search).get('visit') ?? undefined} key={loc.search} /><NoticesLog /><section className="section"><h2 className="section-title">Receipts and reminders sent</h2><Letters /></section><section className="section"><h2 className="section-title">History of changes</h2><Log /></section></>}
    </div>
  );
}

/** Income (its own page in the menu): every rent payment received, with its receipt. */
export function IncomePage() {
  const { state } = useStore();
  const [pay, setPay] = useState(false);
  const [other, setOther] = useState(false);
  const live = state.leases.some((l) => !l.end || l.end >= new Date().toISOString().slice(0, 10));
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="title-ic"><span className="tile-ic mint" aria-hidden><Icon name="cash" size={22} /></span>Income</h1><PageSub>Rent and other money in, with a receipt for each payment</PageSub></div>
        <div className="btn-row income-actions"><LinkBankButton /><button className="btn" id="income-other" onClick={() => setOther(true)}><Icon name="plus" size={18} />Add other income</button>{live && <button className="btn primary" id="income-mark-paid" onClick={() => setPay(true)}><Icon name="cash" size={18} />Mark rent paid</button>}</div></div>
      <Income />
      {pay && <MarkRentPaid onClose={() => setPay(false)} />}
      {other && <OtherIncomeForm onClose={() => setOther(false)} />}
    </div>
  );
}

/** Rental income log: rent and other money in (bill shares, parking…), each with its receipt. */
type IncomeRow = { id: string; date: string; kind: 'rent' | IncomeKind; who: string; unit: string; forText: string; amount: number; receipt?: Receipt; incomeId?: string; propertyId?: string; paidUp?: { leaseId: string; period: string } };
function Income() {
  const { state, act, today } = useStore();
  const [open, setOpen] = useState<Receipt | null>(null);
  const [prop, setProp] = useState('all');
  const [type, setType] = useState<'all' | 'rent' | 'other'>('all');
  const others = (state.income ?? []).filter((i) => !i.voided);
  const place = (leaseId?: string, propertyId?: string) => {
    const l = state.leases.find((x) => x.id === leaseId); const u = state.units.find((x) => x.id === l?.unitId); const pr = state.properties.find((x) => x.id === (u?.propertyId ?? propertyId));
    return { who: state.tenants.find((x) => x.id === l?.tenantId)?.names.join(' & ') ?? '—', unit: pr ? `${pr.nickname.split(' ')[0]}${u ? ` · ${l?.room ?? u.label}` : ''}` : '—', propertyId: pr?.id };
  };
  const all: IncomeRow[] = [
    ...state.payments.filter((p) => !p.voided).map((p) => ({ id: p.id, date: p.date, kind: 'rent' as const, forText: fmtPeriod(p.period), amount: p.amount, receipt: state.receipts.find((x) => x.paymentId === p.id && x.status !== 'superseded'), ...place(p.leaseId) })),
    // Months marked as paid up (paid before Keyholder): rent received on the due date, a receipt on request.
    ...state.leases.flatMap((l) => paidUpRent(state, l, '1900-01-01', today).map((r) => ({ id: `pu-${l.id}-${r.period}`, date: r.date, kind: 'rent' as const, forText: `${fmtPeriod(r.period)} · marked paid up`, amount: r.amount, paidUp: { leaseId: l.id, period: r.period }, ...place(l.id) }))),
    ...others.map((i) => ({ id: i.id, date: i.date, kind: i.kind, forText: i.label, amount: i.amount, incomeId: i.id, receipt: state.receipts.find((x) => x.incomeId === i.id && x.status !== 'superseded'), ...place(i.leaseId, i.propertyId) })),
  ];
  const years = [...new Set(all.map((r) => r.date.slice(0, 4)))].sort().reverse();
  const [pickedYear, setYear] = useState('');
  const year = years.includes(pickedYear) ? pickedYear : years[0] ?? '';
  const rows = all.filter((r) => r.date.startsWith(year) && (prop === 'all' || r.propertyId === prop) && (type === 'all' || (type === 'rent') === (r.kind === 'rent')))
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const [shownRows, more] = useMore(rows);
  if (!all.length) return <div className="sheet"><Empty title="No income yet." art={<SceneTap />}>Every payment, marked by you or found by the bank.</Empty></div>;
  return (
    <>
      <div className="btn-row" style={{ marginBottom: 16 }}>
        <select className="input" style={{ width: 'auto' }} value={prop} onChange={(e) => setProp(e.target.value)} aria-label="Property"><option value="all">All properties</option>{state.properties.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.nickname}</option>)}</select>
        <select className="input" style={{ width: 'auto' }} value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">{years.map((y) => <option key={y}>{y}</option>)}</select>
        {others.length > 0 && <Seg label="Type" value={type} onChange={setType} options={[{ id: 'all', label: 'All' }, { id: 'rent', label: 'Rent' }, { id: 'other', label: 'Other income' }]} />}
        <span className="soft">{rows.length} payments · <strong className="mono">{fmt(total)}</strong></span>
      </div>
      <div className="sheet tight table-scroll"><table className="ledger stack">
        <thead><tr><th>Received</th><th>From</th><th>Unit</th><th>For</th><th className="num">Amount</th><th>Receipt</th></tr></thead>
        <tbody>{shownRows.map((r) => (
          <tr key={r.id} className={r.kind === 'rent' ? undefined : 'other-income'}>
            <td className="date" data-label="Received">{fmtDate(r.date)}</td><td className="st-title" data-label="From">{r.who}</td><td data-label="Unit">{r.unit}</td>
            <td data-label="For">{r.kind !== 'rent' && <span className={`inc-tag ${r.kind}`}>{incomeKindLabel(r.kind)}</span>}{r.forText}</td><td className="num in" data-label="Amount">{fmt(r.amount)}</td>
            <td className="st-actions" data-label="Receipt"><span className="rc-acts">{r.receipt ? <><button className="btn small ghost" title={`Receipt #${r.receipt.number}`} aria-label={`View receipt #${r.receipt.number}`} onClick={() => setOpen(r.receipt!)}><Icon name="receipt" size={16} />View</button><ResendReceipt receiptId={r.receipt.id} label={r.receipt.status === 'draft' ? 'Send' : 'Resend'} /></>
              : r.paidUp ? <button className="btn small" id={`pu-send-${r.id}`} title="Record this month and send the tenant a receipt" onClick={() => act.sendPaidUpReceipt(r.paidUp!.leaseId, r.paidUp!.period, r.amount, r.date)}><Icon name="send" size={14} />Send receipt</button>
              : r.incomeId ? <span className="small soft">No tenant</span> : '—'}
              {r.incomeId && <button className="btn small ghost icon-only" title="Remove this income" aria-label="Remove this income" onClick={() => { if (window.confirm('Remove this income? Its receipt is cancelled.')) act.voidIncome(r.incomeId!); }}><Icon name="trash" size={14} /></button>}</span></td>
          </tr>
        ))}</tbody>
      </table>{more}</div>
      {open && <Drawer title={`Receipt #${open.number}`} onClose={() => setOpen(null)} wide footer={embedded ? undefined : <button className="btn" onClick={() => window.print()}><Icon name="print" size={16} />Print or save PDF</button>}><ReceiptLetter receipt={open} /></Drawer>}
    </>
  );
}

/** Notices served, with proof of service. */
function NoticesLog() {
  const { state, act, today } = useStore();
  const ns = [...state.notices].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [nsShown, nsMore] = useMore(ns);
  return (
    <section className="section">
      <h2 className="section-title">Notices</h2>
      <div className="sheet">
        {ns.length === 0 ? <p className="soft" style={{ margin: 0 }}>No notices yet. Prepare one from a tenant's page.</p> : (
          <><ul className="rows">{nsShown.map((n) => {
            const t = state.tenants.find((x) => x.id === n.tenantId);
            return <li key={n.id} className="row"><span className="margin">{n.servedOn ? fmtDate(n.servedOn) : '—'}</span><span><span className="title">{n.kind} · {t?.names.join(' & ')}</span><span className="sub" style={{ display: 'block' }}>{n.arrears ? `${fmt(n.arrears)} · ` : ''}{n.status === 'sent' ? `prepared by ${n.servedBy}${n.emailedAt ? ', emailed to the tenant' : ''} · waiting for signatures` : n.status === 'signed' && n.official ? `signed${n.tenantSignedOn ? ` ${fmtDate(n.tenantSignedOn)}` : ''} · keep the signed copy` : n.status === 'signed' ? `details recorded by ${n.servedBy} · not sent to the tenant, not signed` : `delivered ${n.serveMethod} by ${n.servedBy}`}{n.emailedAt && n.status !== 'sent' && !(n.status === 'signed' && n.official) ? ' · emailed' : ''}{n.terminationDate ? ` · ${n.arrears ? 'pay by' : 'ends'} ${fmtDate(n.terminationDate)}` : ''}</span></span><span className="row-act">{n.status === 'sent' && <button className="btn small primary" id={`lease-signed-${n.id}`} onClick={() => act.markLeaseSigned(n.id, today)}><Icon name="check" size={14} />Mark signed by tenant</button>}<OfficialPdfButton notice={n} /><Stamp kind={n.status === 'voided-by-payment' ? 'superseded' : (n.status === 'signed' && !n.official) || n.status === 'sent' ? 'draft' : 'served'}>{({ served: 'Served', 'voided-by-payment': 'Paid', filed: 'Ready', signed: n.official ? 'Signed' : 'Recorded', sent: 'To sign' } as Record<string, string>)[n.status]}</Stamp></span></li>;
          })}</ul>{nsMore}</>
        )}
      </div>
    </section>
  );
}

function Letters() {
  const { state, today } = useStore();
  const [open, setOpen] = useState<Message | null>(null);
  const ms = state.messages.filter((m) => m.status === 'sent').sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
  const [msShown, msMore] = useMore(ms);
  if (!ms.length) return <div className="sheet"><Empty title="Nothing sent yet." art={<SceneTap />}>Every receipt and reminder, exactly as sent.</Empty></div>;
  return (
    <>
      <div className="sheet"><ul className="rows">{msShown.map((m) => {
        const t = state.tenants.find((x) => x.id === m.tenantId);
        return (
          <li key={m.id} className="row link" onClick={() => setOpen(m)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(m)}>
            <span className="margin">{fmtDate(m.sentAt!.slice(0, 10))}</span>
            <span><span className="title">{messageBody(state, m, today).subject}</span><span className="sub" style={{ display: 'block' }}>To {t?.names.join(' & ')} · {fmtTime(m.sentAt!)}</span></span>
            <span className="row-act">{m.kind === 'receipt' && m.receiptId && <ResendReceipt receiptId={m.receiptId} />}<Stamp kind="sent">{m.kind}</Stamp></span>
          </li>
        );
      })}</ul>{msMore}</div>
      {open && (
        <Drawer title="Letter" onClose={() => setOpen(null)} wide>
          <div className="letter"><Letterhead state={state} /><p><strong>{messageBody(state, open, today).subject}</strong></p><div className="body">{messageBody(state, open, today).body}</div></div>
          <p className="letter-foot">Sent {fmtDate(open.sentAt!.slice(0, 10))} at {fmtTime(open.sentAt!)}{open.edited ? ' · edited before sending' : ''}</p>
        </Drawer>
      )}
    </>
  );
}

/** 12-month rule: rent can rise once every 12 months, with 90 days' written notice (N1 in Ontario). */
function nextIncrease(start: string, prov: string, today: string) {
  let next = addMonths(start, 12);
  while (next < today) next = addMonths(next, 12);
  return { date: next, pct: province(prov as never).rentIncreaseGuidelinePct, noticeBy: addDays(next, -90) };
}

function Leases() {
  const { state, today } = useStore();
  const [inc, setInc] = useState<Lease | null>(null);
  if (!state.leases.length) return <div className="sheet"><Empty title="No leases yet." art={<SceneWelcome />}>Add a tenant to start a lease record.</Empty></div>;
  return (
    <>
    <div className="sheet tight table-scroll"><table className="ledger stack leases-table">
      <thead><tr><th>Tenant</th><th>Unit</th><th>Ends</th><th className="num">Rent</th><th className="num" title="Last month's rent deposit">Deposit</th><th title="Notices by email">Email</th><th>Next increase</th><th /></tr></thead>
      <tbody>{state.leases.map((l) => {
        const t = state.tenants.find((x) => x.id === l.tenantId); const u = state.units.find((x) => x.id === l.unitId); const p = state.properties.find((x) => x.id === u?.propertyId);
        const n = l.end ? null : nextIncrease(l.start, p?.province ?? 'ON', today);
        return (
          <tr key={l.id}>
            <td className="st-title" data-label="Tenant"><Link to={`/rent/tenant/${t?.id}`}>{t?.names.join(' & ')}</Link></td>
            <td data-label="Unit">{p?.nickname.split(' ')[0]} · {u?.label}</td>
            <td className="date" data-label="Ends">{l.end ? fmtDate(l.end) : 'Monthly'}</td>
            <td className="num" data-label="Rent">{fmt(l.rent)}</td>
            <td className="num" data-label="Deposit">{l.lmrDeposit ? fmt(l.lmrDeposit) : '—'}</td>
            <td data-label="Email">{l.emailNoticeConsent ? <Icon name="check" size={16} /> : <span className="soft">Paper</span>}</td>
            <td className="date" data-label="Next increase" title={n ? `Give notice by ${fmtDate(n.noticeBy)}` : undefined}>{n ? <span className="inc-next">{fmtDate(n.date)} <span className="inc-up"><span aria-hidden>↑</span>{n.pct ? `${n.pct}%` : ''}</span></span> : '—'}</td>
            <td className="st-actions">{n && <button className="btn small" onClick={() => setInc(l)}>Raise rent</button>}</td>
          </tr>
        );
      })}</tbody>
    </table></div>
    {inc && <SituationPicker lease={inc} only="rent-increase" onClose={() => setInc(null)} />}
    </>
  );
}

function Log() {
  const { state } = useStore();
  return (
    <div className="sheet">
      <p className="small soft">Every change, in order. It can't be edited.</p>
      <ul className="rows">{state.audit.slice(0, 150).map((a) => (
        <li key={a.id} className="row"><span className="margin">{fmtDate(a.at.slice(0, 10))}<br />{fmtTime(a.at)}</span><span><span className="title">{a.action}</span><span className="sub" style={{ display: 'block' }}>{a.detail}</span></span><span /></li>
      ))}</ul>
    </div>
  );
}

/** Forms library: every situation and its form, for any province. Prepare works for your own properties. */
function FormsLibrary() {
  const { state, today } = useStore();
  const props = state.properties.filter((p) => !p.archived);
  const [prov, setProv] = useState<Province>(props[0]?.province ?? state.profile.province);
  const [pick, setPick] = useState<{ lease: Lease; formId: string } | null>(null);
  const [choose, setChoose] = useState<string | null>(null);
  const leases = state.leases.filter((l) => {
    const pr = state.properties.find((x) => x.id === state.units.find((u) => u.id === l.unitId)?.propertyId);
    return pr && !pr.archived && pr.province === prov && (!l.end || l.end >= today);
  });
  const info = province(prov);
  const own = new Set(props.map((p) => p.province));
  return (
    <>
      <div className="spread" style={{ marginBottom: 16 }}>
        <label className="btn-row"><span className="small">Show forms for</span>
          <select className="input" style={{ width: 'auto' }} value={prov} onChange={(e) => setProv(e.target.value as Province)} aria-label="Province">
            {PROVINCES.map((x) => <option key={x.code} value={x.code}>{x.name}{own.has(x.code) ? ' (your properties)' : ''}</option>)}
          </select>
        </label>
        <span className="small soft">{info.tribunal} · <a href={AUTHORITY_URL[prov]} target="_blank" rel="noopener noreferrer">official site</a></span>
      </div>
      {!leases.length && <div className="callout">You have no tenants in {info.name}, so these forms are for reading. Prepare is available for provinces where you have a rental.</div>}
      {SITUATIONS.map((s) => (
        <section key={s.id} className="section">
          <h2 className="section-title">{s.label}</h2>
          <div className="sheet tight"><ul className="unit-list">{formsFor(prov, s.id).map((f) => (
            <li key={f.id} className="unit-row form-row">
              <span className="form-code">{f.code}</span>
              <span className="unit-who"><strong>{f.title}</strong><span>{f.plain}</span></span>
              <span className="unit-state"><span className={`status ${f.official ? 'paid' : 'vacant'}`}>{f.official ? 'Official form' : 'Template'}</span></span>
              {leases.length ? <button className="btn" onClick={() => (leases.length === 1 ? setPick({ lease: leases[0], formId: f.id }) : setChoose(f.id))}>Prepare</button> : <span />}
            </li>
          ))}</ul></div>
        </section>
      ))}
      {choose && (
        <Drawer title="For which tenant?" onClose={() => setChoose(null)}>
          <div className="stack">{leases.map((l) => { const t = state.tenants.find((x) => x.id === l.tenantId); const u = state.units.find((x) => x.id === l.unitId); const pr = state.properties.find((x) => x.id === u?.propertyId); return <button key={l.id} className="choice" onClick={() => { setPick({ lease: l, formId: choose }); setChoose(null); }}><span className="t">{t?.names.join(' & ')}</span><span className="s">{pr?.nickname} · Unit {u?.label}</span></button>; })}</div>
        </Drawer>
      )}
      {pick && <FormWizard lease={pick.lease} formId={pick.formId} onClose={() => setPick(null)} />}
    </>
  );
}
