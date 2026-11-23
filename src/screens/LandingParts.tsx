import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';

// The website's Overview, built around one goal: a landlord understands what Keyholder does, and why they need
// it, before scrolling. Hero (the money outcome + a product picture), the five jobs in one row, a tabbed feature
// explorer (one tab per job, each with a small picture of the app), how it works, who it is for.
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

type Feature = { id: string; tab: string; icon: string; h: string; p: string; pic: () => React.ReactNode };
// In the order of value to the landlord.
const FEATURES: Feature[] = [
  { id: 'expenses', tab: 'Expenses', icon: 'cash', h: 'Catch the small expenses that add up to thousands.',
    p: 'A $12 key copy, a $40 plumber, a $9 stamp: small or rare costs rarely get written down. Connect your bank or upload a statement, and Keyholder lists every one for you to file in a tap.', pic: StatementMock },
  { id: 'taxes', tab: 'Year-end and tax', icon: 'print', h: 'See your profit, your net worth and a tax form ready to review.',
    p: 'Every property’s income and costs for the year, whether it made money, what it is worth less what you owe, and your T776 numbers pre-filled for your review.', pic: TaxMock },
  { id: 'tenants', tab: 'Applications', icon: 'users', h: 'Better tenants, from one easy application.',
    p: 'A short online application built around your province’s requirements that tenants can finish on a phone. Compare and approve every applicant on one page.', pic: ApplicantsMock },
  { id: 'notices', tab: 'Letters and forms', icon: 'paper', h: 'From “rent is late” to a ready letter in one tap.',
    p: 'Friendly reminders, warning letters and official forms such as late-rent and rent-increase notices, pre-filled for your review. No downloading, no filling in by hand.', pic: LetterMock },
  { id: 'receipts', tab: 'Receipts', icon: 'receipt', h: 'A proper rent receipt the moment rent is in.',
    p: 'Mark rent paid and your tenant gets a numbered PDF receipt by email.', pic: ReceiptMock },
];

/** Tabs: one per job. Arrow keys move between tabs (a real tablist). */
export function FeatureExplorer({ tab, setTab }: { tab: string; setTab: (id: string) => void }) {
  const i = Math.max(0, FEATURES.findIndex((f) => f.id === tab));
  const f = FEATURES[i];
  const go = (k: number) => setTab(FEATURES[(k + FEATURES.length) % FEATURES.length].id);
  return (
    <div className="kh-explorer" id="features-explorer">
      <div className="kh-tabs" role="tablist" aria-label="Features" onKeyDown={(e) => { if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1); }}>
        {FEATURES.map((x, k) => (
          <button key={x.id} role="tab" id={`kh-tab-${x.id}`} aria-selected={k === i} aria-controls="kh-panel" tabIndex={k === i ? 0 : -1} className={`kh-tab${k === i ? ' on' : ''}`} onClick={() => setTab(x.id)}>
            <Icon name={x.icon} size={18} />{x.tab}
          </button>
        ))}
      </div>
      <div className="kh-panel" role="tabpanel" id="kh-panel" aria-labelledby={`kh-tab-${f.id}`}>
        <div className="kh-panel-copy">
          <h3>{f.h}</h3>
          <p>{f.p}</p>
        </div>
        <div className="kh-panel-pic">{f.pic()}</div>
      </div>
    </div>
  );
}

function StatementMock() {
  return (
    <div className="kh-mock kh-two" role="img" aria-label="Sample: lines from a bank statement turned into filed expenses">
      <div className="kh-raw">
        <span className="kh-k">Bank statement</span>
        <code>POS 0412 HOME DEPOT #7011 · 86.45</code>
        <code>PREAUTH ENBRIDGE GAS · 212.40</code>
        <code>INTERAC E-TRF M CHEN · +1,650.00</code>
        <code>POS 0398 KEY KIOSK · 12.00</code>
      </div>
      <span className="kh-arrow" aria-hidden><Icon name="next" size={20} /></span>
      <ul className="kh-list">
        {([['Home Depot', 'Repairs', '$86.45'], ['Enbridge Gas', 'Utilities', '$212.40'], ['Maya Chen', 'Rent received', '+$1,650'], ['Key copy', 'Maintenance', '$12.00']] as const).map(([v, c, a]) => (
          <li key={v}><span className="kh-ok"><Icon name="check" size={12} /></span><span>{v}<small>{c}</small></span><b>{a}</b></li>
        ))}
      </ul>
    </div>
  );
}
function TaxMock() {
  return (
    <div className="kh-mock" role="img" aria-label="Sample: a year's profit and net worth, with tax form lines pre-filled">
      <div className="kh-grid3">
        <div><span className="kh-k">Rent in</span><b>$31,000</b></div><div><span className="kh-k">Expenses</span><b>$20,467</b></div><div className="kh-good"><span className="kh-k">Profit</span><b>$10,533</b></div>
      </div>
      <div className="kh-net"><span className="kh-k">Net worth in this property</span><b>$412,000</b><small>worth $1,200,000 · owed $788,000</small></div>
      <div className="kh-form"><span className="kh-k">T776 · pre-filled for your review</span>
        <div><span>Gross rents (line 8141)</span><b>$31,000.00</b></div><div><span>Total expenses</span><b>$20,467.00</b></div><div><span>Net rental income</span><b>$10,533.00</b></div>
      </div>
    </div>
  );
}
function ApplicantsMock() {
  return (
    <div className="kh-mock" role="img" aria-label="Sample: three applicants compared on one page">
      <span className="kh-k">Unit C · 3 applications</span>
      <ul className="kh-list kh-apps">
        {([['SO', 'Sam Ortiz', 'Income 3.2× rent · references 2', true], ['GL', 'Grace Lee', 'Income 2.8× rent · references 1', false], ['RT', 'Ravi Thomas', 'Income 2.1× rent · references 2', false]] as const).map(([i, n, d, top]) => (
          <li key={n}><span className="kh-av">{i}</span><span>{n}<small>{d}</small></span>{top ? <span className="kh-btn">Approve</span> : <span className="kh-btn ghost">View</span>}</li>
        ))}
      </ul>
    </div>
  );
}
function LetterMock() {
  return (
    <div className="kh-mock" role="img" aria-label="Sample: rent is 9 days late, and a letter is ready to send">
      <div className="kh-late"><span className="kh-bad">Jordan · Unit B · rent 9 days late</span><span className="kh-btn">Prepare letter</span></div>
      <div className="kh-letter">
        <b>Rent for November</b>
        <p>Hi Jordan, rent of $1,600 was due on November 1 and has not arrived yet. Please send it by November 15, or let me know if something is wrong.</p>
        <small>Pre-filled for your review · nothing is sent until you approve</small>
      </div>
    </div>
  );
}
function ReceiptMock() {
  return (
    <div className="kh-mock kh-receipt" role="img" aria-label="Sample: rent receipt number 1042, paid">
      <div className="kh-rc-head"><b>RENT RECEIPT</b><span>No. 1042</span></div>
      <div className="kh-rc-body"><span className="kh-k">Amount received</span><strong>$1,650.00</strong><small>Rent for November 2026 · e-Transfer · Maya Chen</small><span className="kh-stamp">PAID</span></div>
    </div>
  );
}

/** Three steps: connect or upload, review, send and file. */
export const HOW: [string, string, string][] = [
  ['bank', 'Connect or upload', 'Link your bank, or upload a statement (PDF, CSV and more). Add your properties and tenants.'],
  ['check', 'Review', 'Keyholder sorts expenses, matches rent and drafts what is due. You check and approve.'],
  ['send', 'Send and file', 'Receipts and letters go out, and your year-end numbers are ready for your return.'],
];

/** The tab chosen by the jobs strip. */
export function useFeatureTab(first?: string) {
  const [tab, setTab] = useState(first ?? 'expenses');
  useEffect(() => { if (first) requestAnimationFrame(() => document.getElementById('features-explorer')?.scrollIntoView({ block: 'start' })); }, []);
  const pick = (id: string) => { setTab(id); requestAnimationFrame(() => document.getElementById('features-explorer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  return { tab, setTab, pick };
}
