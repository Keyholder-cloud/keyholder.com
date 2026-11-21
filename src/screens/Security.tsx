import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';

// Security & privacy: how Keyholder handles landlords' and tenants' information and bank data (through Plaid),
// in plain words. Written from what the app and server actually do; keep it true when either changes.
// Plaid asks every app that uses it for: notice and consent before connecting a bank, a link to Plaid's End
// User Privacy Policy, encryption in transit and at rest, a retention and deletion policy, no selling of
// consumer data, incident handling, and a way to reach the company. Each of those has a section here.

export const PRIVACY_EMAIL = 'admin@keyholder.cloud';
export const PLAID_PRIVACY_URL = 'https://plaid.com/legal/#end-user-privacy-policy';
const UPDATED = 'November 20, 2026';

type Part = { id: string; icon: string; tone: string; title: string; body: React.ReactNode };

const PARTS: Part[] = [
  {
    id: 'glance', icon: 'sparkle', tone: 'lilac', title: 'At a glance',
    body: (
      <ul>
        <li>Your bank connects through <strong>Plaid</strong>. You sign in at your bank in Plaid's window; Keyholder never sees your bank password.</li>
        <li>Bank access is <strong>view only</strong>. Keyholder cannot move money, make payments or change anything at your bank.</li>
        <li>Keyholder uses your information only to run your rentals for you. We <strong>never sell</strong> it and never use it for advertising.</li>
        <li>Everything travels encrypted, and bank connection keys are encrypted again where we store them.</li>
        <li>You can disconnect a bank, download your data or delete your account at any time, from Settings.</li>
      </ul>
    ),
  },
  {
    id: 'bank', icon: 'bank', tone: 'mint', title: 'Bank connections through Plaid',
    body: (
      <>
        <p>Keyholder uses Plaid Inc. ("Plaid") to read transactions from the bank accounts you choose. Before Plaid opens, Keyholder tells you what it will see and asks you to continue. By connecting, you allow Plaid to collect your bank data and share it with Keyholder, as described in <a href={PLAID_PRIVACY_URL} target="_blank" rel="noopener noreferrer">Plaid's End User Privacy Policy</a>.</p>
        <h3>What Keyholder receives</h3>
        <ul>
          <li>The bank's name, and each account's name and last four digits.</li>
          <li>Transactions: date, amount, and the description (for deposits, usually the sender's name). The first connection reads the last 90 days; after that, new transactions as your bank reports them.</li>
        </ul>
        <h3>What Keyholder never receives or does</h3>
        <ul>
          <li>Your bank username, password or security answers.</li>
          <li>The ability to move money, pay bills or open accounts.</li>
        </ul>
        <h3>What it is used for</h3>
        <p>Spotting rent from your tenants and marking it paid, sorting bills (insurance, utilities, mortgage payments) into your expenses, and your tax summaries. Nothing else.</p>
        <h3>Disconnecting</h3>
        <p>Settings → Disconnect stops new data at once, and Keyholder asks Plaid to remove the connection. Transactions already brought in stay in your records (they are your bookkeeping) until you delete them or your account.</p>
      </>
    ),
  },
  {
    id: 'collect', icon: 'paper', tone: 'sky', title: 'What we collect and why',
    body: (
      <ul>
        <li><strong>Your account:</strong> name, email, and a password stored only as a one-way scrambled code (or your Google sign-in). To sign you in and contact you about your account.</li>
        <li><strong>Your rentals:</strong> properties, units, tenants' names and contact details, leases, rent payments, receipts, notices and expenses that you enter. To run your rentals: receipts, reminders, notices and taxes.</li>
        <li><strong>Receipt photos:</strong> read on your own device to fill in an expense; the picture is kept with that expense in your account.</li>
        <li><strong>Bank data:</strong> as described above, only for the banks you connect.</li>
        <li><strong>Security records:</strong> sign-ins, important changes and the network address they came from, to protect your account and investigate problems.</li>
        <li><strong>Messages to us:</strong> what you write to support, to answer you.</li>
      </ul>
    ),
  },
  {
    id: 'never', icon: 'lock', tone: 'rose', title: 'What we never do',
    body: (
      <ul>
        <li>Sell or rent personal information, including bank data, to anyone.</li>
        <li>Use bank data for advertising, credit decisions or anything other than the service you asked for.</li>
        <li>Share your information except with the service providers listed below, to run Keyholder, or when the law requires it.</li>
      </ul>
    ),
  },
  {
    id: 'consent', icon: 'check', tone: 'sun', title: 'Your consent and choices',
    body: (
      <ul>
        <li>We ask before connecting a bank, and you choose which accounts to share.</li>
        <li>Disconnect any bank in Settings, at any time.</li>
        <li><strong>Download my data</strong> (Settings) gives you a copy of everything in your account.</li>
        <li><strong>Delete my account</strong> (Settings) removes your bank connections at Plaid and deletes your account and its data.</li>
        <li>You can withdraw consent at any time; some features (like spotting rent automatically) stop working without it.</li>
      </ul>
    ),
  },
  {
    id: 'retention', icon: 'calendar', tone: 'peach', title: 'How long we keep information',
    body: (
      <>
        <p>We keep your information while your account is open, because it is your rental record. When you delete your account:</p>
        <ul>
          <li>your bank connections are removed at Plaid, and your account, rentals, tenants, payments, bank transactions and support messages are deleted right away;</li>
          <li>security and email records are kept without your details (names, email addresses, network addresses and message text are erased);</li>
          <li>copies in our hosting provider's backups are overwritten on its schedule.</li>
        </ul>
        <p>Canada Revenue Agency asks landlords to keep rental records for six years. Download your data before deleting your account if you still need it.</p>
      </>
    ),
  },
  {
    id: 'protect', icon: 'lock', tone: 'lilac', title: 'How we protect information',
    body: (
      <ul>
        <li><strong>Encrypted in transit:</strong> every page and connection uses HTTPS (TLS 1.2 or newer), and browsers are told to use HTTPS only.</li>
        <li><strong>Encrypted at rest:</strong> bank connection keys and service keys are encrypted with AES-256 before they are stored, with a key kept apart from the database.</li>
        <li><strong>Passwords:</strong> stored only as scrypt hashes, never in a readable form. Sign-in attempts are limited to stop guessing.</li>
        <li><strong>Two-step sign-in:</strong> after their password, landlords can use their fingerprint or face (passkeys: Face ID, Touch ID, Windows Hello, Android) or a code from an authenticator app, with backup codes (Settings); the Keyholder team must use it.</li>
        <li><strong>Sessions:</strong> secure, http-only cookies; every change must come from the Keyholder app itself.</li>
        <li><strong>Plaid messages</strong> are checked to be really from Plaid (signed and recent) before they are used.</li>
        <li><strong>Access:</strong> only people who run Keyholder can reach production systems, each with their own sign-in; support can open an account read-only to help you, and every such view and team action is recorded.</li>
        <li><strong>Page protections:</strong> a strict content security policy, no framing by other sites, and request limits on every part of the service.</li>
        <li><strong>Changes:</strong> every change is tested automatically before it goes live.</li>
      </ul>
    ),
  },
  {
    id: 'incidents', icon: 'bell', tone: 'rose', title: 'If something goes wrong',
    body: (
      <p>If we learn of a security incident, we act at once to contain it and find out what happened. If personal information is involved and there is a real risk of significant harm, we tell the people affected and the Office of the Privacy Commissioner of Canada as soon as possible, as Canadian privacy law requires, and we keep a record of every breach for at least two years. Incidents that involve bank data are also reported to Plaid.</p>
    ),
  },
  {
    id: 'providers', icon: 'user', tone: 'mint', title: 'Service providers',
    body: (
      <>
        <p>We use a few companies to run Keyholder. Each gets only what it needs and must protect it.</p>
        <ul>
          <li><strong>Plaid</strong>: bank connections (see above).</li>
          <li><strong>Render</strong>: hosts the website, app and database. Information may be stored and processed in the United States.</li>
          <li><strong>Our email provider</strong>: delivers receipts, reminders and account emails.</li>
          <li><strong>Google</strong>: only if you choose "Sign in with Google", and for address suggestions when you type an address.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'tenants', icon: 'home', tone: 'sky', title: "Your tenants' information",
    body: (
      <p>Landlords add their tenants' names and contact details. Keyholder uses them only to send the receipts, reminders and notices the landlord sends or approves. Landlords are responsible for having their tenants' permission to share this information and to receive notices by email. Tenants can ask their landlord, or us, for access to or correction of their information.</p>
    ),
  },
  {
    id: 'rights', icon: 'map', tone: 'sun', title: 'Your privacy rights',
    body: (
      <>
        <p>Keyholder follows Canada's Personal Information Protection and Electronic Documents Act (PIPEDA). You can ask to see the personal information we hold about you, have it corrected, or withdraw your consent. We answer within 30 days.</p>
        <p>Our privacy officer: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>. If you are not satisfied with our answer, you can contact the <a href="https://www.priv.gc.ca/" target="_blank" rel="noopener noreferrer">Office of the Privacy Commissioner of Canada</a>.</p>
      </>
    ),
  },
  {
    id: 'terms', icon: 'paper', tone: 'peach', title: 'Terms of use',
    body: (
      <ul>
        <li>Keyholder prepares documents and information. It does not give legal or tax advice, file returns, or hold or move money. You decide and sign; check important steps with a professional.</li>
        <li>You are responsible for keeping your sign-in safe and for the information you enter, including having the right to add your tenants' information.</li>
        <li>Do not use Keyholder for anything unlawful, to harass tenants, or to try to break or overload the service.</li>
        <li>You can stop using Keyholder and delete your account at any time. We can suspend accounts that break these terms.</li>
        <li>We will tell you before important changes to these terms or this page take effect.</li>
      </ul>
    ),
  },
  {
    id: 'report', icon: 'bell', tone: 'lilac', title: 'Report a security issue',
    body: (
      <p>Found something that looks like a security problem? Write to <a href={`mailto:${PRIVACY_EMAIL}?subject=Security%20issue`}>{PRIVACY_EMAIL}</a> with what you found and how to reproduce it. Please do not access other people's data or disrupt the service while testing. We aim to reply within two business days.</p>
    ),
  },
];

/** The Security & privacy page of the website: one page, a contents list, a card per topic. */
export function SecurityPage() {
  // "#/welcome/security#bank": open at that topic (also when a footer link is used on this page).
  const loc = useLocation();
  useEffect(() => { const h = loc.hash.replace('#', ''); if (h && PARTS.some((p) => p.id === h)) requestAnimationFrame(() => document.getElementById(h)?.scrollIntoView({ block: 'start' })); }, [loc.hash]);
  const jump = (id: string) => (e: React.MouseEvent) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return (
    <>
      <section className="lp-pagehead">
        <div className="lp-wrap">
          <div className="reveal">
            <p className="lp-pill"><Icon name="lock" size={16} />Security &amp; privacy</p>
            <h1 className="lp-h1">Your information, <em>handled with care.</em></h1>
            <p className="lp-lede">How Keyholder protects your rentals, your tenants' details and your bank data, in plain words.</p>
            <p className="lp-doc-meta">Last updated {UPDATED} · Questions: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a></p>
          </div>
        </div>
      </section>
      <section className="lp-sec lp-sec-top0">
        <div className="lp-wrap lp-doc-grid">
          <nav className="lp-toc" aria-label="On this page">
            <p className="lp-kicker">On this page</p>
            <ol>{PARTS.map((p) => <li key={p.id}><a href={`#${p.id}`} onClick={jump(p.id)}>{p.title}</a></li>)}</ol>
          </nav>
          <div className="lp-doc">
            {PARTS.map((p) => (
              <article key={p.id} id={p.id} className="lp-doc-part" aria-labelledby={`${p.id}-h`}>
                <h2 id={`${p.id}-h`}><span className={`lp-tile-ic ${p.tone}`} aria-hidden><Icon name={p.icon} size={18} /></span>{p.title}</h2>
                <div className="lp-doc-body">{p.body}</div>
              </article>
            ))}
            <p className="lp-doc-foot">Ready when you are: <Link to="/start">create a free account</Link>, or go back to the <Link to="/welcome">overview</Link>.</p>
          </div>
        </div>
      </section>
    </>
  );
}
