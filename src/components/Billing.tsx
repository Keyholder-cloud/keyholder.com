import { useStore } from '../data/store';
import { serverMode, useConn } from '../data/api';
import { fmtPrice, useUnitPrice } from '../data/pricing';
import { Icon } from './Icon';

// Settings → Billing: which plan this account is on, what it covers, and payment. Card payments (Stripe) are
// not connected yet, so there is no card, invoice or subscription to show: it says so plainly, and that nobody
// is charged without agreeing first. The plans' limits and features follow the owner's free vs paid decision
// (until then: Starter free for one unit, Landlord per unit from two, every feature in both).

/** What every plan includes (the same list as the website's Pricing page). */
const FEATURES = ['Rent tracking, receipts and reminders', 'Bank connection and statement uploads', 'Expenses with receipt photos', "Your province's notices and forms", 'Tenant applications', 'Tax numbers for your T776'];

export function Billing() {
  const { state } = useStore();
  const { user } = useConn();
  const unitCents = useUnitPrice();
  const props = state.properties.filter((p) => !p.archived);
  const units = state.units.filter((u) => props.some((p) => p.id === u.propertyId)).length;
  // The live account's plan comes from the server; the browser-only preview shows the paid plan.
  const plan: 'starter' | 'landlord' = serverMode() ? (user?.plan ?? 'starter') : 'landlord';
  const monthly = units * unitCents;
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
            : <>Free for good: no trial and no end date.</>}
        </p>
        <p className="small soft" id="billing-usage" style={{ margin: '6px 0 0' }}>You have {units} unit{units === 1 ? '' : 's'} in {props.length} propert{props.length === 1 ? 'y' : 'ies'}.
          {plan === 'starter' && units > 1 && <> Starter covers one unit; with {units} units, Landlord would be {fmtPrice(monthly)} a month. Nothing changes until you choose.</>}
        </p>
      </div>

      <h2 className="section-title">What you have</h2>
      <div className="sheet">
        <ul className="billing-features">{FEATURES.map((f) => <li key={f}><Icon name="check" size={16} />{f}</li>)}</ul>
      </div>

      <h2 className="section-title">Payment</h2>
      <div className="sheet billing-pay" id="billing-pay">
        <p style={{ margin: 0 }}><Icon name="cash" size={16} /> <strong>No card on file.</strong></p>
        <p className="small soft" style={{ margin: '6px 0 0' }}>You won't be charged until card payments open, and Keyholder will ask you first. Your card, invoices and subscription will show here then.</p>
      </div>
    </section>
  );
}
