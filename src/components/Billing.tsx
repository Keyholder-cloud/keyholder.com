import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../data/store';
import { api, paidPlan, serverMode, setUser, useConn } from '../data/api';
import type { AppState } from '../data/types';
import { Drawer } from './ui';
import { fmtPrice, useUnitPrice } from '../data/pricing';
import { Icon } from './Icon';

// Plans. Starter is free for most landlords: up to 2 properties and everything day to day (rent, receipts,
// reminders, expenses, statement uploads, notices and forms, applications, taxes). Landlord (paid) adds the
// advanced features: connecting banks (with Check now) and more than 2 properties. Card payments (Stripe) are not
// connected yet: "Upgrade" asks the Keyholder team to switch the account, and nobody is charged without agreeing.

/** Properties on the free plan. */
export const FREE_PROPERTIES = 2;
/** In Starter (free). */
const FREE = ['Rent tracking, PDF receipts and reminders', 'Expenses, receipt photos and statement uploads', "Your province's notices and forms", 'Tenant applications', 'Year-end summary and tax numbers (T776)', `Up to ${FREE_PROPERTIES} properties`];
/** Added by Landlord (paid). */
const PAID = ['Connect your banks: rent, bills and mortgage found for you', 'Check now, any time', `More than ${FREE_PROPERTIES} properties`];

/** A new property is allowed: the paid plan, or fewer than 2 on the free plan. */
export const canAddProperty = (state: AppState) => paidPlan() || state.properties.filter((p) => !p.archived).length < FREE_PROPERTIES;

/** "Part of the Landlord plan": what it adds, and a way to ask for it (card payments are not open yet). */
export function useUpgrade(): [(why: string) => void, React.ReactNode] {
  const [why, setWhy] = useState<string | null>(null);
  return [setWhy, why && <UpgradeDrawer why={why} onClose={() => setWhy(null)} />];
}
function UpgradeDrawer({ why, onClose }: { why: string; onClose: () => void }) {
  const unitCents = useUnitPrice();
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | string>('idle');
  const ask = async () => {
    setState('busy');
    try { await api('POST', '/api/support/tickets', { subject: 'Upgrade to the Landlord plan', message: `Please switch my account to the Landlord plan. (Asked from: ${why})`, category: 'billing' }); setState('sent'); }
    catch (x) { setState((x as Error).message); }
  };
  return (
    <Drawer title="Part of the Landlord plan" onClose={onClose} footer={state === 'sent' ? <button className="btn primary" onClick={onClose}>Done</button> : <><button className="btn ghost" onClick={onClose}>Not now</button><button className="btn primary" id="upgrade-ask" disabled={state === 'busy'} onClick={ask}>Upgrade to Landlord</button></>}>
      <p style={{ marginTop: 0 }}><strong>{why}</strong> is part of the Landlord plan ({fmtPrice(unitCents)} per unit, a month).</p>
      <ul className="billing-features">{PAID.map((f) => <li key={f}><Icon name="check" size={16} />{f}</li>)}</ul>
      {state === 'sent' ? <p className="callout pine" role="status" id="upgrade-sent"><Icon name="check" size={16} /> Request sent. We will switch your account and confirm by email. You are not charged until card payments open, and we ask first.</p>
        : typeof state === 'string' && !['idle', 'busy'].includes(state) ? <p className="small acct-error" role="alert">{state}</p>
        : <p className="small soft">Everything else stays free. <Link to="/settings/billing" onClick={onClose}>See your plan</Link></p>}
    </Drawer>
  );
}

export function Billing() {
  const { state } = useStore();
  const { user } = useConn();
  const unitCents = useUnitPrice();
  const props = state.properties.filter((p) => !p.archived);
  const units = state.units.filter((u) => props.some((p) => p.id === u.propertyId)).length;
  // The live account's plan comes from the server; the browser-only preview shows the paid plan (and can switch, to try it).
  const [previewPlan, setPreviewPlan] = useState<'starter' | 'landlord'>('landlord');
  const plan: 'starter' | 'landlord' = serverMode() ? (user?.plan ?? 'starter') : previewPlan;
  const monthly = units * unitCents;
  const [upgrade, upgradeScreen] = useUpgrade();
  const [cancel, setCancel] = useState<'ask' | 'busy' | string | null>(null);
  const doCancel = async () => {
    if (!serverMode()) { setPreviewPlan('starter'); setCancel(null); return; }
    setCancel('busy');
    try { await api('POST', '/api/billing/cancel'); if (user) setUser({ ...user, plan: 'starter' }); setCancel(null); }
    catch (x) { setCancel((x as Error).message); }
  };
  const tier = (id: 'starter' | 'landlord') => {
    const on = plan === id;
    return (
      <div className={`bill-tier${id === 'landlord' ? ' best' : ''}${on ? ' on' : ''}`} id={`tier-${id}`}>
        {on ? <span className="bill-flag on"><Icon name="check" size={13} />Your plan</span> : id === 'landlord' ? <span className="bill-flag">Advanced</span> : null}
        <span className={`bill-ic ${id === 'landlord' ? 'lilac' : 'mint'}`}><Icon name={id === 'landlord' ? 'users' : 'home'} size={22} /></span>
        <h3>{id === 'landlord' ? 'Landlord' : 'Starter'}</h3>
        <p className="bill-amt">{id === 'landlord' ? <>{fmtPrice(unitCents)}<span>per unit, a month</span></> : 'Free'}</p>
        <p className="bill-per">{id === 'landlord' ? (on ? `${fmtPrice(monthly)} a month for your ${units} unit${units === 1 ? '' : 's'}, once card payments open` : 'Advanced features, when you want them') : 'For most landlords, free for good'}</p>
        <ul>{(id === 'landlord' ? ['Everything in Starter', ...PAID] : FREE).map((f) => <li key={f}><Icon name="check" size={15} />{f}</li>)}</ul>
        {on ? (id === 'landlord'
          ? <button className="btn ghost" id="billing-cancel" onClick={() => setCancel('ask')}>Cancel Landlord</button>
          : <button className="btn" disabled>Current plan</button>)
          : id === 'landlord'
            ? <button className="btn primary" id="billing-upgrade" onClick={() => (serverMode() ? upgrade('Connecting banks and more properties') : setPreviewPlan('landlord'))}>Upgrade to Landlord</button>
            : <button className="btn" id="billing-downgrade" onClick={() => setCancel('ask')}>Switch to Starter</button>}
      </div>
    );
  };
  return (
    <section className="section billing" id="billing">
      <div className="bill-summary" id="billing-usage">
        <div><span>Plan</span><strong>{plan === 'landlord' ? 'Landlord' : 'Starter'}</strong></div>
        <div><span>Properties</span><strong>{props.length}{plan === 'starter' ? <small> of {FREE_PROPERTIES}</small> : null}</strong></div>
        <div><span>Units</span><strong>{units}</strong></div>
        <div><span>Monthly</span><strong>{plan === 'landlord' ? fmtPrice(monthly) : 'Free'}</strong></div>
      </div>
      {plan === 'starter' && props.length > FREE_PROPERTIES && <p className="small soft bill-note">Starter covers {FREE_PROPERTIES} properties: the ones you have stay, and adding more needs Landlord.</p>}
      <h2 className="section-title">Plans</h2>
      <div className="bill-tiers" id="billing-plan">{tier('starter')}{tier('landlord')}</div>
      {upgradeScreen}
      {cancel && (
        <Drawer title="Switch to Starter?" onClose={() => setCancel(null)} footer={<><button className="btn ghost" onClick={() => setCancel(null)}>Keep Landlord</button><button className="btn primary" id="billing-cancel-go" disabled={cancel === 'busy'} onClick={doCancel}>{cancel === 'busy' ? 'Switching…' : 'Switch to Starter'}</button></>}>
          <p style={{ marginTop: 0 }}>You move to the free Starter plan straight away. Everything you have stays.</p>
          <ul className="billing-features locked">{PAID.map((f) => <li key={f}><Icon name="lock" size={16} />{f}</li>)}</ul>
          <p className="small soft">These stop: connected banks stay as they are, but you can't add a new one or press Check now, and you can't add more than {FREE_PROPERTIES} properties. You can upgrade again any time.</p>
          {!['ask', 'busy'].includes(cancel) && <p className="small acct-error" role="alert">{cancel}</p>}
        </Drawer>
      )}

      <h2 className="section-title">Payment</h2>
      <div className="bill-pay" id="billing-pay">
        <span className="bill-pay-ic"><Icon name="cash" size={20} /></span>
        <div><strong>No card on file</strong><p>You won't be charged until card payments open, and Keyholder will ask you first. Your card and invoices will show here then.</p></div>
        <span className="bill-pill">Nothing due</span>
      </div>
    </section>
  );
}
