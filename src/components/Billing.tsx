import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../data/store';
import { api, paidPlan, serverMode, useConn } from '../data/api';
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
  // The live account's plan comes from the server; the browser-only preview shows the paid plan.
  const plan: 'starter' | 'landlord' = serverMode() ? (user?.plan ?? 'starter') : 'landlord';
  const monthly = units * unitCents;
  const [upgrade, upgradeScreen] = useUpgrade();
  return (
    <section className="section billing" id="billing">
      <h2 className="section-title">Your plan</h2>
      <div className="sheet billing-plan" id="billing-plan">
        <div className="spread">
          <div>
            <strong className="billing-name">{plan === 'landlord' ? 'Landlord' : 'Starter'}</strong>
            <span className="billing-price">{plan === 'landlord' ? `${fmtPrice(unitCents)} per unit, a month` : 'Free'}</span>
          </div>
          <span className="chip on"><Icon name="check" size={14} />Your plan</span>
        </div>
        <p className="small" style={{ margin: '10px 0 0' }}>
          {plan === 'landlord'
            ? <>For your {units} unit{units === 1 ? '' : 's'}: {fmtPrice(monthly)} a month once card payments open. Until then, nothing is charged.</>
            : <>Free for good: no trial and no end date. Up to {FREE_PROPERTIES} properties, with everything day to day.</>}
        </p>
        <p className="small soft" id="billing-usage" style={{ margin: '6px 0 0' }}>You have {units} unit{units === 1 ? '' : 's'} in {props.length} propert{props.length === 1 ? 'y' : 'ies'}.
          {plan === 'starter' && props.length > FREE_PROPERTIES && <> Starter covers {FREE_PROPERTIES} properties: the ones you have stay, and adding more needs Landlord.</>}
        </p>
      </div>

      <h2 className="section-title">Free with Starter</h2>
      <div className="sheet">
        <ul className="billing-features">{FREE.map((f) => <li key={f}><Icon name="check" size={16} />{f}</li>)}</ul>
      </div>
      <h2 className="section-title">Added with Landlord</h2>
      <div className="sheet">
        <ul className={`billing-features${plan === 'landlord' ? '' : ' locked'}`}>{PAID.map((f) => <li key={f}><Icon name={plan === 'landlord' ? 'check' : 'lock'} size={16} />{f}</li>)}</ul>
        {plan !== 'landlord' && <div className="btn-row" style={{ marginTop: 12 }}><button className="btn primary" id="billing-upgrade" onClick={() => upgrade('Connecting banks and more properties')}>Upgrade to Landlord</button></div>}
      </div>
      {upgradeScreen}

      <h2 className="section-title">Payment</h2>
      <div className="sheet billing-pay" id="billing-pay">
        <p style={{ margin: 0 }}><Icon name="cash" size={16} /> <strong>No card on file.</strong></p>
        <p className="small soft" style={{ margin: '6px 0 0' }}>You won't be charged until card payments open, and Keyholder will ask you first. Your card, invoices and subscription will show here then.</p>
      </div>
    </section>
  );
}
