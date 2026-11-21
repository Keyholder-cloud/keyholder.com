import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { api, serverMode, setUser, useConn, type ServerUser } from '../data/api';
import { fmtDate } from '../lib/dates';
import { Drawer } from './ui';
import { Icon } from './Icon';

// Two-step sign-in with an authenticator app: after the password, a 6-digit code from the app on your phone
// (Google Authenticator, Microsoft Authenticator, 1Password…). Optional for landlords; required for the
// Keyholder team. Backup codes cover a lost phone. Live accounts only (the server keeps the secret).

/** The code step of signing in, after the password (or Google) was right. */
export function TwoStepCode({ ticket, onSignedIn, onBack }: { ticket: string; onSignedIn: (u: ServerUser) => Promise<void> | void; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!code.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ user: ServerUser }>('POST', '/api/auth/two-step', { ticket, code: code.trim(), trust });
      await onSignedIn(r.user);
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <form className="acct-login two-step-form" onSubmit={submit}>
      <div className="two-step-head"><span className="tile-ic lilac" aria-hidden><Icon name="lock" size={20} /></span>
        <div><strong>Two-step sign-in</strong><p className="small soft">Open your authenticator app and type the 6-digit code for Keyholder.</p></div></div>
      <div className="field"><label htmlFor="ts-code">Code</label>
        <input id="ts-code" className="input two-step-input" value={code} onChange={(e) => { setCode(e.target.value); setErr(''); }} inputMode="text" autoComplete="one-time-code" autoFocus placeholder="123 456" maxLength={12} /></div>
      <label className="check"><input id="ts-trust" type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />Trust this browser for 30 days</label>
      {err && <p className="small acct-error" role="alert">{err}</p>}
      <button className="btn primary acct-login-btn" disabled={!code.trim() || busy}>{busy ? 'Checking…' : 'Continue'}</button>
      <p className="tiny soft" style={{ margin: 0 }}>Lost your phone? Type one of your backup codes in the same box.</p>
      <button type="button" className="btn ghost small" onClick={onBack}>Back to sign in</button>
    </form>
  );
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
export function TwoStepSetup({ onDone, team }: { onDone: () => void; team?: boolean }) {
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
  const confirm = async (e: FormEvent) => {
    e.preventDefault(); if (!code.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ backupCodes: string[]; user: ServerUser }>('POST', '/api/auth/two-step/enable', { code: code.trim() });
      setCodes(r.backupCodes); setDone(r.user);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  if (codes) return (
    <div className="two-step-setup">
      <p className="callout pine" role="status" style={{ marginTop: 0 }}><Icon name="check" size={16} /> Two-step sign-in is on. {team ? '' : 'Next time you sign in, Keyholder asks for a code from your app.'}</p>
      <BackupCodes codes={codes} />
      <div className="btn-row" style={{ marginTop: 16 }}><button className="btn primary" id="ts-done" onClick={() => { if (done) setUser(done); onDone(); }}>I saved my backup codes</button></div>
    </div>
  );
  if (!setup) return (
    <div className="two-step-setup">
      <ol className="two-step-steps">
        <li><strong>Get an authenticator app</strong> on your phone, if you don't have one: Google Authenticator, Microsoft Authenticator or 1Password all work.</li>
        <li><strong>Scan a QR code</strong> with it (next screen).</li>
        <li><strong>Type the 6-digit code</strong> it shows, to confirm.</li>
      </ol>
      {err && <p className="small acct-error" role="alert">{err}</p>}
      <div className="btn-row"><button className="btn primary" id="ts-start" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start'}</button></div>
    </div>
  );
  return (
    <form className="two-step-setup" onSubmit={confirm}>
      <div className="two-step-scan">
        <Qr text={setup.uri} />
        <div>
          <p className="small" style={{ marginTop: 0 }}>In your app, choose <strong>Add</strong> (+), then <strong>Scan a QR code</strong>.</p>
          <p className="small soft">Can't scan? Choose "Enter a setup key" and type this key:</p>
          <p className="two-step-key"><code id="ts-secret">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></p>
        </div>
      </div>
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
  const go = async (e: FormEvent) => {
    e.preventDefault(); if (!code.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ user: ServerUser; backupCodes?: string[] }>('POST', path, { code: code.trim() });
      setUser(r.user);
      if (r.backupCodes) setCodes(r.backupCodes); else onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <Drawer title={title} onClose={onClose}>
      {codes ? <><BackupCodes codes={codes} /><div className="btn-row" style={{ marginTop: 16 }}><button className="btn primary" onClick={onClose}>I saved my backup codes</button></div></> : (
        <form onSubmit={go}>
          <div className="field"><label htmlFor="ts-act-code">Code from your app (or a backup code)</label>
            <input id="ts-act-code" className="input two-step-input" value={code} onChange={(e) => { setCode(e.target.value); setErr(''); }} autoComplete="one-time-code" autoFocus maxLength={12} /></div>
          {err && <p className="small acct-error" role="alert">{err}</p>}
          <div className="btn-row"><button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={!code.trim() || busy}>{button}</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
        </form>
      )}
    </Drawer>
  );
}

/** Settings → Two-step sign-in. */
export function TwoStepSettings() {
  const { user, config } = useConn();
  const [open, setOpen] = useState<'setup' | 'off' | 'codes' | null>(null);
  if (!serverMode() || !user) return <div className="sheet"><p className="small soft" style={{ margin: 0 }}>Two-step sign-in is available on your Keyholder account online: after your password, a code from an app on your phone.</p></div>;
  if (!config?.twoStep) return <div className="sheet"><p className="small soft" style={{ margin: 0 }}>Two-step sign-in is not available yet. Keyholder is finishing setting it up.</p></div>;
  const team = user.role !== 'owner';
  return (
    <div className="sheet two-step-settings">
      {user.twoStep ? (
        <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div><strong><Icon name="check" size={16} /> On</strong><div className="small soft">{user.twoStepSince ? `Since ${fmtDate(user.twoStepSince)} · ` : ''}{user.backupCodesLeft ?? 0} backup code{user.backupCodesLeft === 1 ? '' : 's'} left</div></div>
          <div className="btn-row">
            <button className="btn small" onClick={() => setOpen('codes')}>New backup codes</button>
            {!team && <button className="btn small ghost" onClick={() => setOpen('off')}>Turn off</button>}
          </div>
        </div>
      ) : (
        <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div><strong>Off</strong><div className="small soft">Protect your account: after your password, Keyholder asks for a code from an app on your phone.</div></div>
          <button className="btn primary" id="ts-turn-on" onClick={() => setOpen('setup')}><Icon name="lock" size={16} />Turn on</button>
        </div>
      )}
      {open === 'setup' && <Drawer title="Turn on two-step sign-in" onClose={() => setOpen(null)}><TwoStepSetup onDone={() => setOpen(null)} /></Drawer>}
      {open === 'off' && <CodeAction title="Turn off two-step sign-in" button="Turn off" path="/api/auth/two-step/disable" danger onClose={() => setOpen(null)} />}
      {open === 'codes' && <CodeAction title="New backup codes" button="Show new codes" path="/api/auth/two-step/backup-codes" onClose={() => setOpen(null)} />}
    </div>
  );
}

/** The support dashboard: the Keyholder team sets up two-step sign-in before anything else. */
export function TeamTwoStepGate({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="acct-page">
      <div className="acct-card">
        <h1>Set up two-step sign-in</h1>
        <p className="soft">The Keyholder team signs in with a password and a code from an authenticator app. It protects every landlord's information. It takes two minutes.</p>
        <TwoStepSetup team onDone={() => {}} />
        <button className="btn ghost small" style={{ marginTop: 16 }} onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

/** True when a signed-in landlord could turn it on (for Home's set-up steps). */
export const twoStepToOffer = (user: ServerUser | null, on: boolean | undefined) => serverMode() && !!on && !!user && user.role === 'owner' && !user.twoStep;
