import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api, getConn, serverMode, setUser, useConn, type ServerUser } from '../data/api';
import { fmtDate } from '../lib/dates';
import { Drawer } from './ui';
import { Icon } from './Icon';
import { useConfirmIt } from './ConfirmIt';

// Two-step sign-in: after the password, fingerprint or face on this device (a passkey: Face ID, Touch ID,
// Windows Hello, Android), or a 6-digit code from an authenticator app (Google Authenticator, Microsoft
// Authenticator, 1Password…). Optional for landlords; required for the Keyholder team. Backup codes cover a lost
// phone. Live accounts only (the server keeps the keys).

const BIO_OFFER_KEY = 'kh_offer_bio';
const BIO_OFFER_NO = 'kh_offer_bio_no';
type RegOpts = Parameters<typeof startRegistration>[0]['optionsJSON'];
type AuthOpts = Parameters<typeof startAuthentication>[0]['optionsJSON'];

/** What this device calls it: Face ID on iPhone and iPad, Touch ID on a Mac, and so on. */
export const bioName = () => {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return /iPhone|iPad/.test(ua) ? 'Face ID' : /Macintosh/.test(ua) ? 'Touch ID' : /Android/.test(ua) ? 'fingerprint' : /Windows/.test(ua) ? 'Windows Hello' : 'fingerprint or face';
};

// Which fingerprint/face devices (passkey ids) and which accounts (emails) were added or used in this
// browser. A passkey lives on the device that made it, so sign-in leads with Face ID only where it is known to
// be; elsewhere it asks for a code once and offers Face ID for that device afterwards.
const HERE_KEY = 'kh_passkeys_here';
const EMAILS_KEY = 'kh_passkey_emails';
const readList = (k: string): string[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]'); } catch { return []; } };
const hereIds = () => readList(HERE_KEY);
/** Accounts that can sign in with Face ID on this device (newest last). */
export const passkeyEmails = () => readList(EMAILS_KEY);
export const rememberPasskeyHere = (id?: string, email?: string) => {
  try {
    if (id) localStorage.setItem(HERE_KEY, JSON.stringify([...new Set([...hereIds(), id])].slice(-10)));
    if (email) localStorage.setItem(EMAILS_KEY, JSON.stringify([...passkeyEmails().filter((e) => e !== email.toLowerCase()), email.toLowerCase()].slice(-5)));
  } catch { /* fine */ }
};

/** This device's kind, as the server names devices: iPhone, iPad, Mac, Windows, Android. */
export const deviceKind = () => { const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent; return (ua.match(/iPhone|iPad|Macintosh|Windows|Android/) ?? [''])[0].replace('Macintosh', 'Mac'); };

/** This browser can use fingerprint or face (WebAuthn). */
export const canUseBiometrics = () => typeof window !== 'undefined' && browserSupportsWebAuthn();

// Safari (iPhone, Mac) shows Face ID or Touch ID only straight after a tap: anything fetched from the server
// must be ready before the tap. So the options are fetched first, and the tap calls the prompt directly.
const fetchRegOpts = () => api<RegOpts>('POST', '/api/auth/passkey/register-options', {}).catch(() => null);
/** Tells the server what the device said when Face ID failed (for the logs; nothing personal). */
export const reportBio = (where: string, e: unknown) => { const x = e as Error; void api('POST', '/api/auth/client-log', { where, name: String(x?.name ?? 'Error').slice(0, 60), message: String(x?.message ?? '').slice(0, 300) }).catch(() => {}); };
/** Thrown when this device already has Face ID for the account (e.g. synced by iCloud Keychain): that is success. */
class AlreadyHere extends Error {}
async function finishAdd(opts: RegOpts): Promise<{ backupCodes: string[] | null; user: ServerUser }> {
  let response;
  try { response = await startRegistration({ optionsJSON: opts }); }
  catch (e) {
    reportBio('add', e);
    if ((e as Error).name === 'InvalidStateError') { const me = getConn().user; rememberPasskeyHere(undefined, me?.email); throw new AlreadyHere(`${bioName()} is already set up on this device. Next time, sign in with ${bioName()}.`); }
    throw new Error(`${bioName()} did not finish (${(e as Error).name}). Tap again to try once more.`);
  }
  const r = await api<{ backupCodes: string[] | null; user: ServerUser }>('POST', '/api/auth/passkey/register', { response });
  rememberPasskeyHere(response.id, r.user.email);
  return r;
}

/**
 * Adding Face ID on this device: options are fetched ahead; if the sign-in is not recent, "Confirm it's you"
 * comes first and the button then reads "Scan Face ID now" (a second tap, so Safari allows the prompt).
 */
function useAddDevice(reason: string, onAdded: (r: { backupCodes: string[] | null; user: ServerUser }) => void) {
  const [opts, setOpts] = useState<RegOpts | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Confirmed just now: the next tap opens Face ID (the button says so).
  const [armed, setArmed] = useState(false);
  const [confirm, confirmScreen] = useConfirmIt(reason);
  useEffect(() => { if (serverMode()) void fetchRegOpts().then(setOpts); }, []);
  const start = () => {
    setErr('');
    if (!opts) { void confirm(async () => { const o = await fetchRegOpts(); setOpts(o); setArmed(!!o); }, 'passkey'); return; }
    setArmed(false);
    setBusy(true);
    finishAdd(opts).then(onAdded).catch((x) => {
      if (x instanceof AlreadyHere) { const me = getConn().user; if (me) onAdded({ backupCodes: null, user: me }); setErr(''); return; }
      setErr((x as Error).message); void fetchRegOpts().then(setOpts);
    }).finally(() => setBusy(false));
  };
  return { start, busy, err, ready: !!opts, armed, confirmScreen };
}

/**
 * After signing in with a code on a phone or computer that can use fingerprint or face, a one-line offer:
 * "Use Face ID next time?". One tap adds it. "Not now" hides it on this device for good (Settings has it too).
 */
export function BioOffer() {
  const { user } = useConn();
  const [show, setShow] = useState(() => { try { return sessionStorage.getItem(BIO_OFFER_KEY) === '1' && localStorage.getItem(BIO_OFFER_NO) !== '1'; } catch { return false; } });
  const close = (never: boolean) => { try { sessionStorage.removeItem(BIO_OFFER_KEY); if (never) localStorage.setItem(BIO_OFFER_NO, '1'); } catch { /* fine */ } setShow(false); };
  if (!show || !user || !serverMode()) return null;
  return <BioOfferBar onClose={close} />;
}
function BioOfferBar({ onClose }: { onClose: (never: boolean) => void }) {
  const add = useAddDevice(`Before adding ${bioName()} on this device, confirm it is you.`, (r) => { setUser(r.user); onClose(false); });
  return (
    <div className="callout sky bio-offer" role="region" aria-label={bioName()} id="bio-offer">
      <Icon name="fingerprint" size={18} />
      <span style={{ flex: 1, minWidth: 180 }}><strong>Use {bioName()} next time?</strong> Sign in with just your email and {bioName()} on this device.{add.err && <span className="small acct-error" style={{ display: 'block' }}>{add.err}</span>}</span>
      <button className="btn primary small" id="bio-offer-yes" disabled={add.busy} onClick={add.start}>{add.busy ? 'Look at your device…' : add.armed ? `Now tap to scan ${bioName()}` : `Set up ${bioName()}`}</button>
      <button className="btn ghost small" id="bio-offer-no" onClick={() => onClose(true)}>Not now</button>
      {add.confirmScreen}
    </div>
  );
}

/** Asks for fingerprint or face to confirm it is you, with options fetched before the tap. */
async function authWith(opts: AuthOpts) {
  try { const a = await startAuthentication({ optionsJSON: opts }); rememberPasskeyHere(a.id); return a; }
  catch (e) { reportBio('confirm', e); throw new Error(`${bioName()} did not finish (${(e as Error).name}). Try again, or use a code.`); }
}

/** The second step of signing in, after the password (or Google) was right. */
export function TwoStepCode({ ticket, onSignedIn, onBack }: { ticket: string; onSignedIn: (u: ServerUser) => Promise<void> | void; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // "Remember this device": this browser skips the second step next time.
  const [remember, setRemember] = useState(false);
  // Which ways this account can do the second step, and the Face ID options (fetched before the tap).
  const [ways, setWays] = useState<{ passkey: boolean; app: boolean }>({ passkey: false, app: true });
  const [opts, setOpts] = useState<AuthOpts | null>(null);
  // Face ID leads only where it was added or used before; there, the code is one tap away.
  const [here, setHere] = useState(false);
  const [useCode, setUseCode] = useState(false);
  const load = () => api<{ options: AuthOpts | null; app: boolean; email?: string; kinds?: string[] }>('POST', '/api/auth/passkey/options', { ticket })
    .then((r) => {
      setOpts(r.options); setWays({ passkey: !!r.options && canUseBiometrics(), app: r.app });
      const mine = new Set(hereIds());
      // Here: used or added in this browser, or the account has it on this kind of device (a Mac with Touch ID).
      setHere(!!r.options?.allowCredentials?.some((c) => mine.has(c.id)) || (!!r.email && passkeyEmails().includes(r.email.toLowerCase())) || (!!deviceKind() && !!r.kinds?.includes(deviceKind())));
    }).catch(() => {});
  useEffect(() => { void load(); }, [ticket]);
  const biometric = () => {
    if (!opts) return;
    setBusy(true); setErr('');
    authWith(opts)
      .then(async (passkey) => { const r = await api<{ user: ServerUser }>('POST', '/api/auth/two-step', { ticket, passkey, trust: remember }); rememberPasskeyHere(undefined, r.user.email); await onSignedIn(r.user); })
      .catch((x) => { setErr((x as Error).message); setBusy(false); void load(); });
  };
  // No app and no Face ID on this device: a code by email (up to 3 per sign-in).
  const [mailed, setMailed] = useState('');
  const emailCode = async () => {
    setBusy(true); setErr('');
    try { const r = await api<{ sentTo: string }>('POST', '/api/auth/two-step/email', { ticket }); setMailed(r.sentTo); setCode(''); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!code.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ user: ServerUser }>('POST', '/api/auth/two-step', { ticket, code: code.trim(), trust: remember });
      // Signed in with a code on a device that could use fingerprint or face: offer it once inside the app.
      if (canUseBiometrics()) { try { sessionStorage.setItem(BIO_OFFER_KEY, '1'); } catch { /* no offer */ } }
      await onSignedIn(r.user);
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  const bioFirst = ways.passkey && here && !useCode;
  return (
    <form className="acct-login two-step-form" onSubmit={submit}>
      <div className="two-step-head"><span className="tile-ic lilac" aria-hidden><Icon name="lock" size={20} /></span>
        <div><strong>Confirm it's you</strong></div></div>
      {bioFirst ? <>
        <button type="button" className="btn primary acct-login-btn" id="ts-biometric" disabled={busy || !opts} onClick={biometric}><Icon name="fingerprint" size={18} />{busy ? 'Look at your device…' : `Use ${bioName()}`}</button>
        {err && <p className="small acct-error" role="alert">{err}</p>}
        <button type="button" className="link-btn small" id="ts-use-code" onClick={() => { setUseCode(true); setErr(''); }}>Use a code instead</button>
      </> : <>
        <label className="check" title="Skip this step on this browser next time. Not on a shared computer."><input id="ts-remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember this device</label>
        {ways.passkey && !here && <p className="small soft two-step-elsewhere" id="ts-elsewhere"><Icon name="fingerprint" size={14} /> One code here, then {bioName()} next time.</p>}
        {mailed && <p className="small callout pine" role="status" id="ts-mailed" style={{ margin: 0 }}><Icon name="mail" size={14} /> Code sent to {mailed}. It works for 10 minutes; check spam if it is not there.</p>}
        <div className="field"><label htmlFor="ts-code">{mailed ? 'Code from the email' : ways.app ? 'App, email or backup code' : 'Email or backup code'}</label>
          <input id="ts-code" className="input two-step-input" value={code} onChange={(e) => { setCode(e.target.value); setErr(''); }} inputMode="text" autoComplete="one-time-code" autoFocus placeholder="123 456" maxLength={12} /></div>
        {err && <p className="small acct-error" role="alert">{err}</p>}
        <button className="btn primary acct-login-btn" disabled={!code.trim() || busy}>{busy ? 'Checking…' : 'Continue'}</button>
        <button type="button" className="ts-alt" id="ts-email" disabled={busy} onClick={emailCode}><Icon name="mail" size={15} />{mailed ? 'Send another code' : 'Email me a code'}</button>
        {ways.passkey && here && <button type="button" className="ts-alt" onClick={() => setUseCode(false)}><Icon name="fingerprint" size={15} />Use {bioName()} instead</button>}
      </>}
      <button type="button" className="ts-back" onClick={onBack}><Icon name="back" size={14} />Back</button>
    </form>
  );
}

/** A phone or tablet (touch, no mouse): the QR code would have to be scanned by the same device. */
const phone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

/** Copies the setup key (without spaces) for pasting into the authenticator app. */
function CopyKey({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="btn small" id="ts-copy" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setDone(true)).catch(() => setDone(false)); }}><Icon name={done ? 'check' : 'paper'} size={14} />{done ? 'Copied' : 'Copy key'}</button>;
}

/** A QR code for the authenticator app to scan. */
function Qr({ text }: { text: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => { QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#111827', light: '#FFFFFF' } }).then(setSvg).catch(() => setSvg('')); }, [text]);
  return <div className="two-step-qr" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Backup codes, shown once: each works one time if the phone is lost. */
function BackupCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="two-step-codes">
      <p className="small" style={{ marginTop: 0 }}><strong>Save these backup codes</strong> somewhere safe (a password manager, or printed). Each works once if you lose your phone. You will not see them again.</p>
      <ol id="ts-backup">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ol>
      <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true)).catch(() => {}); }}><Icon name="paper" size={14} />{copied ? 'Copied' : 'Copy the codes'}</button>
    </div>
  );
}

/** Turning it on: scan the QR code, type the first code, keep the backup codes. */
export function TwoStepSetup({ onDone, team, appOnly }: { onDone: () => void; team?: boolean; appOnly?: boolean }) {
  const [way, setWay] = useState<'choose' | 'app'>(appOnly || !canUseBiometrics() ? 'app' : 'choose');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  // The account is updated once the backup codes are saved (so this screen stays until then).
  const [done, setDone] = useState<ServerUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const start = async () => {
    setBusy(true); setErr('');
    try { setSetup(await api<{ secret: string; uri: string }>('POST', '/api/auth/two-step/setup', {})); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const addDev = useAddDevice(`Before turning on ${bioName()} sign-in, confirm it is you.`, (r) => { if (r.backupCodes) { setCodes(r.backupCodes); setDone(r.user); } else { setUser(r.user); onDone(); } });
  const biometric = addDev.start;
  const confirmScreen = addDev.confirmScreen;
  const confirm = async (e: FormEvent) => {
    e.preventDefault(); if (!code.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ backupCodes: string[] | null; user: ServerUser }>('POST', '/api/auth/two-step/enable', { code: code.trim() });
      if (r.backupCodes) { setCodes(r.backupCodes); setDone(r.user); } else { setUser(r.user); onDone(); }
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  if (codes) return (
    <div className="two-step-setup">
      <p className="callout pine" role="status" style={{ marginTop: 0 }}><Icon name="check" size={16} /> Two-step sign-in is on. {team ? '' : setup ? 'Next time you sign in, Keyholder asks for a code from your app.' : 'Next time you sign in, Keyholder asks for your fingerprint or face.'}</p>
      <BackupCodes codes={codes} />
      <div className="btn-row" style={{ marginTop: 16 }}><button className="btn primary" id="ts-done" onClick={() => { if (done) setUser(done); onDone(); }}>I saved my backup codes</button></div>
    </div>
  );
  if (way === 'choose') return (
    <div className="two-step-setup">
      <p className="small" style={{ marginTop: 0 }}>Choose how to confirm it is you after your password. You can add the other one later.</p>
      <div className="two-step-ways">
        <button type="button" className="two-step-way" id="ts-way-bio" disabled={busy} onClick={biometric}>
          <Icon name="fingerprint" size={20} /><span><strong>Fingerprint or face</strong><span className="small soft">On this device: Face ID, Touch ID, Windows Hello or Android fingerprint. Fastest.</span></span>
        </button>
        <button type="button" className="two-step-way" id="ts-way-app" disabled={busy} onClick={() => setWay('app')}>
          <Icon name="lock" size={20} /><span><strong>Authenticator app</strong><span className="small soft">A 6-digit code from Google Authenticator, Microsoft Authenticator or 1Password. Works on any device.</span></span>
        </button>
      </div>
      {(busy || addDev.busy) && <p className="small soft" role="status">Look at your device…</p>}
      {(err || addDev.err) && <p className="small acct-error" role="alert">{err || addDev.err}</p>}
      {confirmScreen}
    </div>
  );
  if (!setup) return (
    <div className="two-step-setup">
      <ol className="two-step-steps">
        <li><strong>Get an authenticator app</strong> on your phone, if you don't have one: Google Authenticator, Microsoft Authenticator or 1Password all work.</li>
        <li>{phone() ? <><strong>Add Keyholder to it</strong> with one tap, or by pasting a key (next screen).</> : <><strong>Scan a QR code</strong> with it (next screen).</>}</li>
        <li><strong>Type the 6-digit code</strong> it shows, to confirm.</li>
      </ol>
      {err && <p className="small acct-error" role="alert">{err}</p>}
      <div className="btn-row"><button className="btn primary" id="ts-start" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start'}</button></div>
    </div>
  );
  return (
    <form className="two-step-setup" onSubmit={confirm}>
      {phone() ? (
        // On a phone the QR code cannot be scanned by the same phone: open the app directly, or paste the key.
        <div className="two-step-mobile" id="ts-mobile">
          <a className="btn primary" id="ts-open-app" href={setup.uri}><Icon name="phone" size={16} />Open in my authenticator app</a>
          <p className="small soft">Nothing happened? In your app choose <strong>Add</strong> (+), then <strong>Enter a setup key</strong>, and paste this key:</p>
          <div className="two-step-key-row"><code id="ts-secret" className="two-step-key">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code><CopyKey text={setup.secret} /></div>
          <p className="tiny soft">Then come back here for the 6-digit code.</p>
        </div>
      ) : (
        <div className="two-step-scan">
          <Qr text={setup.uri} />
          <div>
            <p className="small" style={{ marginTop: 0 }}>In your app, choose <strong>Add</strong> (+), then <strong>Scan a QR code</strong>.</p>
            <p className="small soft">Can't scan? Choose "Enter a setup key" and paste this key:</p>
            <div className="two-step-key-row"><code id="ts-secret" className="two-step-key">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code><CopyKey text={setup.secret} /></div>
            <p className="tiny soft">On your phone? <a href={setup.uri} id="ts-open-app">Open in your authenticator app</a>.</p>
          </div>
        </div>
      )}
      <div className="field"><label htmlFor="ts-setup-code">6-digit code from the app</label>
        <input id="ts-setup-code" className="input two-step-input" value={code} onChange={(e) => { setCode(e.target.value); setErr(''); }} inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" maxLength={7} autoFocus /></div>
      {err && <p className="small acct-error" role="alert">{err}</p>}
      <div className="btn-row"><button className="btn primary" id="ts-confirm" disabled={!code.trim() || busy}>{busy ? 'Checking…' : 'Turn on'}</button></div>
    </form>
  );
}

/** A current code (or backup code) for turning it off or getting new backup codes. */
function CodeAction({ title, button, path, danger, onClose }: { title: string; button: string; path: string; danger?: boolean; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { user } = useConn();
  const bio = !!user?.passkeys && canUseBiometrics();
  const [opts, setOpts] = useState<AuthOpts | null>(null);
  const loadOpts = () => api<{ options: AuthOpts | null }>('POST', '/api/auth/passkey/options', {}).then((r) => setOpts(r.options)).catch(() => {});
  useEffect(() => { if (bio) void loadOpts(); }, [bio]);
  const send = async (body: object) => {
    setBusy(true); setErr('');
    try {
      const r = await api<{ user: ServerUser; backupCodes?: string[] }>('POST', path, body);
      setUser(r.user);
      if (r.backupCodes) setCodes(r.backupCodes); else onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const go = (e: FormEvent) => { e.preventDefault(); if (code.trim() && !busy) void send({ code: code.trim() }); };
  const withBio = () => {
    if (!opts) return;
    setBusy(true); setErr('');
    authWith(opts).then((passkey) => send({ passkey })).catch((x) => { setErr((x as Error).message); setBusy(false); void loadOpts(); });
  };
  return (
    <Drawer title={title} onClose={onClose}>
      {codes ? <><BackupCodes codes={codes} /><div className="btn-row" style={{ marginTop: 16 }}><button className="btn primary" onClick={onClose}>I saved my backup codes</button></div></> : (
        <form onSubmit={go}>
          {bio && <><button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} id="ts-act-bio" disabled={busy} onClick={withBio}><Icon name="fingerprint" size={16} />{button} with fingerprint or face</button>
            <div className="acct-or"><span>or type a code</span></div></>}
          <div className="field"><label htmlFor="ts-act-code">{user?.twoStepApp ? 'Code from your app (or a backup code)' : 'Backup code'}</label>
            <input id="ts-act-code" className="input two-step-input" value={code} onChange={(e) => { setCode(e.target.value); setErr(''); }} autoComplete="one-time-code" autoFocus maxLength={12} /></div>
          {err && <p className="small acct-error" role="alert">{err}</p>}
          <div className="btn-row"><button className={`btn ${danger && !bio ? 'danger' : bio ? '' : 'primary'}`} disabled={!code.trim() || busy}>{button}</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
        </form>
      )}
    </Drawer>
  );
}

/** Settings → Two-step sign-in. */
type Device = { id: string; name: string; added: string; lastUsed: string | null };

/** Fingerprint or face: the devices on the account, add this one, remove one. */
function Devices({ user }: { user: ServerUser }) {
  const [list, setList] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const load = () => api<Device[]>('GET', '/api/auth/passkeys').then(setList).catch(() => setList([]));
  useEffect(() => { void load(); }, [user.passkeys]);
  // Adding or removing a device: confirm it is you first (unless you signed in in the last 10 minutes).
  const [confirm, confirmScreen] = useConfirmIt(`Before changing ${bioName()} sign-in, confirm it is you.`);
  const addDev = useAddDevice(`Before adding ${bioName()} on this device, confirm it is you.`, (r) => { setUser(r.user); if (r.backupCodes) setCodes(r.backupCodes); void load(); });
  const remove = (id: string) => confirm(async () => {
    setBusy(true); setErr('');
    try { const r = await api<{ user: ServerUser }>('POST', '/api/auth/passkey/remove', { id }); setUser(r.user); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }, 'passkey');
  return (
    <div className="two-step-part" id="ts-devices">
      <strong>Fingerprint or face</strong>
      {list && list.length > 0 ? (
        <ul className="two-step-devices">{list.map((d) => (
          <li key={d.id} className="spread"><span><Icon name="fingerprint" size={14} /> {d.name || 'Device'}<span className="tiny soft"> · added {fmtDate(d.added)}{d.lastUsed ? ` · last used ${fmtDate(d.lastUsed)}` : ''}</span></span>
            <button className="btn small ghost" disabled={busy} onClick={() => remove(d.id)}>Remove</button></li>))}</ul>
      ) : <div className="small soft">No device yet.</div>}
      {canUseBiometrics()
        ? <button className="btn small" id="ts-add-device" disabled={busy || addDev.busy} onClick={addDev.start}><Icon name="plus" size={14} />{addDev.busy ? 'Look at your device…' : addDev.armed ? `Now tap to scan ${bioName()}` : `Add ${bioName()} on this device`}</button>
        : <div className="tiny soft">This browser cannot use fingerprint or face.</div>}
      {(err || addDev.err) && <p className="small acct-error" role="alert">{err || addDev.err}</p>}
      {confirmScreen}{addDev.confirmScreen}
      {codes && <Drawer title="Two-step sign-in is on" onClose={() => setCodes(null)}><BackupCodes codes={codes} /><div className="btn-row" style={{ marginTop: 16 }}><button className="btn primary" id="ts-done" onClick={() => setCodes(null)}>I saved my backup codes</button></div></Drawer>}
    </div>
  );
}

type Remembered = { id: string; name: string; added: string; lastUsed: string | null; thisDevice: boolean };

/** Browsers that skip the second step (chosen with "Remember this device?" at sign-in). */
function RememberedDevices() {
  const [list, setList] = useState<Remembered[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<Remembered[]>('GET', '/api/auth/devices').then(setList).catch(() => setList([]));
  useEffect(() => { void load(); }, []);
  const forget = async (body: object) => { setBusy(true); try { await api('POST', '/api/auth/devices/forget', body); await load(); } finally { setBusy(false); } };
  return (
    <div className="two-step-part" id="ts-remembered">
      <div className="spread" style={{ width: '100%' }}><strong>Remembered devices</strong>
        {list && list.length > 1 && <button className="btn small ghost" disabled={busy} onClick={() => forget({ all: true })}>Forget all</button>}</div>
      {list && list.length > 0 ? (
        <ul className="two-step-devices">{list.map((d) => (
          <li key={d.id} className="spread"><span><Icon name="phone" size={14} /> {d.name}{d.thisDevice && <span className="tag">This device</span>}<span className="tiny soft"> · {d.lastUsed ? `last used ${fmtDate(d.lastUsed)}` : `added ${fmtDate(d.added)}`}</span></span>
            <button className="btn small ghost" disabled={busy} onClick={() => forget({ id: d.id })}>Forget</button></li>))}</ul>
      ) : <div className="small soft">None. After two-step sign-in, choose "Yes, remember this device" to skip it next time on that browser.</div>}
    </div>
  );
}

export function TwoStepSettings() {
  const { user, config } = useConn();
  const [open, setOpen] = useState<'setup' | 'app' | 'off' | 'codes' | 'devices' | 'remembered' | null>(null);
  const [remembered, setRemembered] = useState<number | null>(null);
  const live = serverMode() && !!user && !!config?.twoStep;
  useEffect(() => { if (live && user?.twoStep && !open) api<unknown[]>('GET', '/api/auth/devices').then((l) => setRemembered(l.length)).catch(() => {}); }, [live, user?.twoStep, open]);
  if (!serverMode() || !user) return <span className="pref-note">With your Keyholder account online: fingerprint or face, or an app code.</span>;
  if (!config?.twoStep) return <span className="pref-note">Not available yet.</span>;
  const team = user.role !== 'owner';
  const bio = user.passkeys ?? 0;
  const left = user.backupCodesLeft ?? 0;
  const close = () => setOpen(null);
  return (
    <>
      {user.twoStep ? <>
        <span className="chip on" title={user.twoStepSince ? `On since ${fmtDate(user.twoStepSince)}` : 'On'}><Icon name="check" size={14} />On</span>
        <button className="chip" id="ts-chip-bio" title="Fingerprint or face on your devices" onClick={() => setOpen('devices')}><Icon name="fingerprint" size={15} />{bio ? `Face/finger · ${bio}` : 'Add face/finger'}</button>
        <button className="chip" id="ts-chip-app" title={user.twoStepApp ? 'Authenticator app: set up' : 'Add an authenticator app'} onClick={() => setOpen('app')}><Icon name="phone" size={15} />{user.twoStepApp ? 'App' : 'Add app'}</button>
        <button className="chip" id="ts-chip-codes" title={`${left} backup code${left === 1 ? '' : 's'} left · get new ones`} onClick={() => setOpen('codes')}><Icon name="key" size={15} />Backup · {left}</button>
        <button className="chip" id="ts-chip-remembered" title="Browsers that skip the second step" onClick={() => setOpen('remembered')}><Icon name="laptop" size={15} />Remembered{remembered !== null ? ` · ${remembered}` : ''}</button>
        {!team && <button className="chip icon-only" id="ts-off" title="Turn off two-step sign-in" aria-label="Turn off two-step sign-in" onClick={() => setOpen('off')}><Icon name="close" size={14} /></button>}
      </> : <>
        <span className="chip off">Off</span>
        <button className="chip primary" id="ts-turn-on" onClick={() => setOpen('setup')}><Icon name="lock" size={14} />Turn on</button>
      </>}
      {open === 'devices' && <Drawer title="Fingerprint or face" onClose={close}><Devices user={user} /></Drawer>}
      {open === 'remembered' && <Drawer title="Remembered devices" onClose={close}><RememberedDevices /></Drawer>}
      {open === 'app' && <Drawer title="Authenticator app" onClose={close}>{user.twoStepApp
        ? <p className="small" id="ts-app" style={{ marginTop: 0 }}><Icon name="check" size={14} /> Set up. Use its 6-digit code on any device.</p>
        : <TwoStepSetup appOnly onDone={close} />}</Drawer>}
      {open === 'setup' && <Drawer title="Turn on two-step sign-in" onClose={close}><TwoStepSetup onDone={close} /></Drawer>}
      {open === 'off' && <CodeAction title="Turn off two-step sign-in" button="Turn off" path="/api/auth/two-step/disable" danger onClose={close} />}
      {open === 'codes' && <CodeAction title={`New backup codes (${left} left)`} button="Show new codes" path="/api/auth/two-step/backup-codes" onClose={close} />}
    </>
  );
}

/** The support dashboard: the Keyholder team sets up two-step sign-in before anything else. */
export function TeamTwoStepGate({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="acct-page">
      <div className="acct-card">
        <h1>Set up two-step sign-in</h1>
        <p className="soft">The Keyholder team signs in with a password and a second step: fingerprint or face, or a code from an authenticator app. It protects every landlord's information. It takes two minutes.</p>
        <TwoStepSetup team onDone={() => {}} />
        <button className="btn ghost small" style={{ marginTop: 16 }} onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

/** True when a signed-in landlord could turn it on (for Home's set-up steps). */
export const twoStepToOffer = (user: ServerUser | null, on: boolean | undefined) => serverMode() && !!on && !!user && user.role === 'owner' && !user.twoStep;
