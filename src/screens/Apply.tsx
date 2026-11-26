import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../data/api';
import { Brand } from '../components/Brand';
import { Icon } from '../components/Icon';
import { MoneyInput } from '../components/ui';
import { fmtDate } from '../lib/dates';
import { fmt0 } from '../lib/money';
import { CREDIT_SOURCES, ID_TYPES } from '../lib/applyDocs';

/** A file ready to send: photos are made smaller (a JPEG up to 1800 px), a PDF goes as it is. */
type Up = { name: string; mime: string; data: string; size: number };
async function readUpload(file: File): Promise<Up> {
  const b64 = (blob: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(r.error); r.readAsDataURL(blob); });
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > 4.5 * 1024 * 1024) throw new Error('That PDF is over 4.5 MB. Take a photo instead, or use a smaller file.');
    return { name: file.name, mime: 'application/pdf', data: await b64(file), size: file.size };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('This photo could not be read. Use a JPEG or PNG photo, or a PDF.')); i.src = url; });
    const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((ok, no) => c.toBlob((x) => (x ? ok(x) : no(new Error('This photo could not be read.'))), 'image/jpeg', 0.85));
    return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', data: await b64(blob), size: blob.size };
  } finally { URL.revokeObjectURL(url); }
}

function UploadField({ id, label, value, onChange }: { id: string; label: string; value: Up | null; onChange: (u: Up | null) => void }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="field apply-upload">
      <span>{label}</span>
      <label className={`apply-drop${value ? ' done' : ''}`} htmlFor={id}>
        <Icon name={value ? 'check' : 'camera'} size={18} />
        <span>{busy ? 'Reading…' : value ? `${value.name} · ${Math.max(1, Math.round(value.size / 1024))} KB` : 'Take a photo or choose a file'}</span>
        {value && <button type="button" className="btn ghost small" onClick={(e) => { e.preventDefault(); onChange(null); }}>Change</button>}
      </label>
      <input id={id} className="apply-file" type="file" accept="image/*,application/pdf" onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        setErr(''); setBusy(true);
        try { onChange(await readUpload(file)); } catch (x) { setErr((x as Error).message); onChange(null); } finally { setBusy(false); }
      }} />
      {err && <span className="small acct-error" role="alert">{err}</span>}
    </div>
  );
}

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
  const [ids, setIds] = useState<{ type: string; file: Up | null }[]>([{ type: ID_TYPES[0], file: null }, { type: ID_TYPES[1], file: null }]);
  const [score, setScore] = useState('');
  const [source, setSource] = useState<string>('');
  const [report, setReport] = useState<Up | null>(null);
  const setId = (i: number, x: Partial<{ type: string; file: Up | null }>) => { setIds((v) => v.map((y, j) => (j === i ? { ...y, ...x } : y))); setErr(''); };
  const scoreN = Number(score);
  const idsOk = ids.every((x) => !!x.file) && (ids[0].type !== ids[1].type || ids[0].type === 'Other government ID');
  const creditOk = Number.isInteger(scoreN) && scoreN >= 300 && scoreN <= 900 && !!source;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => { api<Listing>('GET', `/api/apply/${encodeURIComponent(slug)}`).then((x) => { setL(x); setF((v) => ({ ...v, moveIn: x.available })); }, (e) => setMissing((e as Error).message)); }, [slug]);
  // The tab shows the rental, not the landlord website.
  useEffect(() => { document.title = l ? `Apply for Unit ${l.unit} · ${l.address}` : 'Rental application'; }, [l]);
  const set = (x: Partial<typeof f>) => { setF((v) => ({ ...v, ...x })); setErr(''); };
  const setP = (i: number, x: Partial<P>) => { setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, ...x } : p))); setErr(''); };
  const ok = people[0].name.trim().length > 1 && /\S+@\S+\.\S+/.test(people[0].email) && f.currentAddress.trim().length > 2 && !!f.moveIn && f.consentReferences && f.creditConsent && idsOk && creditOk;
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
        consentReferences: true, creditConsent: true, website: f.website,
        ids: ids.map((x) => ({ type: x.type, file: { name: x.file!.name, mime: x.file!.mime, data: x.file!.data } })),
        credit: { score: scoreN, source, ...(report ? { report: { name: report.name, mime: report.mime, data: report.data } } : {}) },
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
      <p className="soft">A copy of your application is on its way to your email as a PDF.</p>
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

        <h2 className="apply-h"><Icon name="user" size={18} />ID and credit score</h2>
        <p className="small soft" style={{ marginTop: -4 }}>Two different pieces of government photo ID, and your credit score. Both are required.</p>
        <div className="grid2">
          {ids.map((x, i) => (
            <fieldset key={i} className="apply-person apply-id">
              <legend>ID {i + 1}</legend>
              <label className="field"><span>Type</span>
                <select className="input" id={`ap-idt${i}`} value={x.type} onChange={(e) => setId(i, { type: e.target.value })}>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <UploadField id={`ap-idf${i}`} label="Photo or PDF" value={x.file} onChange={(file) => setId(i, { file })} />
            </fieldset>
          ))}
        </div>
        {ids[0].type === ids[1].type && ids[0].type !== 'Other government ID' && <p className="small acct-error" role="alert">Choose two different kinds of ID.</p>}
        <div className="callout apply-soft" id="ap-soft"><Icon name="shield" size={16} /><span><strong>This is a soft credit check. It does not affect your credit score.</strong> Get your score free from Borrowell or Credit Karma, or in your bank's app.</span></div>
        <div className="grid2">
          <label className="field"><span>Credit score (300 to 900)</span><input className="input" id="ap-score" inputMode="numeric" value={score} onChange={(e) => { setScore(e.target.value.replace(/\D/g, '').slice(0, 3)); setErr(''); }} placeholder="e.g. 720" /></label>
          <label className="field"><span>Where it is from</span>
            <select className="input" id="ap-src" value={source} onChange={(e) => setSource(e.target.value)}><option value="">Choose…</option>{CREDIT_SOURCES.map((t) => <option key={t}>{t}</option>)}</select></label>
        </div>
        {score && !creditOk && Number(score) && (scoreN < 300 || scoreN > 900) ? <p className="small acct-error" role="alert">A credit score is between 300 and 900.</p> : null}
        <UploadField id="ap-report" label="Credit report or screenshot (optional)" value={report} onChange={setReport} />

        <h2 className="apply-h"><Icon name="shield" size={18} />Consent</h2>
        <label className="check"><input type="checkbox" id="ap-consent" checked={f.consentReferences} onChange={(e) => set({ consentReferences: e.target.checked })} />I agree {l.landlord} may contact my references, current landlord and employer.</label>
        <label className="check"><input type="checkbox" id="ap-credit" checked={f.creditConsent} onChange={(e) => set({ creditConsent: e.target.checked })} />I agree to a soft credit check. A soft check does not affect my credit score. My SIN is never required.</label>
        <p className="tiny soft">Sent only to {l.landlord}, through Keyholder; you get a copy by email as a PDF (without your ID). Your ID is shown only to {l.landlord}. Declined applications are deleted after 90 days. Keyholder never asks about family status, age, religion, ethnicity, place of origin, disability or public assistance.</p>
        {err && <p className="small acct-error" role="alert">{err}</p>}
        <button className="btn primary acct-login-btn" id="ap-send" disabled={!ok || busy}>{busy ? 'Sending…' : 'Send application'}</button>
      </form>
    </div>
  );
}
