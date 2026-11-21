import { api } from './api';

// Plaid's bank sign-in window (Plaid Link), loaded from Plaid only when a landlord connects a bank.
// The landlord signs in at their bank inside Plaid's window; Keyholder never sees the bank password.

type Handler = { open: () => void; destroy: () => void };
type LinkError = { display_message?: string | null; error_message?: string | null; error_code?: string | null; error_type?: string | null };
type ExitMeta = { request_id?: string; link_session_id?: string; status?: string | null; institution?: { name?: string; institution_id?: string } | null };
type PlaidGlobal = { create: (o: { token: string; receivedRedirectUri?: string; onSuccess: (publicToken: string, meta: { institution?: { name?: string; institution_id?: string } | null }) => void; onExit: (err: LinkError | null, meta?: ExitMeta) => void }) => Handler };
declare global { interface Window { Plaid?: PlaidGlobal } }

let loading: Promise<PlaidGlobal> | null = null;
function loadLink(): Promise<PlaidGlobal> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.async = true;
    s.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error('The bank window did not load.')));
    s.onerror = () => { loading = null; reject(new Error('The bank window did not load. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return loading;
}

// Banks that sign in on their own site (OAuth: RBC, TD, Scotiabank…) leave Keyholder and come back to
// /plaid-oauth; the same Link session then carries on there. What it needs is kept here until then.
const OAUTH_KEY = 'kh-plaid-oauth';
type Pending = { linkToken: string; itemId?: string; at: number };
const keep = (p: Pending | null) => { try { if (p) localStorage.setItem(OAUTH_KEY, JSON.stringify(p)); else localStorage.removeItem(OAUTH_KEY); } catch { /* private window */ } };
const kept = (): Pending | null => { try { const p = JSON.parse(localStorage.getItem(OAUTH_KEY) ?? 'null') as Pending | null; return p && Date.now() - p.at < 30 * 60_000 ? p : null; } catch { return null; } };

/** Plaid's window closed with a problem: its exact code goes to Keyholder support (and the landlord sees why). */
function report(err: LinkError, meta?: ExitMeta) {
  void api('POST', '/api/bank/link-error', {
    error_code: err.error_code ?? null, error_type: err.error_type ?? null, error_message: err.error_message ?? null, display_message: err.display_message ?? null,
    request_id: meta?.request_id ?? null, link_session_id: meta?.link_session_id ?? null, institution: meta?.institution?.name ?? null, status: meta?.status ?? null,
  }).catch(() => {});
}
const why = (err: LinkError) => {
  const base = err.display_message || err.error_message || 'The bank sign-in did not finish.';
  return err.error_code ? `${base} (${err.error_code}). Keyholder support can see the details.` : base;
};

function run(Plaid: PlaidGlobal, linkToken: string, itemId: string | undefined, receivedRedirectUri?: string): Promise<{ bank: string; added: number } | null> {
  if (!receivedRedirectUri) keep({ linkToken, itemId, at: Date.now() });
  return new Promise((resolve, reject) => {
    const h = Plaid.create({
      token: linkToken, ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
      onSuccess: (publicToken, meta) => {
        h.destroy(); keep(null);
        // Signing in again keeps the same connection: just read what is new.
        if (itemId) { api<{ added: number }>('POST', '/api/bank/sync').then((r) => resolve({ bank: meta.institution?.name ?? 'Your bank', added: r.added }), reject); return; }
        api<{ bank: string; added: number }>('POST', '/api/bank/exchange', { publicToken, institution: meta.institution ?? null }).then(resolve, reject);
      },
      onExit: (err, meta) => { h.destroy(); keep(null); if (err) { report(err, meta); reject(new Error(why(err))); } else resolve(null); },
    });
    h.open();
  });
}

/** Back from the bank's own sign-in page (/plaid-oauth): carry on the same Link session. Null when not. */
export async function resumePlaidOAuth(): Promise<{ bank: string; added: number } | null | undefined> {
  if (window.location.pathname !== '/plaid-oauth') return undefined;
  const p = kept();
  const href = window.location.href;
  window.history.replaceState(null, '', `/${window.location.hash}`);
  if (!p) throw new Error('The bank sign-in took too long. Please connect your bank again.');
  return run(await loadLink(), p.linkToken, p.itemId, href);
}

/**
 * Connect a bank (or, with itemId, sign in again to one). Resolves with the bank's name when done, or null if
 * the landlord closed the window.
 */
export async function connectWithPlaid(itemId?: string): Promise<{ bank: string; added: number } | null> {
  const [{ linkToken }, Plaid] = await Promise.all([api<{ linkToken: string }>('POST', '/api/bank/link-token', itemId ? { itemId } : {}), loadLink()]);
  return run(Plaid, linkToken, itemId);
}
