import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';

// The website's Overview, built around one goal: a landlord understands what Keyholder does, and why they need
// it, before scrolling. Hero (the headline + a slider of app pictures), the five jobs in one row (each opens its screen
// in the Features page's tour), how it works, who it is for.
// Every number in the pictures is sample data, labelled as such. Statements that still need the owner's
// confirmation are marked [CONFIRM] in comments, never shown as fact.

const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: n % 1 ? 2 : 0 });

/** One hero slide: what it shows in a few words, the point in one line, then a small picture of it. */
function Story({ icon, title, point, label, children }: { icon: string; title: string; point: string; label: string; children: React.ReactNode }) {
  return (
    <div className="kh-mock kh-hero-mock kh-story" role="img" aria-label={`${title}: ${point} (sample)`}>
      <div className="kh-story-h">
        <span className="kh-story-ic"><Icon name={icon} size={18} /></span>
        <span><b>{title}</b><small>{point}</small></span>
        <em>{label}</em>
      </div>
      <div className="kh-story-b">{children}</div>
    </div>
  );
}

/** Expenses: costs from the bank, sorted and filed. */
function ExpensesStory() {
  const rows: [string, string, number][] = [['Home Depot', 'Repairs', 86.45], ['Enbridge Gas', 'Utilities', 212.4], ['Snow removal (cash)', 'Maintenance', 60]];
  return (
    <Story icon="cash" title="Expenses found for you" point="From your bank, sorted and filed in a tap" label="Sample">
      <ul className="kh-list">{rows.map(([v, c, a]) => <li key={v}><span className="kh-ok"><Icon name="check" size={12} /></span><span>{v}<small>{c}</small></span><b>{money(a)}</b></li>)}</ul>
      <div className="kh-total"><span>Filed to 48 Maple St this month</span><b>{money(358.85)}</b></div>
    </Story>
  );
}

/** Rent: a deposit becomes rent, then a receipt. */
function RentStory() {
  return (
    <Story icon="receipt" title="Rent in, receipt out" point="Matched to the tenant, the receipt sent for you" label="Sample">
      <ol className="kh-steps3">
        <li><span className="kh-flow-ic"><Icon name="bank" size={16} /></span><b>{money(1650)}</b><small>Deposit from M. Chen</small></li>
        <li><span className="kh-flow-ic"><Icon name="check" size={16} /></span><b>Rent paid</b><small>Unit A · November</small></li>
        <li><span className="kh-flow-ic ok"><Icon name="send" size={16} /></span><b>Receipt sent</b><small>PDF No. 1042</small></li>
      </ol>
      <div className="kh-total"><span>Rent collected in November</span><b>3 of 3 paid</b></div>
    </Story>
  );
}

/** The year: profit, and how the money compares with a safe deposit. */
function YearStory() {
  return (
    <Story icon="trend" title="Know where you stand" point="This year's profit, and your return next to a GIC" label="Sample">
      <div className="kh-year">
        <div><span className="kh-k">Profit so far</span><strong>{money(10533)}</strong><small>rent {money(31000)} · costs {money(20467)}</small></div>
      </div>
      <ul className="kh-bars">
        <li><span>Your return</span><i style={{ width: '82%' }} /><b>6.1%</b></li>
        <li><span>GIC</span><i className="soft" style={{ width: '42%' }} /><b>3.2%</b></li>
      </ul>
      <div className="kh-total"><span>Ahead of a GIC this year</span><b>+2.9 points</b></div>
    </Story>
  );
}

const SLIDES: [string, () => React.ReactNode][] = [['Expenses found', ExpensesStory], ['Rent and receipts', RentStory], ['Where you stand', YearStory]];
/** The hero's pictures, one at a time: they move on by themselves (not when the visitor prefers less motion, or is pointing at it). */
export function HeroSlider() {
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (hold || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => setI((k) => (k + 1) % SLIDES.length), 6000);
    return () => clearTimeout(t);
  }, [i, hold]);
  return (
    <div className="kh-slider" id="hero-slider" aria-roledescription="carousel" aria-label="What Keyholder looks like" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      <div className="kh-slides" style={{ transform: `translateX(-${i * 100}%)` }}>
        {SLIDES.map(([t, Pic], k) => <div key={t} className="kh-slide" aria-roledescription="slide" aria-label={`${k + 1} of ${SLIDES.length}: ${t}`} aria-hidden={k !== i}><Pic /></div>)}
      </div>
      <div className="kh-dots" role="tablist" aria-label="Pictures">
        {SLIDES.map(([t], k) => <button key={t} role="tab" aria-selected={k === i} aria-label={t} className={k === i ? 'on' : ''} onClick={() => setI(k)}><span /></button>)}
      </div>
    </div>
  );
}

/** The five jobs, in plain words; a tap opens that tab of the feature explorer. */
export const JOBS: [string, string, string][] = [
  ['expenses', 'Track expenses', 'cash'],
  ['receipts', 'Send receipts', 'receipt'],
  ['tenants', 'Screen tenants', 'users'],
  ['notices', 'Write notices', 'paper'],
  ['taxes', 'File taxes', 'print'],
];
export function JobsStrip({ onPick }: { onPick: (id: string) => void }) {
  return (
    <nav className="kh-jobs" aria-label="What Keyholder does">
      {JOBS.map(([id, t, ic]) => <button key={id} type="button" className="kh-job" onClick={() => onPick(id)}><span className="kh-job-ic"><Icon name={ic} size={20} /></span>{t}</button>)}
    </nav>
  );
}

/** Three steps: connect or upload, review, send and file. */
export const HOW: [string, string, string][] = [
  ['bank', 'Connect or upload', 'Link your bank, or upload a statement (PDF, CSV and more). Add your properties and tenants.'],
  ['check', 'Review', 'Keyholder sorts expenses, matches rent and drafts what is due. You check and approve.'],
  ['send', 'Send and file', 'Receipts and letters go out, and your year-end numbers are ready for your return.'],
];
