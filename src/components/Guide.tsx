import { ContactForm } from './ContactForm';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useStore } from '../data/store';

// Small helpers that make the app explain itself: page subtitles, the sample banner,
// status pills you can tap for a meaning, and a five-step guided tour.

/** One line under a page title: what this page is for. */
export function PageSub({ children }: { children: React.ReactNode }) {
  return <p className="page-sub">{children}</p>;
}

/** Shown while the app holds the sample properties. */
export function SampleBanner() {
  const { state, act } = useStore();
  const nav = useNavigate();
  if (!state.profile.sample || !state.properties.length) return null;
  const admin = state.profile.account?.provider === 'admin';
  return (
    <div className="sample-banner" role="status">
      <span><strong>{admin ? 'Admin:' : 'Demo:'}</strong> sample properties. Nothing here is real.</span>
      <span className="btn-row">
        {admin
          ? <button className="btn small ghost" onClick={() => nav('/support')}>Back to support</button>
          : <button className="btn small ghost" onClick={() => act.setProfile({ tourDone: false })}>Show me around</button>}
        <button className="btn small" onClick={() => { act.signOut(); nav('/welcome'); }}>Sign out</button>
      </span>
    </div>
  );
}

const MEANING: Record<string, string> = {
  paid: 'Rent for this month is in. Send a receipt so your tenant has a record.',
  late: 'The due date has passed and the full rent has not arrived. Start with a friendly reminder.',
  due: 'Rent is coming up or a payment needs a quick look. Nothing is late yet.',
  vacant: 'Nobody lives here right now. Share the application link to find a tenant.',
};

/** A status pill that explains itself when tapped (a "?" pointer on hover). `meaning` replaces the usual words. */
export function StatusPill({ tone, children, meaning }: { tone: string; children: React.ReactNode; meaning?: string }) {
  const [open, setOpen] = useState(false);
  const text = meaning ?? MEANING[tone];
  if (!text) return <span className={`status ${tone}`}>{children}</span>;
  return (
    <span className="pill-wrap">
      <button type="button" className={`status ${tone} pill-btn`} aria-expanded={open} onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)} title="What does this mean?">{children}</button>
      {open && <span className={`pill-tip ${tone}`} role="tooltip">{text}</span>}
    </span>
  );
}

// ---------- The guided tour ----------
const STEPS: { sel: string; title: string; body: string; path?: string }[] = [
  { sel: '[data-tour="rent"]', title: 'Your rent, at a glance', body: 'Who has paid, and the one next step for each unit.', path: '/today' },
  { sel: '[data-tour="score"]', title: 'Your setup progress', body: 'Goes up as you add details. Pick any item, or hide the ones you don\'t need.', path: '/today' },
  { sel: '[data-tour="portfolio"], [data-tour="more"]', title: 'Is it worth it?', body: 'What your properties are worth and earn, next to a GIC and the stock market. On phones it is under More, with Paperwork and Settings.' },
  { sel: '[data-tour="rentals"]', title: 'Your rentals', body: 'Properties, units, tenants, applications and notices.' },
  { sel: '[data-tour="income"]', title: 'Income', body: 'Every rent payment, with its receipt.' },
  { sel: '[data-tour="expenses"]', title: 'Expenses', body: 'Add an expense with your camera: Keyholder reads the receipt. Bank bills are filed for you to confirm.' },
];

/** The tour for a brand-new account (no property yet): where to start and where things are. */
const FIRST_STEPS: typeof STEPS = [
  { sel: '[data-tour="start-here"]', title: 'Start here', body: 'Add your first property, then your tenants. It takes about 10 minutes, and Keyholder starts tracking your rent.', path: '/today' },
  { sel: '[data-tour="income"]', title: 'Income', body: 'Every rent payment you receive, with a receipt sent to your tenant.' },
  { sel: '[data-tour="expenses"]', title: 'Expenses', body: 'Add an expense with your camera: Keyholder reads the receipt and fills in the details.' },
  { sel: '[data-tour="score"]', title: 'Your setup progress', body: 'Goes up as you add details. Tap it to see what is left.', path: '/today' },
  { sel: '[data-tour="account"]', title: 'Settings', body: 'Your profile and settings are up here. Sign out is in Settings. Help is in the menu.', path: '/today' },
];

export function Tour() {
  const { state, act } = useStore();
  const nav = useNavigate();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const team = state.profile.account?.provider === 'admin' && !state.profile.sample;
  const active = !!state.profile.onboarded && state.profile.tourDone === false && !team;
  const STEPS_NOW = state.properties.length ? STEPS : FIRST_STEPS;
  const step = STEPS_NOW[Math.min(i, STEPS_NOW.length - 1)];

  useEffect(() => { if (active) { setI(0); nav('/today'); } }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!active) return;
    const find = () => {
      const el = [...document.querySelectorAll<HTMLElement>(step.sel)].find((e) => e.offsetParent !== null || e.getClientRects().length);
      if (el) {
        const r0 = el.getBoundingClientRect();
        if (r0.top < 0 || r0.bottom > window.innerHeight) el.scrollIntoView({ block: r0.height > window.innerHeight * 0.5 ? 'start' : 'center', behavior: 'instant' as ScrollBehavior });
        setRect(el.getBoundingClientRect());
      } else setRect(null);
    };
    find();
    const t = setTimeout(find, 60);
    window.addEventListener('resize', find);
    window.addEventListener('scroll', find, { passive: true });
    return () => { clearTimeout(t); window.removeEventListener('resize', find); window.removeEventListener('scroll', find); };
  }, [active, i, step.sel]);

  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') done(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });

  if (!active) return null;
  const done = () => act.setProfile({ tourDone: true });
  const last = i === STEPS_NOW.length - 1;
  const pad = 8;
  // Put the card below the highlight, else above it, else pinned to the bottom of the screen.
  const room = 240;
  const place = !rect ? 'middle' : window.innerHeight - rect.bottom > room ? 'below' : rect.top > room ? 'above' : 'bottom';
  const cardTop = place === 'below' ? rect!.bottom + pad + 12 : place === 'above' ? rect!.top - pad - 12 : undefined;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? <div className="tour-hole" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} /> : <div className="tour-dim" />}
      <div className={`tour-card ${place}`} style={cardTop !== undefined ? { top: cardTop } : undefined}>
        <p className="tiny soft">Step {i + 1} of {STEPS_NOW.length}</p>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="btn-row">
          <button className="btn ghost" onClick={done}>Skip tour</button>
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}
          <button className="btn primary" autoFocus onClick={() => (last ? done() : setI(i + 1))}>{last ? 'Got it' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}

/** Phone only: pages reached from the "More" menu get a way back to it. */
export function BackToMore() {
  return <Link to="/more" className="crumb phone-only"><Icon name="back" size={16} />Back to More</Link>;
}

// ---------- Plain meanings for words a new landlord may not know ----------
export const GLOSSARY: Record<string, string> = {
  GIC: 'A GIC is a safe savings deposit at a bank. You lock money in for a set time and earn a fixed rate.',
  T776: 'T776 is the form for rental income on your Canadian tax return. Keyholder fills in the numbers for you.',
  N4: "N4 is Ontario's form telling a tenant they owe rent. It is the first official step when rent is late.",
  arrears: 'Rent that is owed and late.',
  depreciation: 'Spreading the cost of something big, like a new roof, over several years on your taxes.',
  'cost base': 'What you paid for the property, plus buying costs and big improvements. Used to work out tax when you sell.',
  tribunal: 'The provincial office that handles disagreements between landlords and tenants.',
  'net worth': 'What your properties are worth, minus what you still owe on them.',
};

/** A word with a dotted underline. Tap it for a one-line meaning. */
export function Term({ t, children }: { t: keyof typeof GLOSSARY | string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const text = GLOSSARY[t];
  if (!text) return <>{children ?? t}</>;
  return (
    <span className="term-wrap">
      <button type="button" className="term" aria-expanded={open} onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)}>{children ?? t}</button>
      {open && <span className="pill-tip term-tip" role="tooltip">{text}</span>}
    </span>
  );
}

// ---------- Help: plain answers, always one tap away ----------
const HELP: [string, string][] = [
  ['What should I do first?', 'Look at Home. Each tenant has one button beside them: that is the next thing to do. Tap it.'],
  ['How do I mark rent as paid?', 'On Home, tap "Mark paid" next to the tenant. If your bank is connected, Keyholder marks it for you.'],
  ['What if rent is late?', 'Tap "Send reminder" first. If it is still not paid, Keyholder shows the next step for your province, one at a time.'],
  ['How do I save a receipt for a cost?', 'On Expenses, tap "Add an expense" and take a photo. Keyholder reads the receipt and fills in the details.'],
  ['What is "Setup progress"?', 'It shows how much of your setup is done. Each item you finish makes your numbers more accurate. It is optional.'],
  ['What do Bronze, Silver and Gold mean?', 'Your property card gets more useful as you add details, like what you paid. It is always free.'],
  ['Can Keyholder move my money?', 'No. It can only look at deposits and bills. It never sees your bank password.'],
];
/** Help is a link to the Help page (side menu; phones: More). */
export function HelpButton({ compact, variant }: { compact?: boolean; variant?: 'more' }) {
  return variant === 'more'
    ? <Link to="/help" className="more-item help-btn"><Icon name="info" size={26} /><span><strong>Help</strong><span>Answers, contact us, the tour</span></span><Icon name="next" /></Link>
    : <NavLink to="/help" className={({ isActive }) => `${compact ? 'btn ghost small' : 'nav-link'} help-btn${isActive ? ' active' : ''}`}><Icon name="info" size={compact ? 18 : 20} />Help</NavLink>;
}

/** Help: plain answers on the left, a contact form at the side. */
export function HelpPage() {
  const { act } = useStore();
  const nav = useNavigate();
  return (
    <div className="page help-page">
      <BackToMore />
      <div className="page-head"><div><h1 id="help-title">Help</h1><PageSub>Plain answers, and a person when you need one.</PageSub></div></div>
      <div className="help-grid">
        <section aria-label="Questions">
          <div className="help-list sheet">{HELP.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => { act.setProfile({ tourDone: false }); nav('/today'); }}><Icon name="sparkle" size={16} />Show me around again</button>
        </section>
        <aside className="sheet"><ContactForm id="help-contact" /></aside>
      </div>
    </div>
  );
}
