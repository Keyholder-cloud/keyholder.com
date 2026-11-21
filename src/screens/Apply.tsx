import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../data/api';
import { Brand } from '../components/Brand';
import { Icon } from '../components/Icon';
import { MoneyInput } from '../components/ui';
import { fmtDate } from '../lib/dates';
import { fmt0 } from '../lib/money';

// The public application form (keyholder.cloud/apply/<listing>): works on any phone, no account needed.
// It never asks about family status, children, age, religion, ethnicity, place of origin, disability or public
// assistance (Ontario Human Rights Code). What is sent goes to the landlord's applications for that unit.

type Listing = { unit: string; rooms: boolean; address: string; city: string; province: string; rent: number; available: string; notes: string; landlord: string; bedrooms: number | null };
type P = { name: string; email: string; phone: string; employer: string; jobTitle: string; monthlyIncome?: number };
const blank = (): P => ({ name: '', email: '', phone: '', employer: '', jobTitle: '', monthlyIncome: undefined });

export const applySlug = () => (typeof window !== 'undefined' && window.location.pathname.startsWith('/apply/') ? decodeURIComponent(window.location.pathname.slice(7)).replace(/\/$/, '') : null);

export function ApplyPage({ slug }: { slug: string }) {
  const [l, setL] = useState<Listing | null>(null);
  const [missing, setMissing] = useState('');
  const [people, setPeople] = useState<P[]>([blank()]);
  const [f, setF] = useState({ occupants: 1, moveIn: '', currentAddress: '', yearsAtAddress: '', currentRent: undefined as number | undefined, landlordName: '', landlordPhone: '', reasonLeaving: '', employedYears: '', pets: false, petsWhat: '', smoking: false, vehicles: 0, references: '', notes: '', consentReferences: false, creditConsent: false, website: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => { api<Listing>('GET', `/api/apply/${encodeURIComponent(slug)}`).then((x) => { setL(x); setF((v) => ({ ...v, moveIn: x.available })); }, (e) => setMissing((e as Error).message)); }, [slug]);
  const set = (x: Partial<typeof f>) => { setF((v) => ({ ...v, ...x })); setErr(''); };
  const setP = (i: number, x: Partial<P>) => { setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, ...x } : p))); setErr(''); };
  const ok = people[0].name.trim().length > 1 && /\S+@\S+\.\S+/.test(people[0].email) && f.currentAddress.trim().length > 2 && !!f.moveIn && f.consentReferences;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!ok || busy) return;
    setBusy(true); setErr('');
    try {
      await api('POST', `/api/apply/${encodeURIComponent(slug)}`, {
        people: people.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), email: p.email.trim(), phone: p.phone.trim(), employer: p.employer.trim(), jobTitle: p.jobTitle.trim() || undefined, monthlyIncome: p.monthlyIncome ?? 0 })),
        occupants: Math.max(1, Number(f.occupants) || 1), moveIn: f.moveIn, currentAddress: f.currentAddress.trim(), yearsAtAddress: Number(f.yearsAtAddress) || 0,
        currentRent: f.currentRent, landlordName: f.landlordName.trim() || undefined, landlordPhone: f.landlordPhone.trim() || undefined, reasonLeaving: f.reasonLeaving.trim() || undefined,
        employedYears: f.employedYears ? Number(f.employedYears) : undefined, pets: f.pets, petsWhat: f.pets ? f.petsWhat.trim() || undefined : undefined, smoking: f.smoking,
        vehicles: Number(f.vehicles) || 0, references: f.references.trim() || undefined, notes: f.notes.trim() || undefined,
        consentReferences: true, creditConsent: f.creditConsent, website: f.website,
      });
      setSent(true); window.scrollTo(0, 0);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };

  const top = <div className="acct-top"><a href="/" aria-label="Keyholder"><Brand size={26} /></a></div>;
  if (missing) return <div className="acct-page apply-page">{top}<div className="acct-card"><h1>Application form</h1><p className="callout warn" role="alert">{missing}</p></div></div>;
  if (!l) return <div className="acct-page apply-page">{top}<div className="acct-card"><p className="soft">Loading…</p></div></div>;
  if (sent) return (
    <div className="acct-page apply-page">{top}<div className="acct-card" id="apply-sent">
      <h1><Icon name="check" size={24} /> Application sent</h1>
      <p>{l.landlord} has your application for Unit {l.unit}, {l.address}, and will contact you by email or phone.</p>
    </div></div>
  );
  return (
    <div className="acct-page apply-page">
      {top}
      <form className="acct-card apply-card" onSubmit={submit}>
        <h1>Apply for Unit {l.unit}</h1>
        <p className="apply-facts"><span><Icon name="pin" size={15} />{l.address}, {l.city}</span><span><Icon name="cash" size={15} />{fmt0(l.rent)} a month{l.rooms ? ' (a room)' : ''}</span><span><Icon name="calendar" size={15} />Available {fmtDate(l.available)}</span>{l.bedrooms ? <span><Icon name="door" size={15} />{l.bedrooms} bed</span> : null}</p>
        {l.notes && <p className="small soft">{l.notes}</p>}

        <h2 className="apply-h"><Icon name="users" size={18} />Who is applying</h2>
        {people.map((p, i) => (
          <fieldset key={i} className="apply-person">
            <legend>{i === 0 ? 'You' : `Person ${i + 1}`}{i > 0 && <button type="button" className="btn ghost small" onClick={() => setPeople((ps) => ps.filter((_, j) => j !== i))}>Remove</button>}</legend>
            <div className="grid2">
              <label className="field"><span>Full legal name</span><input className="input" id={`ap-n${i}`} value={p.name} onChange={(e) => setP(i, { name: e.target.value })} autoComplete={i ? 'off' : 'name'} /></label>
              <label className="field"><span>Email{i ? ' (optional)' : ''}</span><input className="input" id={`ap-e${i}`} type="email" value={p.email} onChange={(e) => setP(i, { email: e.target.value })} autoComplete={i ? 'off' : 'email'} /></label>
              <label className="field"><span>Phone</span><input className="input" id={`ap-p${i}`} type="tel" value={p.phone} onChange={(e) => setP(i, { phone: e.target.value })} autoComplete={i ? 'off' : 'tel'} /></label>
              <label className="field"><span>Employer</span><input className="input" id={`ap-w${i}`} value={p.employer} onChange={(e) => setP(i, { employer: e.target.value })} /></label>
              <label className="field"><span>Job title</span><input className="input" value={p.jobTitle} onChange={(e) => setP(i, { jobTitle: e.target.value })} /></label>
              <label className="field"><span>Monthly income before tax</span><MoneyInput id={`ap-i${i}`} value={p.monthlyIncome} onChange={(c) => setP(i, { monthlyIncome: c })} /></label>
            </div>
          </fieldset>
        ))}
        {people.length < 6 && <button type="button" className="btn small" onClick={() => setPeople((ps) => [...ps, blank()])}><Icon name="plus" size={14} />Add another person on the lease</button>}

        <h2 className="apply-h"><Icon name="home" size={18} />Where you live now</h2>
        <div className="grid2">
          <label className="field span2"><span>Address</span><input className="input" id="ap-addr" value={f.currentAddress} onChange={(e) => set({ currentAddress: e.target.value })} autoComplete="street-address" /></label>
          <label className="field"><span>Years there</span><input className="input" type="number" min={0} step="0.5" value={f.yearsAtAddress} onChange={(e) => set({ yearsAtAddress: e.target.value })} /></label>
          <label className="field"><span>Rent you pay now</span><MoneyInput value={f.currentRent} onChange={(c) => set({ currentRent: c })} /></label>
          <label className="field"><span>Current landlord's name</span><input className="input" value={f.landlordName} onChange={(e) => set({ landlordName: e.target.value })} /></label>
          <label className="field"><span>Their phone</span><input className="input" type="tel" value={f.landlordPhone} onChange={(e) => set({ landlordPhone: e.target.value })} /></label>
          <label className="field span2"><span>Why you are moving</span><input className="input" value={f.reasonLeaving} onChange={(e) => set({ reasonLeaving: e.target.value })} /></label>
        </div>

        <h2 className="apply-h"><Icon name="key" size={18} />The tenancy</h2>
        <div className="grid2">
          <label className="field"><span>Move-in date</span><input className="input" id="ap-move" type="date" value={f.moveIn} onChange={(e) => set({ moveIn: e.target.value })} /></label>
          <label className="field"><span>People who will live there</span><input className="input" type="number" min={1} max={20} value={f.occupants} onChange={(e) => set({ occupants: Number(e.target.value) })} /></label>
          <label className="field"><span>Vehicles needing parking</span><input className="input" type="number" min={0} max={10} value={f.vehicles} onChange={(e) => set({ vehicles: Number(e.target.value) })} /></label>
          <label className="field"><span>Years at your job</span><input className="input" type="number" min={0} step="0.5" value={f.employedYears} onChange={(e) => set({ employedYears: e.target.value })} /></label>
        </div>
        <div className="apply-checks">
          <label className="check"><input type="checkbox" checked={f.pets} onChange={(e) => set({ pets: e.target.checked })} />Pets</label>
          {f.pets && <input className="input" placeholder="What kind, and how many" value={f.petsWhat} onChange={(e) => set({ petsWhat: e.target.value })} />}
          <label className="check"><input type="checkbox" checked={f.smoking} onChange={(e) => set({ smoking: e.target.checked })} />Someone smokes</label>
        </div>
        <label className="field"><span>References (name, how you know them, phone)</span><textarea className="input" rows={2} value={f.references} onChange={(e) => set({ references: e.target.value })} /></label>
        <label className="field"><span>Anything else (optional)</span><textarea className="input" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
        {/* Left empty by people; filled in by bots. */}
        <input className="apply-hp" tabIndex={-1} autoComplete="off" aria-hidden value={f.website} onChange={(e) => set({ website: e.target.value })} name="website" />

        <h2 className="apply-h"><Icon name="shield" size={18} />Consent</h2>
        <label className="check"><input type="checkbox" id="ap-consent" checked={f.consentReferences} onChange={(e) => set({ consentReferences: e.target.checked })} />I agree {l.landlord} may contact my references, current landlord and employer.</label>
        <label className="check"><input type="checkbox" checked={f.creditConsent} onChange={(e) => set({ creditConsent: e.target.checked })} />I agree to a credit check (optional; your SIN is never required).</label>
        <p className="tiny soft">Sent only to {l.landlord}, through Keyholder. Declined applications are deleted after 90 days. Keyholder never asks about family status, age, religion, ethnicity, place of origin, disability or public assistance.</p>
        {err && <p className="small acct-error" role="alert">{err}</p>}
        <button className="btn primary acct-login-btn" id="ap-send" disabled={!ok || busy}>{busy ? 'Sending…' : 'Send application'}</button>
      </form>
    </div>
  );
}
