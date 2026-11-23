import { SecurityPage } from './Security';
import { useEffect, useRef, useState } from 'react';
import { fmtPrice, useUnitPrice } from '../data/pricing';
import { FeatureExplorer, HeroSlider, HOW, JobsStrip, useFeatureTab } from './LandingParts';
import { ContactForm } from '../components/ContactForm';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Province } from '../data/types';
import { useStore } from '../data/store';
import { Icon } from '../components/Icon';
import { Brand } from '../components/Brand';
import { AnnouncementBar } from '../support/Announcement';
import { province } from '../lib/jurisdiction';
import { AUTHORITY_URL, formsFor } from '../lib/forms';
import keysPhoto from '../assets/photos/keys.webp';
import aptPhoto from '../assets/photos/apartment.webp';
import shotRent from '../assets/screens/rent.webp';
import shotReceipt from '../assets/screens/receipt.webp';
import shotReminder from '../assets/screens/reminder.webp';
import shotBills from '../assets/screens/bills.webp';
import shotValue from '../assets/screens/value.webp';
import shotTaxes from '../assets/screens/taxes.webp';
import shotNotice from '../assets/screens/notice.webp';
import shotTenants from '../assets/screens/tenants.webp';
import SPOTS from '../assets/screens/hotspots.json';

// The public site: light and airy. Plain white pages, thin borders instead of heavy shadows,
// real screens of the app, indigo only for things you can tap.

const PAGES = [
  { id: '', label: 'Overview', icon: 'home' },
  { id: 'features', label: 'Features', icon: 'sparkle' },
  { id: 'about', label: 'About', icon: 'map' },
  { id: 'pricing', label: 'Pricing', icon: 'cash' },
  { id: 'contact', label: 'Contact', icon: 'mail' },
] as const;
type PageId = (typeof PAGES)[number]['id'];
const href = (id: string) => (id ? `/welcome/${id}` : '/welcome');

/** Adds "shown" to every .reveal element as it scrolls into view. */
/**
 * True while any of the page's own Get started buttons, or the footer, are on screen (the part under
 * the menu bar does not count). The phone bar and the menu-bar buttons step aside then, so the same buttons
 * never show twice at once.
 */
function usePageCtaShown(key: string) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const els = [...document.querySelectorAll('.lp [data-cta], .lp-foot')];
    if (!els.length || typeof IntersectionObserver === 'undefined') { setShown(false); return; }
    const vis = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) vis.add(e.target); else vis.delete(e.target); }
      setShown(vis.size > 0);
    }, { rootMargin: '-72px 0px 0px 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [key]);
  return shown;
}

/** The one main button on the website's pages: Get started (Sign in and Sign up stay at the top right). */
function GetStarted({ start, big, note }: { start: () => void; big?: boolean; note?: boolean }) {
  const button = (
    <button className={`btn primary lp-go${big ? ' lp-big' : ''}`} onClick={start}>
      Get started<span className="lp-go-arrow" aria-hidden><Icon name="next" size={big ? 20 : 18} /></span>
    </button>
  );
  if (!note) return button;
  return <div className="lp-go-wrap">{button}<p className="lp-go-note"><Icon name="check" size={16} />Free for most landlords · No card needed</p></div>;
}

function useReveal(key: string) {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.lp .reveal')];
    if (!('IntersectionObserver' in window) || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { els.forEach((e) => e.classList.add('shown')); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('shown'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [key]);
}

export function Landing() {
  const { state } = useStore();
  const nav = useNavigate();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const [solid, setSolid] = useState(false);
  const seg = loc.pathname.split('/').filter(Boolean);
  const raw = seg[0] === 'welcome' ? seg[1] ?? '' : seg[0] ?? '';
  // The old Provinces and Questions pages are now sections of About.
  const section = raw === 'provinces' ? 'rules' : raw === 'questions' ? 'faq' : '';
  const page: PageId = (section ? 'about' : PAGES.find((p) => p.id === raw)?.id ?? '') as PageId;
  // Security & privacy: its own page, linked from the footer (not the top menu).
  const trust = raw === 'security' || raw === 'privacy' || raw === 'terms';
  const idx = trust ? -1 : PAGES.findIndex((p) => p.id === page);
  // Only a signed-in account (admin included) gets "Open my dashboard", and only in the menu bar.
  // Everyone else sees Sign in and Sign up at the top right, and Get started on the page.
  const signedIn = !!state.profile.account?.signedIn;
  const home = state.profile.account?.provider === 'admin' ? '/support' : '/today';
  const start = () => nav(signedIn ? home : '/start');
  // Tapping the page you are already on: back to its top (or to the tour, for Features).
  const same = (id: string) => { setMenu(false); if (id === page) window.scrollTo(0, 0); };

  useEffect(() => { const on = () => setSolid(window.scrollY > 12); on(); window.addEventListener('scroll', on, { passive: true }); return () => window.removeEventListener('scroll', on); }, []);
  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [page, trust]);
  useEffect(() => { document.title = trust ? 'Security & privacy · Keyholder' : idx === 0 ? 'Keyholder · Rental automation for Canadian landlords' : `${PAGES[idx].label} · Keyholder`; }, [idx, trust]);
  useEffect(() => { document.body.style.overflow = menu ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [menu]);
  useReveal(trust ? 'security' : page);
  const ctaShown = usePageCtaShown(trust ? 'security' : page);
  const isOn = (id: string) => !trust && id === page;

  // Top right, always: Sign in and Sign up (or the dashboard for someone signed in).
  const ctas = signedIn
    ? <Link className="btn primary" to={home}>Open my dashboard</Link>
    : <><Link className="btn ghost" to="/signin">Sign in</Link><Link className="btn primary" to="/start">Sign up</Link></>;

  return (
    <div className="lp">
      <AnnouncementBar where="website" />
      <header className={`lp-nav${solid || menu ? ' solid' : ''}`}>
        <div className="lp-wrap lp-nav-in">
          <Link to="/welcome" className="lp-brand" aria-label="Keyholder home" onClick={() => same('')}><Brand size={28} /></Link>
          <nav aria-label="Site" className="lp-links">
            {PAGES.map((p) => <Link key={p.id} to={href(p.id)} onClick={() => same(p.id)} className={isOn(p.id) ? 'on' : ''} aria-current={isOn(p.id) ? 'page' : undefined}>{p.label}</Link>)}
          </nav>
          <div className="btn-row lp-nav-cta">{ctas}</div>
          {!signedIn && <Link className="btn ghost lp-signin-xs" to="/signin">Sign in</Link>}
          <button className="btn lp-burger" aria-label="Menu" aria-expanded={menu} aria-controls="lp-menu" onClick={() => setMenu((m) => !m)}><Icon name={menu ? 'close' : 'menu'} size={20} /><span>Menu</span></button>
        </div>
      </header>
      {/* Outside the header on purpose: the header's frosted-glass effect would trap a full-screen menu inside its 72px. */}
      {menu && (
        <div className="lp-menu" id="lp-menu">
          {PAGES.map((p) => <Link key={p.id} to={href(p.id)} className={isOn(p.id) ? 'on' : ''} onClick={() => same(p.id)}><span className="lp-menu-ic"><Icon name={p.icon} size={20} /></span>{p.label}<Icon name="next" size={18} /></Link>)}
          <div className="btn-row">{ctas}</div>
        </div>
      )}

      <main>
        {!trust && page === '' && <Overview start={start} />}
        {!trust && page === 'features' && <Features />}
        {!trust && page === 'contact' && <Contact />}
        {trust && <SecurityPage />}
        {!trust && page === 'about' && <About section={section} />}
        {!trust && page === 'pricing' && <Pricing start={start} />}

        <section className="lp-sec lp-cta-sec">
          <div className="lp-wrap">
            <div className="lp-cta-card reveal">
              <div>
                <h2 className="lp-h2">Ready to automate your rental?</h2>
                <p className="lp-lede">Free for most landlords. No card needed.</p>
              </div>
              <div className="btn-row" data-cta>
                <GetStarted start={start} big />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-grid">
          <div><Brand size={26} /><p className="lp-foot-tag">Rental automation for Canadian landlords: receipts, reminders, rent tracking, official notices and taxes.</p></div>
          <nav aria-label="Footer">
            <p>Product</p>{PAGES.map((p) => <Link key={p.id} to={href(p.id)} onClick={() => same(p.id)}>{p.label}</Link>)}
          </nav>
          <nav aria-label="Get started">
            <p>Start</p><Link to="/start">Create a free account</Link><Link to="/signin">Sign in</Link>
          </nav>
          <nav aria-label="Help">
            <p>Help</p><Link to="/welcome/contact">Contact us</Link><Link to="/welcome/questions">Questions</Link>
          </nav>
          <nav aria-label="Trust">
            <p>Trust</p><Link to="/welcome/security">Security &amp; privacy</Link><Link to="/welcome/security#bank">Bank connections (Plaid)</Link><Link to="/welcome/security#rights">Privacy policy</Link><Link to="/welcome/security#terms">Terms of use</Link>
          </nav>
          <p className="lp-legal">Keyholder is not a law firm or a tax advisor. It prepares documents and numbers for your review; it does not give legal or tax advice, file returns, or hold or move money. Check notice periods and forms with your province's tenancy board before you serve one. Screens show sample properties. Photos from Unsplash. © 2026 Keyholder.</p>
        </div>
      </footer>

      {!signedIn && !menu && (
        <div className={`lp-sticky${ctaShown ? ' away' : ''}`} role="region" aria-label="Get started" aria-hidden={ctaShown ? true : undefined}>
          <GetStarted start={start} />
        </div>
      )}
    </div>
  );
}

/** Light page header: words on the left, a photo or picture on the right. */
function PageHead({ kicker, icon, title, children, aside }: { kicker: string; icon: string; title: React.ReactNode; children?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="lp-pagehead">
      <div className="lp-wrap lp-pagehead-grid">
        <div className="reveal">
          <p className="lp-pill"><Icon name={icon} size={16} />{kicker}</p>
          <h1 className="lp-h1">{title}</h1>
          {children && <p className="lp-lede">{children}</p>}
        </div>
        {aside && <div className="lp-pagehead-aside reveal">{aside}</div>}
      </div>
    </section>
  );
}

function SecHead({ kicker, title, children }: { kicker: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="lp-sechead reveal">
      <p className="lp-kicker">{kicker}</p>
      <h2 className="lp-h2">{title}</h2>
      {children && <p className="lp-lede">{children}</p>}
    </div>
  );
}

const Photo = ({ src, alt, className = '' }: { src: string; alt: string; className?: string }) => (
  <figure className={`lp-photo ${className}`}><img src={src} alt={alt} loading="lazy" decoding="async" /></figure>
);

/** Counts up from 0 when it scrolls into view. */
function CountUp({ to, decimals = 0, prefix = '', suffix = '' }: { to: number; decimals?: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(to);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window) || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setV(0);
    let raf = 0;
    const io = new IntersectionObserver(([en]) => {
      if (!en.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t: number) => { const k = Math.min(1, (t - t0) / 1100); setV(to * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to]);
  return <span ref={ref}>{prefix}{v.toFixed(decimals)}{suffix}</span>;
}

// ================================================================ Overview
const TONES = ['lilac', 'mint', 'sky', 'peach', 'sun', 'rose'] as const;
const ModeBadge = ({ mode }: { mode: 'auto' | 'approve' }) => <span className={`mode-badge ${mode}`}><Icon name={mode === 'auto' ? 'sparkle' : 'check'} size={13} />{mode === 'auto' ? 'Automatic' : 'You approve'}</span>;


function Overview({ start }: { start: () => void }) {
  const nav = useNavigate();
  return (
    <>
      <section className="lp-hero">
        <HeroLines />
        <div className="lp-wrap lp-hero-grid">
          <div className="lp-hero-copy">
            <p className="lp-pill"><Icon name="home" size={16} />For Canadian landlords</p>
            <h1 className="lp-hero-h">Manage your rental property <em>with ease</em></h1>
            <p className="lp-lede lp-hero-lede">Track every expense and income, send rent receipts, screen tenants, write notices and get your taxes ready.</p>
            <div className="btn-row lp-hero-ctas" data-cta>
              <GetStarted start={start} big />
              <a className="lp-how-link" href="#how" onClick={(e) => { e.preventDefault(); document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' }); }}>How it works<Icon name="next" size={16} /></a>
            </div>
            <p className="lp-go-note"><Icon name="check" size={16} />Connect your bank or upload a statement · No credit card required</p>
          </div>
          <div className="lp-hero-visual"><HeroSlider /></div>
        </div>
        <div className="lp-wrap"><JobsStrip onPick={(id) => nav(`/welcome/features?tab=${id}`)} /></div>
      </section>

      <section className="lp-sec lp-how" id="how">
        <div className="lp-wrap">
          <div className="lp-how-panel">
            <SecHead kicker="How it works" title="3 steps." />
            <ol className="lp-steps">
              {HOW.map(([ic, t, d], i) => (
                <li key={t} className="lp-step reveal" style={{ transitionDelay: `${i * 80}ms` }}>
                  <div className="lp-step-top"><span className="lp-step-ic"><Icon name={ic} size={22} /></span><span className="lp-step-n">Step {i + 1}</span></div>
                  <h3>{t}</h3>
                  <p>{d}</p>
                  {i < HOW.length - 1 && <span className="lp-step-arrow" aria-hidden><Icon name="next" size={16} /></span>}
                </li>
              ))}
            </ol>
            <p className="lp-see-all reveal"><Link className="lp-arrow" to="/welcome/features">See every feature</Link></p>
          </div>
        </div>
      </section>

      <section className="lp-sec lp-who">
        <div className="lp-wrap">
          <p className="lp-who-line"><strong>Who it’s for:</strong> every landlord in Canada who manages their own rentals, from a basement suite to many properties. You don’t need to be an accountant: Keyholder explains each step in plain words.</p>
        </div>
      </section>
    </>
  );
}

/** Features: what Keyholder does, one tab per job, then real screens. */
function Features() {
  const loc = useLocation();
  const ft = useFeatureTab(new URLSearchParams(loc.search).get('tab') ?? undefined);
  return (
    <>
      <PageHead kicker="Features" icon="sparkle" title={<>Everything a landlord does, <em>in one place.</em></>}>Track expenses, send receipts, screen tenants, write notices and get your taxes ready.</PageHead>
      <section className="lp-sec lp-sec-top0" id="explore">
        <div className="lp-wrap">
          <JobsStrip onPick={ft.pick} />
          <SecHead kicker="What Keyholder does" title="Less money lost, less paperwork, fewer mistakes." />
          <FeatureExplorer tab={ft.tab} setTab={ft.setTab} />
        </div>
      </section>
      <Tour />
    </>
  );
}

/** Contact us: a form that reaches the support inbox. */
function Contact() {
  return (
    <>
      <PageHead kicker="Contact" icon="mail" title={<>Talk to a person. <em>We reply by email.</em></>}>Questions about Keyholder, your plan, or something not working: send us a note.</PageHead>
      <section className="lp-sec lp-sec-top0">
        <div className="lp-wrap lp-contact-grid">
          <div className="lp-contact-card reveal"><ContactForm id="site-contact" title="Send us a message" /></div>
          <ul className="lp-contact-side reveal">
            <li><span className="lp-tile-ic mint"><Icon name="clock" size={18} /></span><span><strong>Usually within one business day</strong><span>A person on our team reads every message.</span></span></li>
            <li><span className="lp-tile-ic lilac"><Icon name="info" size={18} /></span><span><strong>Quick answers</strong><span><Link to="/welcome/questions">Read the common questions</Link></span></span></li>
            <li><span className="lp-tile-ic sky"><Icon name="lock" size={18} /></span><span><strong>Your details stay private</strong><span>Used only to reply to you.</span></span></li>
          </ul>
        </div>
      </section>
    </>
  );
}

// ================================================================ Take a closer look (the features tour)
type Stop = { id: keyof typeof SPOTS; t: string; icon: string; mode: 'auto' | 'approve'; d: string; spot: string; img: string; alt: string };
const TOUR: Stop[] = [
  { id: 'rent', t: 'Rent tracking', icon: 'bank', mode: 'auto', d: 'Who has paid, at a glance. Bank deposits matched for you.', spot: 'Send receipt', img: shotRent, alt: 'Keyholder home screen: rent collected this month, with each tenant marked Paid or Late' },
  { id: 'receipt', t: 'Rent receipts', icon: 'receipt', mode: 'auto', d: 'A numbered receipt for every payment.', spot: 'Paid in full', img: shotReceipt, alt: 'A rent receipt for Maya Chen, marked Paid' },
  { id: 'reminder', t: 'Friendly reminders', icon: 'bell', mode: 'auto', d: 'Written for you. Cancelled if rent arrives.', spot: 'Send now', img: shotReminder, alt: 'A friendly rent reminder written for Jordan and Priya, ready to send' },
  { id: 'bills', t: 'Bills and mortgage', icon: 'cash', mode: 'auto', d: 'Bank bills, filed to the right property.', spot: 'Add expense', img: shotBills, alt: 'Bills found in the bank, such as property tax and gas, ready to file' },
  { id: 'value', t: 'Your return', icon: 'trend', mode: 'auto', d: 'What your money earns, next to a GIC.', spot: 'Your return', img: shotValue, alt: 'Portfolio: net worth in property and the yearly return compared with savings, a GIC and stocks' },
  { id: 'taxes', t: 'Tax summary', icon: 'print', mode: 'auto', d: 'Tax numbers, ready for your accountant.', spot: 'Print for accountant', img: shotTaxes, alt: 'Taxes page: the year’s rental income and costs, with a list of anything to fix' },
  { id: 'notice', t: 'Late-rent notices', icon: 'paper', mode: 'approve', d: 'The official notice, filled in. You sign off.', spot: 'You approve', img: shotNotice, alt: 'An N4 notice for unpaid rent, filled in and checked, waiting for the landlord to approve' },
  { id: 'tenants', t: 'Finding tenants', icon: 'users', mode: 'approve', d: 'Compare applicants side by side.', spot: 'Side by side', img: shotTenants, alt: 'Two rental applications compared side by side' },
];

function Tour() {
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; moved: boolean } | null>(null);
  const n = TOUR.length;
  const s = TOUR[i];
  const spot = SPOTS[s.id];
  const go = (k: number, focus = false) => {
    const next = (k + n) % n;
    setI(next);
    const tab = list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
    tab?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    if (focus) tab?.focus();
  };
  useEffect(() => {
    if (!zoom) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(false); };
    document.addEventListener('keydown', k); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [zoom]);

  return (
    <section className="lp-sec lp-tour" id="tour" aria-label="Take a closer look">
      <div className="lp-wrap">
        <SecHead kicker="Take a closer look" title="See Keyholder at work.">Real screens, with sample properties.</SecHead>
        <div className="lp-tour-grid reveal">
          <div className="lp-tour-list" role="tablist" aria-label="Features" ref={list}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); go(i + 1, true); }
              if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1, true); }
              if (e.key === 'Home') { e.preventDefault(); go(0, true); }
              if (e.key === 'End') { e.preventDefault(); go(n - 1, true); }
            }}>
            {TOUR.map((x, k) => (
              <button key={x.id} role="tab" id={`tour-tab-${x.id}`} aria-selected={k === i} aria-controls="tour-panel" tabIndex={k === i ? 0 : -1} className={`lp-tour-tab${k === i ? ' on' : ''}`} onClick={() => go(k)}>
                <span className={`lp-tile-ic ${TONES[k % TONES.length]}`}><Icon name={x.icon} size={16} /></span>{x.t}
              </button>
            ))}
          </div>
          <div className="lp-tour-stage" role="tabpanel" id="tour-panel" aria-labelledby={`tour-tab-${s.id}`}>
            <div className="mac">
              <div className="mac-bar" aria-hidden><span className="mac-dots"><i /><i /><i /></span><span className="mac-url"><Icon name="lock" size={11} />keyholder.cloud</span></div>
              <button className="mac-screen" aria-label={`Enlarge screen: ${s.alt}`}
                onClick={() => { if (!touch.current?.moved) setZoom(true); }}
                onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, moved: false }; }}
                onTouchEnd={(e) => { const t = touch.current; if (!t) return; const dx = e.changedTouches[0].clientX - t.x; if (Math.abs(dx) > 40) { t.moved = true; go(dx < 0 ? i + 1 : i - 1); } }}>
                {TOUR.map((x, k) => <img key={x.id} src={x.img} alt={k === i ? x.alt : ''} aria-hidden={k !== i} className={k === i ? 'on' : ''} loading="lazy" decoding="async" width={1600} height={1000} />)}
                <span key={s.id} className="mac-spot" style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.w}%`, height: `${spot.h}%` }} aria-hidden>
                  <b className={`${spot.y < 14 ? 'below' : ''} ${spot.x + spot.w / 2 > 70 ? 'r' : spot.x + spot.w / 2 < 25 ? 'l' : ''}`}>{s.spot}</b>
                </span>
              </button>
            </div>
            <div className="lp-tour-cap">
              <p aria-live="polite"><ModeBadge mode={s.mode} /><span><strong>{s.t}.</strong> {s.d}</span></p>
              <div className="lp-tour-nav">
                <button onClick={() => go(i - 1)} aria-label="Previous feature"><Icon name="back" size={18} /></button>
                <span className="lp-tour-count">{i + 1} of {n}</span>
                <button onClick={() => go(i + 1)} aria-label="Next feature"><Icon name="next" size={18} /></button>
              </div>
            </div>
            <p className="lp-tour-hint">Tap the screen to enlarge. Swipe for the next one.</p>
          </div>
        </div>
      </div>
      {zoom && createPortal(
        <div className="lp-zoom" role="dialog" aria-modal="true" aria-label={`${s.t}, enlarged`} onClick={() => setZoom(false)}>
          <button className="lp-zoom-close" onClick={() => setZoom(false)} aria-label="Close" autoFocus><Icon name="close" size={22} /></button>
          <div className="lp-zoom-scroll" onClick={(e) => e.stopPropagation()}><img src={s.img} alt={s.alt} /></div>
        </div>,
        document.body,
      )}
    </section>
  );
}

// ================================================================ Provinces
const TILES: [Province, number, number][] = [
  ['YT', 1, 1], ['NT', 2, 1], ['NU', 3, 1],
  ['BC', 1, 2], ['AB', 2, 2], ['SK', 3, 2], ['MB', 4, 2], ['ON', 5, 2], ['QC', 6, 2], ['NL', 7, 2],
  ['NB', 6, 3], ['PE', 7, 3], ['NS', 7, 4],
];
// Time zones that point to one province or territory. Quebec shares Toronto's time zone, so French on that zone means Quebec.
const TZ_PROVINCE: Record<string, Province> = {
  'America/Vancouver': 'BC', 'America/Edmonton': 'AB', 'America/Regina': 'SK', 'America/Swift_Current': 'SK', 'America/Winnipeg': 'MB',
  'America/Toronto': 'ON', 'America/Thunder_Bay': 'ON', 'America/Nipigon': 'ON', 'America/Montreal': 'QC', 'America/Halifax': 'NS', 'America/Glace_Bay': 'NS',
  'America/Moncton': 'NB', 'America/St_Johns': 'NL', 'America/Goose_Bay': 'NL', 'America/Whitehorse': 'YT', 'America/Dawson': 'YT',
  'America/Yellowknife': 'NT', 'America/Inuvik': 'NT', 'America/Iqaluit': 'NU', 'America/Rankin_Inlet': 'NU', 'America/Cambridge_Bay': 'NU',
};
/** The visitor's own province: from their account if they have one, otherwise a guess from the device's time zone. */
function homeProvince(own?: Province): { p: Province; guessed: boolean } {
  if (own) return { p: own, guessed: false };
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let p = TZ_PROVINCE[tz];
    if (p === 'ON' && /^fr/i.test(navigator.language)) p = 'QC';
    if (p) return { p, guessed: true };
  } catch { /* no time zone: fall back */ }
  return { p: 'ON', guessed: false };
}

/** About: who Keyholder is for, the rules for each province, and the questions people ask. */
function About({ section }: { section: string }) {
  const cents = useUnitPrice();
  useEffect(() => { if (section) requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ block: 'start' })); }, [section]);
  return (
    <>
      <PageHead kicker="About" icon="map" title={<>Made for Canadian landlords, <em>province by province.</em></>} aside={<Photo src={aptPhoto} alt="A bright rental apartment with a sofa and big windows" className="aside" />}>Rent, receipts and taxes kept in order, with the right forms for where your rental is.</PageHead>
      <section className="lp-sec lp-sec-top0">
        <div className="lp-wrap">
          <ul className="lp-for reveal">
            {([['home', 'Any size', 'From one basement suite to many properties'], ['user', 'You manage it yourself', 'No property manager needed'], ['map', 'Every province and territory', 'Forms and rules built in']] as [string, string, string][]).map(([ic, t, d], i) => (
              <li key={t}><span className={`lp-tile-ic ${TONES[i % TONES.length]}`}><Icon name={ic} size={18} /></span><span><strong>{t}</strong><span>{d}</span></span></li>
            ))}
          </ul>
        </div>
      </section>
      <ProvinceRules />
      <section className="lp-sec lp-faq-sec" id="faq">
        <div className="lp-wrap lp-narrow">
          <SecHead kicker="Questions" title="Straight answers." />
          <div className="lp-faqs reveal">
            {FAQ.map(([ic, q, a], i) => <details key={q} className="lp-faq"><summary><span className={`lp-tile-ic ${TONES[i % TONES.length]}`}><Icon name={ic} size={18} /></span>{q}</summary><p>{a.replace('{price}', fmtPrice(cents))}</p></details>)}
          </div>
        </div>
      </section>
    </>
  );
}

function ProvinceRules() {
  const { state } = useStore();
  const [start] = useState(() => homeProvince(state.profile.onboarded ? state.profile.province : undefined));
  const [sel, setSel] = useState<Province>(start.p);
  const info = province(sel);
  const late = formsFor(sel, 'late-rent'), inc = formsFor(sel, 'rent-increase'), lease = formsFor(sel, 'lease');
  return (
    <section className="lp-sec" id="rules">
      <div className="lp-wrap">
        <SecHead kicker="Your province" title="Tap your province to see its forms." />
        <div className="lp-map reveal">
          <div className="lp-map-card">
            <div className="lp-tiles" role="radiogroup" aria-label="Province">
              {TILES.map(([p, c, r]) => <button key={p} role="radio" aria-checked={sel === p} aria-label={province(p).name} className={`lp-tile${sel === p ? ' on' : ''}`} style={{ gridColumn: c, gridRow: r }} onClick={() => setSel(p)}>{p}</button>)}
            </div>
            <p className="lp-map-hint"><Icon name="pin" size={16} />{start.guessed && sel === start.p ? <>Showing <strong>{info.name}</strong>, from your time zone</> : <>Selected: <strong>{info.name}</strong></>}</p>
          </div>
          <div className="lp-map-info" aria-live="polite">
            <div key={sel} className="lp-swap">
              <p className="lp-kicker">Rules set by: {info.tribunal}</p>
              <h3>{info.name}</h3>
              <dl>
                <dt>When rent is late</dt><dd>{late.length ? <ol>{late.map((f) => <li key={f.id}>{f.title} <code>{f.code}</code></li>)}</ol> : '—'}</dd>
                <dt>Raising the rent</dt><dd>{inc.length ? inc.map((f) => <span key={f.id}>{f.title} <code>{f.code}</code></span>) : '—'}{info.rentIncreaseGuidelinePct ? <span className="lp-dd-note">Most rents can go up {info.rentIncreaseGuidelinePct}% this year</span> : null}</dd>
                <dt>Lease</dt><dd>{lease.length ? lease.map((f) => <span key={f.id}>{f.title} <code>{f.code}</code></span>) : '—'}</dd>
              </dl>
              <a className="lp-arrow" href={AUTHORITY_URL[sel]} target="_blank" rel="noopener noreferrer">Official site</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ================================================================ Pricing
function Pricing({ start }: { start: () => void }) {
  const cents = useUnitPrice();
  return (
    <>
      <PageHead kicker="Pricing" icon="cash" title={<>Simple pricing. <em>Free to start.</em></>} aside={<Photo src={keysPhoto} alt="House keys next to a small model house on a table" className="aside" />}>Free for most use. Pay only for advanced features, and never without agreeing first.</PageHead>
      <section className="lp-sec lp-sec-top0">
        <div className="lp-wrap">
          <div className="lp-prices">
            <div className="lp-price reveal">
              <span className="lp-tile-ic big mint"><Icon name="home" size={22} /></span>
              <h3>Starter</h3>
              <p className="lp-amt">Free</p><p className="lp-per">For most landlords, free for good</p>
              <ul>{INCLUDED.map((t) => <li key={t}>{t}</li>)}</ul>
              <button className="btn lp-big" onClick={start} data-cta>Get started</button>
            </div>
            <div className="lp-price best reveal">
              <span className="lp-flag">Advanced</span>
              <span className="lp-tile-ic big lilac"><Icon name="users" size={22} /></span>
              <h3>Landlord</h3>
              <p className="lp-amt">{cents % 100 ? fmtPrice(cents) : <CountUp to={cents / 100} prefix="$" />}<span>per unit, a month</span></p><p className="lp-per">Advanced features, when you want them</p>
              <ul><li>Everything in Starter</li><li>Connect your banks: rent, bills and mortgage found for you</li><li>Check your bank any time</li><li>More than 2 properties</li><li>No card until card payments open: we ask first</li></ul>
              <button className="btn primary lp-big" onClick={start} data-cta>Get started</button>
            </div>
          </div>
          <div className="lp-trust-row lp-trust-under">
            {[['lock', 'View-only bank access'], ['check', 'You approve everything'], ['shield', 'Canadian privacy law (PIPEDA)'], ['heart', 'Plain words, large text']].map(([ic, t], i) => (
              <div key={t} className="lp-trust-item reveal" style={{ transitionDelay: `${i * 60}ms` }}><span className={`lp-tile-ic ${TONES[i]}`}><Icon name={ic} size={18} /></span>{t}</div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

/** What every plan includes: the plans differ only in how many units they cover. */
const INCLUDED = ['Rent tracking, PDF receipts and reminders', 'Expenses, receipt photos and statement uploads', "Your province's notices and forms", 'Tenant applications', 'Year-end summary and tax numbers (T776)', 'Up to 2 properties'];

// ================================================================ Questions
const FAQ: [string, string, string][] = [
  ['sparkle', 'What does Keyholder do automatically?', 'It checks your banks for rent and bills, writes receipts and reminders, files your costs and keeps your tax numbers up to date. Receipts and reminders go out with one tap, or automatically once you switch that on. Legal notices and choosing a tenant always need your approval.'],
  ['heart', "I'm new to being a landlord. Is this for me?", 'Yes. Keyholder is made for people with one or a few rentals, including a basement suite in your own home, where shared costs like heat are split for you. It explains each step in plain words.'],
  ['cash', 'What does it cost?', 'Nothing for most landlords: rent, receipts, reminders, expenses, statement uploads, notices, applications and taxes are free, for up to 2 properties. Advanced features (connecting your banks, more than 2 properties) are {price} per unit a month. No card is needed, and you are never charged without agreeing first.'],
  ['lock', 'Is my bank information safe?', 'Yes. Keyholder can only look at deposits and bills. It can never move money, and it never sees your bank password. You can also skip the bank and tap "Mark paid" yourself.'],
  ['bank', 'Which banks work?', 'RBC, TD, BMO, Scotiabank, CIBC, National Bank, Desjardins, Tangerine and most credit unions, view only (connecting banks is part of the Landlord plan). On the free plan, upload statements instead: PDF, CSV and more.'],
  ['star', 'What do Bronze, Silver and Gold mean?', 'Your property card gets more useful as you add details. Bronze needs only the rent. Silver adds what you paid, so you see your gain and how you compare with a GIC. Gold adds your mortgage and buying costs for full tax numbers. Every level is in both plans.'],
  ['info', 'Is this legal or tax advice?', 'No. Keyholder fills in forms and numbers for you, and you make the decisions. The first time you send a legal notice, it is a good idea to check with a paralegal. At tax time, an accountant can review your numbers.'],
  ['users', 'Can I try it first?', 'Yes. Most of Keyholder is free, and no card is needed. Add your place and see it work.'],
];
// ================================================================ Slow flowing lines behind the hero
// Thin wavy lines, twice the hero's width, drift sideways very slowly and loop without a seam (the waves repeat
// every 360 units and the drift is 1440, a whole number of waves). Two layers move at different speeds.
function wave(y: number, amp: number) {
  let d = `M0 ${y} q90 ${-amp} 180 0`;
  for (let x = 180; x < 2880; x += 180) d += ` t180 0`;
  return d;
}
const LINES_A = [[120, 26], [180, 34], [240, 22], [300, 30], [360, 18]].map(([y, a]) => wave(y, a));
const LINES_B = [[150, 40], [270, 36], [420, 28], [480, 44]].map(([y, a]) => wave(y, a));
const HeroLines = () => (
  <div className="lp-hero-bg" aria-hidden>
    <svg className="lp-lines a" viewBox="0 0 2880 600" preserveAspectRatio="none">{LINES_A.map((d, k) => <path key={k} d={d} />)}</svg>
    <svg className="lp-lines b" viewBox="0 0 2880 600" preserveAspectRatio="none">{LINES_B.map((d, k) => <path key={k} d={d} />)}</svg>
  </div>
);

