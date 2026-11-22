import { useState, type FormEvent, type ReactNode } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, serverMode } from '../data/api';
import { Drawer } from './ui';
import { Icon } from './Icon';
import { GoogleG } from './GoogleG';

// "Confirm it's you" before a sensitive change (adding or removing fingerprint/face, clearing all data).
// Signing in counts for 10 minutes; after that the landlord confirms once more, their usual way first:
// password, Google (a round trip to Google that comes back to Settings), fingerprint or face on this device,
// or a code from their authenticator app. The server checks it too, so skipping this screen does not help.

type Ways = { password: boolean; google: boolean; passkey: boolean; app: boolean };
/** What to reopen after the Google round trip (Settings reads it on return). */
export const PENDING_KEY = 'kh_after_confirm';
export type PendingAction = 'passkey' | 'clear';

const canBio = () => typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';

/**
 * Returns `confirm(run, pending)` and the screen to render. `confirm` runs `run` at once when the sign-in is
 * fresh (or in the browser-only preview); otherwise it asks first, then runs it.
 */
export function useConfirmIt(reason: string): [(run: () => void | Promise<void>, pending: PendingAction) => Promise<void>, ReactNode] {
  const [ask, setAsk] = useState<{ ways: Ways; run: () => void | Promise<void>; pending: PendingAction } | null>(null);
  const confirm = async (run: () => void | Promise<void>, pending: PendingAction) => {
    if (!serverMode()) return void (await run());
    const r = await api<{ fresh: boolean; ways: Ways }>('GET', '/api/auth/confirm').catch(() => null);
    if (r?.fresh) return void (await run());
    setAsk({ ways: r?.ways ?? { password: true, google: false, passkey: false, app: false }, run, pending });
  };
  const screen = ask && <ConfirmItScreen reason={reason} ways={ask.ways} pending={ask.pending} onClose={() => setAsk(null)} onDone={async () => { const run = ask.run; setAsk(null); await run(); }} />;
  return [confirm, screen];
}

function ConfirmItScreen({ reason, ways, pending, onClose, onDone }: { reason: string; ways: Ways; pending: PendingAction; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async (body: object) => {
    setBusy(true); setErr('');
    try { await api('POST', '/api/auth/confirm', body); await onDone(); } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault(); if (busy) return;
    if (password) void send({ password }); else if (code.trim()) void send({ code: code.trim() });
  };
  const google = () => {
    try { sessionStorage.setItem(PENDING_KEY, pending); } catch { /* still works, without reopening */ }
    window.location.href = '/api/auth/google/start?intent=verify';
  };
  const bio = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON'] | null }>('POST', '/api/auth/passkey/options', {});
      if (!r.options) throw new Error('No fingerprint or face is set up for this account.');
      let passkey;
      try { passkey = await startAuthentication({ optionsJSON: r.options }); } catch { throw new Error('Fingerprint or face was cancelled, or is not set up on this device. Use another way below.'); }
      await api('POST', '/api/auth/confirm', { passkey }); await onDone();
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  // The landlord's usual way leads: Google for Google accounts, else the password.
  const googleFirst = ways.google && !ways.password;
  return (
    <Drawer title="Confirm it's you" onClose={onClose}>
      <form onSubmit={submit} className="confirm-it" id="confirm-it">
        <p className="small" style={{ marginTop: 0 }}>{reason}</p>
        {googleFirst && <button type="button" className="btn primary acct-google" id="ci-google" onClick={google} disabled={busy}><GoogleG />Continue with Google</button>}
        {ways.password && <>
          <div className="field"><label htmlFor="ci-pass">Your Keyholder password</label>
            <input id="ci-pass" type="password" className="input" value={password} autoComplete="current-password" autoFocus onChange={(e) => { setPassword(e.target.value); setCode(''); setErr(''); }} /></div>
          <button className="btn primary" id="ci-go" disabled={!password || busy}>{busy ? 'Checking…' : 'Confirm'}</button>
        </>}
        {!googleFirst && ways.google && <button type="button" className="btn acct-google" id="ci-google" onClick={google} disabled={busy}><GoogleG />Continue with Google</button>}
        {(ways.passkey && canBio()) || ways.app ? <div className="acct-or"><span>or</span></div> : null}
        {ways.passkey && canBio() && <button type="button" className="btn" id="ci-bio" onClick={bio} disabled={busy}><Icon name="fingerprint" size={16} />Fingerprint or face</button>}
        {ways.app && <>
          <div className="field"><label htmlFor="ci-code">Code from your authenticator app</label>
            <input id="ci-code" className="input two-step-input" inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={code} onChange={(e) => { setCode(e.target.value); setPassword(''); setErr(''); }} /></div>
          {!ways.password && <button className="btn primary" disabled={!code.trim() || busy}>Confirm</button>}
          {ways.password && code.trim() && <button className="btn" disabled={busy}>Confirm with the code</button>}
        </>}
        {err && <p className="small acct-error" role="alert">{err}</p>}
        <p className="tiny soft" style={{ marginBottom: 0 }}>Asked once; it lasts 10 minutes.</p>
      </form>
    </Drawer>
  );
}
