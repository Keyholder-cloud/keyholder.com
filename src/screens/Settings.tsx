import { TwoStepSettings } from '../components/TwoStep';
import { BackToMore, PageSub } from '../components/Guide';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Billing } from '../components/Billing';
import { isPreviewUser, useStore } from '../data/store';

import { RentTracking } from './Money';
import { PACK_VERIFIED, PACK_VERSION, PROVINCES, province } from '../lib/jurisdiction';
import { fmtDate } from '../lib/dates';
import { TONES } from '../lib/templates';
import { Field, SlideToConfirm } from '../components/ui';
import { Icon } from '../components/Icon';
import { ServerAccount, ServerData } from '../components/ServerAccount';
import { api, useConn } from '../data/api';
import { PENDING_KEY, useConfirmIt } from '../components/ConfirmIt';

const THEMES = [
  { id: 'system', icon: 'monitor', label: 'Device', title: 'Match device' },
  { id: 'light', icon: 'sun', label: 'Paper', title: 'Paper (light)' },
  { id: 'dark', icon: 'moon', label: 'Night', title: 'Night Ledger (dark)' },
] as const;

const TABS = [
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'preferences', label: 'Preferences', icon: 'sparkle' },
  { id: 'billing', label: 'Billing', icon: 'cash' },
] as const;
type TabId = (typeof TABS)[number]['id'];
/** Old in-page links (/settings#two-step) → the tab that has that line now. */
const HASH_TAB: Record<string, TabId> = { profile: 'profile', account: 'profile', 'two-step': 'preferences', preferences: 'preferences', appearance: 'preferences', 'rent-tracking': 'preferences', reminders: 'preferences', tone: 'preferences', grace: 'preferences', auto: 'preferences', data: 'preferences', billing: 'billing' };
/** Reminders and Data are sections of Preferences now: their old tab links open Preferences at that section. */
const OLD_TAB: Record<string, string> = { reminders: 'reminders-receipts', data: 'data' };

/** One preference on one line: an icon, its name, and its options right there (wraps to two lines on phones). */
function Pref({ id, icon, title, children }: { id: string; icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="pref" id={`pref-${id}`}>
      <span className="pref-name"><Icon name={icon} size={18} /><span className="pref-t">{title}</span></span>
      <div className="pref-opts" id={id}>{children}</div>
    </div>
  );
}

export function Settings() {
  const { state, act } = useStore();
  const p = state.profile;
  const admin = isPreviewUser(state);
  const loc = useLocation();
  const nav = useNavigate();
  const conn = useConn();
  // With the Keyholder server, a landlord's real account (not the demo or admin preview).
  const live = conn.mode === 'server' && !!conn.user && conn.user.role === 'owner' && !admin && !!p.account;
  // Tabs: /settings/profile, /settings/preferences… Old links like /settings#two-step open the right tab.
  const { tab } = useParams();
  const fromHash = HASH_TAB[loc.hash.slice(1)];
  const cur: TabId = (TABS.find((t) => t.id === tab)?.id ?? (tab && OLD_TAB[tab] ? 'preferences' : undefined) ?? fromHash ?? 'profile');
  useEffect(() => { const id = tab && OLD_TAB[tab]; if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' })); }, [tab]);
  // A link like /settings#two-step scrolls to that line.
  useEffect(() => { const id = loc.hash.slice(1); if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'center' })); }, [loc.hash]);
  // Your profile: changes wait in the form until Save.
  const saved = { name: p.name, email: p.email, phone: p.phone ?? '', province: p.province, city: p.city, emailUpdates: !!p.emailUpdates };
  const [draft, setDraft] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Clear all data: on a live account, confirm it is you, then the server clears it (and records it).
  const [confirmIt, confirmScreen] = useConfirmIt('Clearing all data deletes every property, tenant, payment and expense. Confirm it is you first.');
  const clearAll = () => (live ? confirmIt(async () => { await api('POST', '/api/state/clear', {}); act.clearAll(); setClearing(false); }, 'clear') : act.clearAll());
  // Back from confirming with Google (?verified=google): reopen what was waiting.
  const [verified, setVerified] = useState<'' | 'google' | 'wrong-google'>('');
  useEffect(() => {
    const v = new URLSearchParams(loc.search).get('verified');
    if (v !== 'google' && v !== 'wrong-google') return;
    setVerified(v);
    let pending = ''; try { pending = sessionStorage.getItem(PENDING_KEY) ?? ''; sessionStorage.removeItem(PENDING_KEY); } catch { /* none */ }
    if (v === 'google' && pending === 'clear') setClearing(true);
    if (v === 'google' && pending === 'passkey') requestAnimationFrame(() => document.getElementById('two-step')?.scrollIntoView({ block: 'center' }));
    nav(v === 'google' && pending === 'clear' ? '/settings/data' : '/settings/preferences', { replace: true });
  }, [loc.search]);
  // Changed elsewhere (another device, the questions): the form follows, unless you are in the middle of an edit.
  const lastSaved = useRef(JSON.stringify(saved));
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    const before = lastSaved.current; lastSaved.current = savedKey;
    setDraft((d) => (JSON.stringify(d) === before ? JSON.parse(savedKey) : d));
  }, [savedKey]);
  const dirty = (Object.keys(saved) as (keyof typeof saved)[]).some((k) => draft[k] !== saved[k]);
  const edit = (x: Partial<typeof saved>) => { setDraft((d) => ({ ...d, ...x })); setJustSaved(false); };
  const saveProfile = () => {
    act.setProfile({ name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim() || undefined, province: draft.province, city: draft.city, emailUpdates: draft.emailUpdates });
    setJustSaved(true);
  };

  return (
    <div className="page">
      <BackToMore /><div className="page-head"><div><div className="eyebrow">Settings</div><h1 className="title-ic"><span className="tile-ic mint" aria-hidden><Icon name="settings" size={22} /></span>Your Keyholder</h1><PageSub>Your profile, preferences, reminders, data and plan</PageSub></div></div>
      <nav className="tabs settings-tabs" aria-label="Settings">
        {TABS.map((t) => <Link key={t.id} to={`/settings/${t.id}`} id={`st-tab-${t.id}`} className={`tab${cur === t.id ? ' on' : ''}`} aria-current={cur === t.id ? 'page' : undefined}><Icon name={t.icon} size={16} />{t.label}</Link>)}
      </nav>
      {verified === 'google' && <p className="callout pine" role="status" id="verified-note"><Icon name="check" size={16} /> Confirmed with Google. You have 10 minutes to finish what you started.</p>}
      {verified === 'wrong-google' && <p className="callout warn" role="alert" id="verified-note">That Google account is not the one on this Keyholder account. Try again with the right one, or use your password.</p>}

      {cur === 'preferences' && <section className="section" id="preferences">
        <h2 className="section-title">Preferences</h2>
        <div className="sheet prefs">
          <Pref id="appearance" icon="sparkle" title="Appearance">
            <span className="seg-icons" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => <button key={t.id} role="radio" aria-checked={p.theme === t.id} title={t.title} onClick={() => act.setProfile({ theme: t.id })}><Icon name={t.icon} size={15} />{t.label}</button>)}
            </span>
            <button className="chip" role="switch" aria-checked={p.paperGrain} id="pref-grain" title="Paper grain texture" onClick={() => act.setProfile({ paperGrain: !p.paperGrain })}><Icon name={p.paperGrain ? 'check' : 'sparkle'} size={14} />Grain</button>
          </Pref>
          <Pref id="two-step" icon="lock" title="Two-step sign-in"><TwoStepSettings /></Pref>
          <Pref id="rent-tracking" icon="bank" title="Rent tracking"><RentTracking /></Pref>
        </div>
      </section>}

      {cur === 'profile' && <section className="section" id="profile">
        <h2 className="section-title">Your profile</h2>
        <div className="sheet">
          <form id="profile-form" onSubmit={(e) => { e.preventDefault(); if (dirty) saveProfile(); }}>
          <div className="profile-grid">
            <Field label="Name on receipts" htmlFor="st-n" hint={draft.name.trim() && !/\s/.test(draft.name.trim()) ? 'Add your last name' : undefined}><input id="st-n" className="input" value={draft.name} onChange={(e) => edit({ name: e.target.value })} /></Field>
            <Field label="Email" htmlFor="st-e"><input id="st-e" type="email" className="input" value={draft.email} onChange={(e) => edit({ email: e.target.value })} /></Field>
            <Field label="Phone (optional)" htmlFor="st-ph"><input id="st-ph" type="tel" className="input" value={draft.phone} onChange={(e) => edit({ phone: e.target.value })} autoComplete="tel" /></Field>
            <Field label="Province" htmlFor="st-p">
              <select id="st-p" className="input" title={`Rules pack ${PACK_VERSION}, last verified ${fmtDate(PACK_VERIFIED)}`} value={draft.province} onChange={(e) => edit({ province: e.target.value as typeof p.province, city: province(e.target.value as typeof p.province).cities[0] })}>{PROVINCES.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select>
            </Field>
            <Field label="City" htmlFor="st-c"><select id="st-c" className="input" value={draft.city} onChange={(e) => edit({ city: e.target.value })}>{province(draft.province).cities.map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
          <div className="profile-save">
            <label className="check" title={live ? (conn.config?.emailDelivery ? 'One short email a day at most' : 'Email sending is not switched on yet') : 'Preview: no emails are sent'}><input type="checkbox" checked={draft.emailUpdates} onChange={(e) => edit({ emailUpdates: e.target.checked })} /><Icon name="mail" size={15} />{live ? 'Email me when something needs me' : 'Email me on rent day'}</label>
            <button type="submit" className="btn primary" id="st-save" disabled={!dirty}>Save</button>
            {dirty ? <span className="small soft">Not saved yet</span> : justSaved ? <span className="small saved-note" role="status"><Icon name="check" size={14} /> Saved</span> : null}
          </div>
          </form>
          <div id="account" className="profile-account">
            {admin ? (
              <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
                <div><strong>{p.account?.provider === 'admin' ? 'Admin' : 'Demo'} (test login)</strong><div className="small soft">Sample properties only. Nothing here is real.</div></div>
              </div>
            ) : live ? <ServerAccount /> : p.account ? (
              <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
                <div><strong>{p.account.name || p.name}</strong><div className="small soft">{p.account.email} · signed in with {p.account.provider === 'google' ? 'Google' : 'an email link'}</div></div>
              </div>
            ) : (
              <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
                <div><strong>No account yet</strong><div className="small soft">Saved in this browser only.</div></div>
              </div>
            )}
          </div>
        </div>
      </section>}

      {cur === 'preferences' && <section className="section" id="reminders-receipts">
        <h2 className="section-title">Reminders and receipts</h2>
        <div className="sheet prefs" id="reminders">
          <Pref id="tone" icon="message" title="Reminder tone">
            <span className="seg-icons" role="radiogroup" aria-label="Tone">
              {TONES.map((t) => <button key={t.id} role="radio" aria-checked={p.reminderTone === t.id} title={t.blurb} onClick={() => act.setProfile({ reminderTone: t.id })}>{t.label}</button>)}
            </span>
          </Pref>
          <Pref id="grace" icon="clock" title="Grace period">
            <span className="pref-inline" title="Rent is legally late the day after it's due. The firm reminder waits until this ends.">
              <input id="st-g" type="number" min={1} max={15} className="input pref-num" aria-label="Grace period in days" value={p.graceDays} onChange={(e) => act.setProfile({ graceDays: Math.max(1, Number(e.target.value) || 5) })} />days before the firm reminder
            </span>
          </Pref>
          <Pref id="auto" icon="send" title="Sending">
            <button className="chip" role="switch" aria-checked={p.autoSend} id="st-auto" title={p.autoSend ? 'Tap to approve each message yourself' : 'Tap to send receipts and reminders automatically'} onClick={() => act.setAutoSend(!p.autoSend)}>
              <Icon name={p.autoSend ? 'check' : 'pause'} size={14} />{p.autoSend ? 'Automatic' : 'I approve each one'}</button>
            <span className="pref-note" id="st-auto-note">{p.autoSend ? 'Receipts and reminders go out by themselves. Legal notices still wait for you.' : 'Every receipt and reminder waits for your OK before it is sent.'}</span>
          </Pref>
        </div>
      </section>}

      {cur === 'preferences' && <section className="section" id="data">
        <h2 className="section-title">Data</h2>
        <div className="sheet data-sheet">
          {live ? <ServerData /> : <p className="small soft" style={{ margin: 0 }}>Saved in this browser. Clearing browser data clears Keyholder.</p>}
          <div className="pref-opts">
            {admin && <button className="chip" onClick={act.resetDemo}><Icon name="sync" size={14} />Restore sample data</button>}
            {admin && <button className="chip" onClick={() => { act.signOut(); nav('/start'); }}><Icon name="back" size={14} />Replay the signup questions</button>}
            <button className="chip" onClick={() => { act.setProfile({ tourDone: false }); nav('/today'); }}><Icon name="play" size={14} />Show the tour again</button>
            <Link className="chip" to="/welcome"><Icon name="info" size={14} />What is Keyholder?</Link>
            <button className="chip danger" id="st-clear" aria-expanded={clearing} onClick={() => setClearing((x) => !x)}><Icon name="trash" size={14} />Clear all data</button>
          </div>
          {clearing && <div className="clear-box"><div className="callout warn">This deletes every property, tenant, payment and expense. It can't be undone.</div><SlideToConfirm label="Slide to clear all data" onConfirm={() => { void clearAll(); }} /></div>}
          {confirmScreen}
        </div>
      </section>}

      {cur === 'billing' && <Billing />}
    </div>
  );
}
