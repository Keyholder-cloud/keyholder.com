import { useMemo, useState } from 'react';
import type { Lease, Notice } from '../data/types';
import { useStore } from '../data/store';
import { addDays, addMonths, fmtDate, fmtPeriod } from '../lib/dates';
import { tenantPeople } from '../lib/people';
import { AUTHORITY_URL, SITUATIONS, formById, formsFor, type FormDef, type Situation } from '../lib/forms';
import { province } from '../lib/jurisdiction';
import { fmt } from '../lib/money';
import { MAIL_EXTRA_DAYS, arrears, earliestIncrease, formChecks, n4NoticeDays, propertyOf, terminationDate } from '../lib/notices';
import { OFFICIAL, REL, REL_LABEL, endOfRentalPeriod, hasOfficialForm, ltbValues } from '../lib/ltbForms';
import { ApiError, serverMode } from '../data/api';
import { emailNotice, openOfficialPdf, pdfName, testEmailForm } from '../data/officialForms';
import * as sync from '../data/sync';
import { Drawer, Field, Seg, SlideToConfirm, Stamp } from './ui';
import { Icon } from './Icon';

// One screen for every form in every province: pre-filled from Keyholder's records, checked, approved
// with a deliberate slide, and recorded with how and when it was delivered (proof of service).

const ROOMS = ['Entrance and hallway', 'Kitchen', 'Living room', 'Bathroom', 'Bedroom 1', 'Bedroom 2', 'Windows and blinds', 'Smoke and CO alarms'];

export function FormWizard({ lease, formId, onClose }: { lease: Lease; formId: string; onClose: () => void }) {
  const { state, act, today } = useStore();
  // Ontario rent increases: N1, or N2 for a unit the guideline does not cap (the wizard switches between them).
  const [fid, setFid] = useState(formId);
  const form = formById(fid)!;
  const tenant = state.tenants.find((t) => t.id === lease.tenantId)!;
  const unit = state.units.find((u) => u.id === lease.unitId)!;
  const prop = propertyOf(state, lease)!;
  const prov = province(prop.province);
  const guide = prov.rentIncreaseGuidelinePct;
  const on = prop.province === 'ON';
  const live = serverMode();
  const official = hasOfficialForm(fid) ? OFFICIAL[fid] : null;
  const isLease = formId === 'on-lease';
  const [method, setMethod] = useState<Notice['serveMethod']>(form.kind === 'notice' ? (tenant.emailConsent ? 'email' : 'hand') : isLease ? (tenantPeople(tenant).some((p) => p.email) ? 'email' : 'hand') : 'signed');
  const [servedOn, setServedOn] = useState(today);
  const [servedBy, setServedBy] = useState(state.profile.name);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<Record<string, string>>(() => ({
    newRent: guide ? ((lease.rent * (1 + guide / 100)) / 100).toFixed(2) : ((lease.rent * 1.03) / 100).toFixed(2),
    effective: earliestIncrease(state, lease, today, form),
    endDate: addDays(today, 30),
    terminationDate: addDays(today, 14),
    moveType: 'Move-in',
    exempt: formId === 'on-n2' ? 'yes' : 'no',
    mailing: state.profile.mailingAddress ?? '',
    n5Reason: 'damage', n5Second: 'no', n12Reason: 'own', relation: 'self', caregiver: 'no',
    // The lease (Ontario's Standard Form of Lease): what the landlord's records already say, ready to change.
    termType: lease.end ? 'fixed' : 'monthly', termEnd: lease.end ?? addDays(addMonths(lease.start, 12), -1),
    condo: 'no', parkingDesc: lease.parking ? '1 parking space' : '', parkingRent: '',
    electricity: /hydro|electric/i.test(lease.utilities) && /tenant/i.test(lease.utilities) ? 'tenant' : 'landlord',
    heat: /heat|gas/i.test(lease.utilities) && /tenant/i.test(lease.utilities) ? 'tenant' : 'landlord',
    water: /water/i.test(lease.utilities) && /tenant/i.test(lease.utilities) ? 'tenant' : 'landlord',
    gas: 'no', ac: 'no', storage: 'no', laundry: 'no', guestParking: 'no', utilNote: '',
    keyDeposit: '', keyNote: '', smoking: 'none', smokingRules: '', insurance: 'required', emailNotices: tenant.emailConsent ? 'yes' : 'no', nsf: '',
  }));
  const set = (k: string, v: string) => setD((x) => ({ ...x, [k]: v }));
  const a = arrears(state, lease, today);
  const checks = useMemo(() => {
    const c = formChecks(state, lease, form, method, today, d);
    // What the official form itself asks for (filled on the live site).
    if (official && live) {
      if (fid === 'on-n1' || fid === 'on-n2') c.push({ ok: !!d.mailing.trim(), text: d.mailing.trim() ? 'Your mailing address is on the notice' : 'Add your mailing address (the notice shows it)' });
      if (fid === 'on-lease') {
        c.push({ ok: !!d.mailing.trim(), text: d.mailing.trim() ? 'Your address for notices is on the lease' : 'Add your address for notices (section 3 of the lease)' });
        c.push({ ok: true, warn: !prop.postalCode, text: prop.postalCode ? "The rental unit's postal code is on the lease" : "The rental unit's postal code is blank on the lease (add it under Rentals → the property → Edit details)" });
        c.push({ ok: d.termType !== 'fixed' || !!d.termEnd, text: d.termType === 'fixed' && !d.termEnd ? 'Add the date the fixed term ends' : 'The term is set' });
      }
      if (fid === 'on-n4' || fid === 'on-n5' || fid === 'on-n12') c.push({ ok: !!prop.postalCode, text: prop.postalCode ? "The rental unit's postal code is on the notice" : "Add the property's postal code (Rentals → the property → Edit details)" });
    }
    return c;
  }, [state, lease, form, method, today, d, official, live, fid, prop.postalCode]);
  const ok = checks.every((c) => c.ok) && (form.kind !== 'notice' || !!servedBy.trim());
  const ends = form.kind === 'notice' && !form.noEnd && (form.situation === 'late-rent' || form.situation === 'damage' || form.situation === 'own-use');
  const mail = method === 'mail' ? MAIL_EXTRA_DAYS : 0;
  // N5: 20 days for a first notice, 14 for a second within 6 months. N12: at least 60 days, ending on the last day of a
  // rental period, and not before a fixed term ends.
  const auto = !ends ? undefined
    : fid === 'on-n5' ? addDays(servedOn, (d.n5Second === 'yes' ? 14 : 20) + mail)
    : fid === 'on-n12' ? (() => { const e = endOfRentalPeriod(addDays(servedOn, 60 + mail), lease.dueDay); return lease.end && lease.end > e ? lease.end : e; })()
    : terminationDate(servedOn, method, form);
  const end = ends ? auto ?? d.terminationDate : undefined;
  const fr = prop.province === 'QC';
  const newRent = Math.round(Number(d.newRent || 0) * 100);
  const above = fid === 'on-n1' && !!guide && newRent > lease.rent && ((newRent - lease.rent) / lease.rent) * 100 > guide + 1e-9;
  // Exactly what goes on the official form (kept with the notice, so the served form can be opened again word for word).
  const values = useMemo(() => (official ? ltbValues({ formId: fid, state, lease, details: d, servedOn, end, today }) : null), [official, fid, state, lease, d, servedOn, end, today]);
  const who = tenant.names.join(' & ');

  const openForm = async () => {
    if (!values) return;
    setBusy(true);
    try { await openOfficialPdf(fid, values, pdfName({ kind: form.code, servedOn, createdAt: today }, who)); }
    catch (e) { act.say((e as Error).message); } finally { setBusy(false); }
  };
  const approve = async () => {
    if (d.mailing.trim() && d.mailing.trim() !== (state.profile.mailingAddress ?? '')) act.setProfile({ mailingAddress: d.mailing.trim() });
    const id = act.serveNotice({
      formId: form.id, kind: form.code, leaseId: lease.id, tenantId: tenant.id,
      arrears: form.situation === 'late-rent' ? a.total : 0, periods: form.situation === 'late-rent' ? a.periods.map((p) => p.period) : [],
      serveMethod: method, servedOn, servedBy, terminationDate: end, details: d,
      ...(official && values ? { official: { version: official.version, values } } : {}),
    });
    onClose();
    // Served by email: the official form goes to the tenants as an attachment (once the notice is saved).
    if (live && official && method === 'email') {
      try {
        // The server sends what it has saved: wait for the notice to be saved (a moment after approving), then ask.
        let r: Awaited<ReturnType<typeof emailNotice>> | null = null;
        for (let k = 0; !r; k++) {
          await new Promise((ok) => setTimeout(ok, k ? 800 : 50));
          await sync.flush();
          try { r = await emailNotice(id); } catch (e) { if (!(e instanceof ApiError && e.status === 404) || k >= 6) throw e; }
        }
        act.markNoticeEmailed(id);
        act.say(`${form.code} emailed to ${r.to.join(', ')} with the official form attached.`);
      } catch (e) { act.say(`${form.code} saved, but not emailed: ${(e as Error).message}`); }
    }
  };

  return (
    <Drawer title={`${form.code} · ${form.title}`} onClose={onClose} wide>
      <p className="soft" style={{ marginTop: 0 }}>{form.plain}{form.note ? ` ${form.note}` : ''}</p>

      {/* What this form needs from you */}
      {form.situation === 'rent-increase' && on && (
        <Field label="Was this unit first lived in after November 15, 2018?" hint="Then the guideline does not cap the increase, and the notice is the N2.">
          <Seg label="First lived in after November 15, 2018" value={d.exempt} onChange={(v) => { set('exempt', v); setFid(v === 'yes' ? 'on-n2' : 'on-n1'); }} options={[{ id: 'no', label: 'No' }, { id: 'yes', label: 'Yes' }]} />
        </Field>
      )}
      {form.situation === 'rent-increase' && (
        <div className="grid2">
          <Field label="New monthly rent" htmlFor="fw-rent" hint={`Now ${fmt(lease.rent)}${guide && fid !== 'on-n2' ? ` · ${guide}% guideline = ${fmt(Math.round(lease.rent * (1 + guide / 100)))}` : ''}`}><input id="fw-rent" className="input money" inputMode="decimal" value={d.newRent} onChange={(e) => set('newRent', e.target.value)} /></Field>
          <Field label="Starts on" htmlFor="fw-eff" hint="Earliest allowed date is filled in"><input id="fw-eff" type="date" className="input" value={d.effective} onChange={(e) => set('effective', e.target.value)} /></Field>
        </div>
      )}
      {above && (
        <Field label="This increase is above the guideline. It:">
          <Seg label="Above the guideline" value={d.aboveGuideline ?? ''} onChange={(v) => set('aboveGuideline', v)} options={[{ id: 'order', label: 'Was approved by an LTB order' }, { id: 'applied', label: 'Needs approval: I applied to the LTB' }]} />
        </Field>
      )}
      {isLease && on && (
        <div className="lease-q" id="lease-details">
          <Field label="Type of tenancy">
            <Seg label="Type of tenancy" value={d.termType} onChange={(v) => set('termType', v)} options={[{ id: 'monthly', label: 'Month-to-month' }, { id: 'fixed', label: 'Fixed term' }]} />
          </Field>
          {d.termType === 'fixed' && <Field label="Fixed term ends on" htmlFor="fw-term-end" hint="After that, the tenancy carries on month to month unless you both sign a new lease or give proper notice."><input id="fw-term-end" type="date" className="input" min={lease.start} value={d.termEnd} onChange={(e) => set('termEnd', e.target.value)} /></Field>}
          <div className="grid2">
            <Field label="Parking (spaces and where)" htmlFor="fw-park"><input id="fw-park" className="input" value={d.parkingDesc} onChange={(e) => set('parkingDesc', e.target.value)} placeholder="e.g. 1 outdoor space, driveway" /></Field>
            <Field label="Parking rent a month (if extra)" htmlFor="fw-park-rent"><input id="fw-park-rent" className="input" inputMode="decimal" value={d.parkingRent} onChange={(e) => set('parkingRent', e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" /></Field>
          </div>
          <Field label="Who pays the utilities">
            <div className="lease-util">{(['electricity', 'heat', 'water'] as const).map((k) => (
              <div key={k}><span className="small">{k[0].toUpperCase() + k.slice(1)}</span><Seg label={k} value={d[k]} onChange={(v) => set(k, v)} options={[{ id: 'landlord', label: 'You' }, { id: 'tenant', label: 'Tenant' }]} /></div>
            ))}</div>
          </Field>
          <Field label="Included in the rent">
            <div className="lease-util">{([['gas', 'Gas'], ['ac', 'Air conditioning'], ['storage', 'Extra storage'], ['laundry', 'Laundry'], ['guestParking', 'Guest parking']] as const).map(([k, label]) => (
              <div key={k}><span className="small">{label}</span><Seg label={label} value={d[k]} onChange={(v) => set(k, v)} options={k === 'laundry' || k === 'guestParking' ? [{ id: 'no', label: 'No' }, { id: 'free', label: 'Free' }, { id: 'pay', label: 'Pay per use' }] : [{ id: 'no', label: 'No' }, { id: 'yes', label: 'Yes' }]} /></div>
            ))}</div>
          </Field>
          <div className="grid2">
            <Field label="Tenant insurance">
              <Seg label="Tenant insurance" value={d.insurance} onChange={(v) => set('insurance', v)} options={[{ id: 'required', label: 'Liability required' }, { id: 'none', label: 'Not required' }]} />
            </Field>
            <Field label="Smoking rules">
              <Seg label="Smoking rules" value={d.smoking} onChange={(v) => set('smoking', v)} options={[{ id: 'none', label: 'None extra' }, { id: 'rules', label: 'Add rules' }]} />
            </Field>
          </div>
          {d.smoking === 'rules' && <Field label="Smoking rules" htmlFor="fw-smoke"><input id="fw-smoke" className="input" value={d.smokingRules} onChange={(e) => set('smokingRules', e.target.value)} placeholder="e.g. No smoking anywhere in the unit or on the balcony" /></Field>}
          <div className="grid2">
            <Field label="Key deposit (refundable, optional)" htmlFor="fw-key"><input id="fw-key" className="input" inputMode="decimal" value={d.keyDeposit} onChange={(e) => set('keyDeposit', e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" /></Field>
            <Field label="Condominium unit?">
              <Seg label="Condominium" value={d.condo} onChange={(v) => set('condo', v)} options={[{ id: 'no', label: 'No' }, { id: 'yes', label: 'Yes' }]} />
            </Field>
          </div>
          <Field label="Notices and documents by email (section 3)">
            <Seg label="Notices by email" value={d.emailNotices} onChange={(v) => set('emailNotices', v)} options={[{ id: 'yes', label: 'Both agree' }, { id: 'no', label: 'No' }]} />
          </Field>
          <p className="small soft">Rent {fmt(lease.rent)} on day {lease.dueDay} from {fmtDate(lease.start)}, deposit {fmt(lease.lmrDeposit)}: from the tenancy. Change them on the tenant's page.</p>
        </div>
      )}
      {(fid === 'on-n1' || fid === 'on-n2' || isLease) && (
        <Field label={isLease ? 'Your address for notices and documents' : 'Your mailing address'} htmlFor="fw-mail" hint={isLease ? 'Section 3 of the lease: where the tenant gives you notices. Saved for next time.' : 'The notice shows where the tenant can write to you. Saved for next time.'}><input id="fw-mail" className="input" value={d.mailing} onChange={(e) => set('mailing', e.target.value)} placeholder="12 King St E, Belleville, ON K8N 1A1" /></Field>
      )}

      {fid === 'on-n5' ? (
        <>
          <Field label="The reason">
            <Seg label="Reason" value={d.n5Reason} onChange={(v) => set('n5Reason', v)} options={[{ id: 'interfere', label: 'Disturbing others' }, { id: 'damage', label: 'Damage' }, { id: 'overcrowd', label: 'Too many people' }]} />
          </Field>
          <Field label="Is this the second N5 in 6 months for this tenant?" hint="A second N5 (at least 7 days after a first one that gave 7 days to fix it) cannot be cancelled by fixing the problem.">
            <Seg label="Second N5" value={d.n5Second} onChange={(v) => set('n5Second', v)} options={[{ id: 'no', label: 'No, the first' }, { id: 'yes', label: 'Yes, the second' }]} />
          </Field>
          {d.n5Reason === 'damage' && d.n5Second !== 'yes' && (
            <div className="grid2">
              <Field label="Cost to repair (optional)" htmlFor="fw-repair" hint="The tenant can pay this instead of repairing"><input id="fw-repair" className="input money" inputMode="decimal" value={d.repairCost ?? ''} onChange={(e) => set('repairCost', e.target.value)} /></Field>
              <Field label="Cost to replace (optional)" htmlFor="fw-replace" hint="If repairing is not reasonable"><input id="fw-replace" className="input money" inputMode="decimal" value={d.replaceCost ?? ''} onChange={(e) => set('replaceCost', e.target.value)} /></Field>
            </div>
          )}
          {d.n5Reason === 'overcrowd' && d.n5Second !== 'yes' && <Field label="How many people may live there" htmlFor="fw-people"><input id="fw-people" className="input" inputMode="numeric" value={d.people ?? ''} onChange={(e) => set('people', e.target.value.replace(/\D/g, ''))} /></Field>}
          <h3 style={{ margin: '12px 0 4px' }}>What happened</h3>
          <p className="small soft" style={{ marginTop: 0 }}>Dates, times and specific details, up to three events.</p>
          {[1, 2, 3].map((k) => (k === 1 || d[`ev${k - 1}What`]) && (
            <div className="grid2 n5-event" key={k}>
              <Field label={`Date and time${k > 1 ? ` (${k})` : ''}`} htmlFor={`fw-ev${k}w`}><input id={`fw-ev${k}w`} className="input" value={d[`ev${k}When`] ?? ''} onChange={(e) => set(`ev${k}When`, e.target.value)} placeholder="Oct 3, 2026, 11 pm" /></Field>
              <Field label="What happened" htmlFor={`fw-ev${k}t`}><textarea id={`fw-ev${k}t`} className="input" value={d[`ev${k}What`] ?? ''} onChange={(e) => set(`ev${k}What`, e.target.value)} placeholder="The bathroom door was broken. Repair quote $420." /></Field>
            </div>
          ))}
        </>
      ) : form.situation === 'damage' && <Field label="What happened, with dates" htmlFor="fw-what"><textarea id="fw-what" className="input" value={d.what ?? ''} onChange={(e) => set('what', e.target.value)} placeholder="On Oct 3 the bathroom door was broken. Repair quote $420." /></Field>}

      {fid === 'on-n12' ? (
        <>
          <Field label="Who will move in">
            <Seg label="Reason" value={d.n12Reason} onChange={(v) => set('n12Reason', v)} options={[{ id: 'own', label: 'Me or my family' }, { id: 'purchaser', label: 'The buyer (sale signed)' }]} />
          </Field>
          <div className="grid2">
            <Field label="Their name" htmlFor="fw-who"><input id="fw-who" className="input" value={d.who ?? ''} onChange={(e) => set('who', e.target.value)} placeholder={d.n12Reason === 'own' ? 'Ana Morgan' : 'Sam Lee'} /></Field>
            <Field label={d.caregiver === 'yes' ? 'They provide care to' : 'This person is'} htmlFor="fw-rel">
              <select id="fw-rel" className="input" value={d.relation} onChange={(e) => set('relation', e.target.value)}>
                {REL.map((r) => <option key={r} value={r}>{REL_LABEL[r][d.n12Reason === 'purchaser' ? 'buyer' : 'own']}</option>)}
              </select>
            </Field>
          </div>
          <label className="check-line"><input type="checkbox" checked={d.caregiver === 'yes'} onChange={(e) => set('caregiver', e.target.checked ? 'yes' : 'no')} /> They will live there to provide care services</label>
          <Field label="Compensation owed to tenant" htmlFor="fw-comp" hint="One month's rent, paid by the termination date (or another unit they accept)"><input id="fw-comp" className="input" readOnly value={fmt(lease.rent)} /></Field>
        </>
      ) : form.situation === 'own-use' && (
        <div className="grid2">
          <Field label="Who will live there" htmlFor="fw-who"><input id="fw-who" className="input" value={d.who ?? ''} onChange={(e) => set('who', e.target.value)} placeholder="Me / my daughter, Ana Morgan" /></Field>
          <Field label="Compensation owed to tenant" htmlFor="fw-comp" hint="Usually one month's rent"><input id="fw-comp" className="input" readOnly value={fmt(lease.rent)} /></Field>
        </div>
      )}
      {form.situation === 'end-agreement' && <Field label="Agreed last day" htmlFor="fw-end"><input id="fw-end" type="date" className="input" value={d.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>}
      {ends && !auto && (
        <Field label="Date the tenancy would end" htmlFor="fw-term" hint={`Check ${prov.name}'s minimum notice period before choosing.`}><input id="fw-term" type="date" className="input" value={d.terminationDate} onChange={(e) => set('terminationDate', e.target.value)} /></Field>
      )}
      {form.situation === 'inspection' && (
        <>
          <Field label="Inspection"><Seg label="Inspection" value={d.moveType} onChange={(v) => set('moveType', v)} options={[{ id: 'Move-in', label: 'Move-in' }, { id: 'Move-out', label: 'Move-out' }]} /></Field>
          <div className="sheet tight" style={{ marginBottom: 16 }}><table className="ledger"><tbody>{ROOMS.map((r) => (
            <tr key={r}><td>{r}</td><td style={{ width: 160 }}><select className="input" aria-label={`${r} condition`} value={d[r] ?? 'Good'} onChange={(e) => set(r, e.target.value)}><option>Good</option><option>Fair</option><option>Damaged</option></select></td></tr>
          ))}</tbody></table></div>
        </>
      )}

      {/* The prepared document */}
      <div className="letter fw-summary">
        <div className="spread"><strong>What goes on the {form.code}</strong><Stamp kind={official && live ? 'sent' : 'draft'}>{official ? 'Official form' : form.official ? 'Summary' : 'Template'}</Stamp></div>
        <table><tbody>
          <tr><td>{fr ? 'Locataire / Tenant' : 'Tenant'}</td><td>{who}</td></tr>
          <tr><td>{fr ? 'Locateur / Landlord' : 'Landlord'}</td><td>{state.profile.name || '—'}</td></tr>
          <tr><td>{fr ? 'Logement / Rental unit' : 'Rental unit'}</td><td>Unit {unit.label}, {prop.address}, {prop.city}, {prop.province}{prop.postalCode ? ` ${prop.postalCode}` : ''}</td></tr>
          {form.situation === 'late-rent' && a.periods.map((p) => <tr key={p.period}><td>Rent owing, {fmtPeriod(p.period)}</td><td>{fmt(p.owing)}</td></tr>)}
          {form.situation === 'late-rent' && <tr><td><strong>Total rent owing</strong></td><td><strong>{fmt(a.total)}</strong></td></tr>}
          {form.situation === 'rent-increase' && <><tr><td>Current rent</td><td>{fmt(lease.rent)}</td></tr><tr><td>New rent</td><td>${d.newRent}</td></tr><tr><td>Starting</td><td>{d.effective ? fmtDate(d.effective) : '—'}</td></tr></>}
          {form.situation === 'damage' && <tr><td>Reason</td><td>{fid === 'on-n5' ? `${({ interfere: 'Disturbing others', damage: 'Damage', overcrowd: 'Too many people' } as Record<string, string>)[d.n5Reason]}${d.n5Second === 'yes' ? ' (second N5)' : ''}${d.ev1What ? `: ${d.ev1What}` : ''}` : d.what || '—'}</td></tr>}
          {form.situation === 'own-use' && <tr><td>Will move in</td><td>{d.who || '—'}{fid === 'on-n12' ? ` (${REL_LABEL[(d.relation as (typeof REL)[number]) ?? 'self']?.[d.n12Reason === 'purchaser' ? 'buyer' : 'own']}${d.caregiver === 'yes' ? ', as a caregiver' : ''})` : ''}</td></tr>}
          {form.situation === 'end-agreement' && <tr><td>Last day of tenancy</td><td>{fmtDate(d.endDate)}</td></tr>}
          {form.situation === 'lease' && <><tr><td>Start</td><td>{fmtDate(lease.start)}</td></tr><tr><td>Rent</td><td>{fmt(lease.rent)} due on day {lease.dueDay}</td></tr><tr><td>Deposit</td><td>{fmt(lease.lmrDeposit)}</td></tr><tr><td>Notices by email</td><td>{lease.emailNoticeConsent ? 'Agreed' : 'Not agreed'}</td></tr></>}
          {form.situation === 'inspection' && <tr><td>Inspection</td><td>{d.moveType} · {ROOMS.filter((r) => (d[r] ?? 'Good') !== 'Good').map((r) => `${r}: ${d[r]}`).join('; ') || 'All rooms in good condition'}</td></tr>}
          {end && <tr><td>{form.situation === 'late-rent' ? 'Pay by / termination date' : 'Termination date'}</td><td>{fmtDate(end)}</td></tr>}
        </tbody></table>
        {official ? (
          <div className="official-note">
            {live ? (
              <>
                <p className="small" style={{ margin: '8px 0' }}>The Landlord and Tenant Board's own form ({official.version}), filled in with these details and signed with your name. {official.tenantPages}</p>
                <div className="btn-row">
                  <button className="btn" id="fw-open-form" onClick={openForm} disabled={busy}><Icon name="paper" size={16} />{busy ? 'Opening…' : isLease ? 'Preview the lease (PDF)' : 'Open the filled form (PDF)'}</button>
                  <button className="btn ghost" id="fw-test-email" disabled={busy || !values} title="Emails this PDF to you only. Nothing is saved or sent to the tenant." onClick={async () => {
                    setBusy(true);
                    try { const r = await testEmailForm(fid, values!, pdfName({ kind: form.code, servedOn, createdAt: today }, who)); act.say(`Test copy sent to ${r.to} only. Nothing went to the tenant.`); }
                    catch (e) { act.say((e as Error).message); } finally { setBusy(false); }
                  }}><Icon name="mail" size={16} />Email me a test copy</button>
                </div>
              </>
            ) : <p className="tiny" style={{ color: '#55605B' }}>On your live account, this is the Landlord and Tenant Board's own form ({official.version}), filled in and ready to print or email.</p>}
          </div>
        ) : (
          <p className="tiny" style={{ color: '#55605B' }}>
            {form.official
              ? (form.kind === 'application' && on ? 'Keyholder\'s summary. Applications are filed online through the Tribunals Ontario Portal; attach the served notice (open it from the notice list) and this ledger.' : `Keyholder's summary. Fill in and serve the official ${prov.tribunal} form ${form.code}.`)
              : `Keyholder template for ${prov.name}. Check it against the official rules.`} <a href={AUTHORITY_URL[prop.province]} target="_blank" rel="noopener noreferrer">Official site</a>
          </p>
        )}
      </div>

      {/* Only what needs attention: a failing check (or a caution). Passed checks are counted, not listed. */}
      {checks.some((c) => !c.ok || c.warn)
        ? <><h3 style={{ margin: '16px 0 8px' }}>To fix</h3><ul className="checks">{checks.filter((c) => !c.ok || c.warn).map((c) => <li key={c.text} className={!c.ok ? 'bad' : 'warn'}><Icon name="alert" size={18} />{c.text}</li>)}</ul></>
        : <p className="checks-ok small" id="fw-checks-ok"><Icon name="check" size={16} />All {checks.length} checks passed</p>}

      {form.kind === 'notice' && (
        <>
          <h3 style={{ margin: '20px 0 8px' }}>How it is delivered</h3>
          <Seg label="Delivery" value={method} onChange={setMethod} options={[{ id: 'email', label: 'Email' }, { id: 'hand', label: 'By hand' }, { id: 'mail-slot', label: 'Mail slot' }, { id: 'mail', label: 'Mail' }]} />
          <p className="small soft">{method === 'mail' ? `Mail adds ${MAIL_EXTRA_DAYS} days.` : form.id === 'on-n4' ? `At least ${n4NoticeDays(servedOn)} days' notice is given.` : fid === 'on-n5' ? `At least ${d.n5Second === 'yes' ? 14 : 20} days' notice.` : fid === 'on-n12' ? "At least 60 days' notice, ending on the last day of a rental period." : form.noticeDays ? `At least ${form.noticeDays} days' notice.` : ''}
            {method === 'email' && official && live && tenant.emailConsent ? ` Keyholder emails the official form to ${(tenant.people?.length ? tenant.people.map((p) => p.email) : [tenant.email]).filter(Boolean).join(', ')}.` : ''}</p>
          <div className="grid2">
            <Field label="Date delivered" htmlFor="fw-d"><input id="fw-d" type="date" className="input" value={servedOn} onChange={(e) => setServedOn(e.target.value)} /></Field>
            <Field label="Delivered by" htmlFor="fw-b"><input id="fw-b" className="input" value={servedBy} onChange={(e) => setServedBy(e.target.value)} /></Field>
          </div>
          <p className="small soft">Recorded as your proof of service.</p>
        </>
      )}
      {isLease && official && live ? (
        <>
          <h3 style={{ margin: '20px 0 8px' }}>Send it to sign</h3>
          <Seg label="How the tenant gets it" value={method} onChange={setMethod} options={[{ id: 'email', label: 'Email it to the tenant' }, { id: 'hand', label: "I'll give it in person" }]} />
          <p className="small soft" id="fw-lease-send">{method === 'email'
            ? `Keyholder emails the lease (PDF) to ${tenantPeople(tenant).map((p) => p.email).filter(Boolean).join(', ') || 'the tenant'}, with a copy to you. You and each tenant sign page 7 (on paper, or electronically if you both agree); then mark it signed.`
            : 'Print the lease (View lease above), sign page 7 with the tenant, and give them a copy within 21 days. Then mark it signed.'}</p>
        </>
      ) : (form.kind === 'agreement' || form.kind === 'report') && <p className="small soft" style={{ marginTop: 16 }}>Approving records these details with the lease. Keyholder does not send it to the tenant or sign it: print or send the lease yourself, and both of you sign it.</p>}

      <p className="small soft" style={{ marginTop: 16 }}><Icon name="info" size={14} /> A legal document: read it{official && live ? ' (open the form above)' : ''} before you approve{official ? `. Approving signs it as ${state.profile.name || 'you'}` : ''}.</p>
      {ok ? <SlideToConfirm label={form.kind === 'application' ? 'Slide to prepare the application' : form.kind === 'notice' ? 'Slide to approve and record' : isLease && official && live ? (method === 'email' ? 'Slide to approve and email it' : 'Slide to approve and save') : 'Slide to approve'} onConfirm={() => void approve()} />
        : <p className="urgent small">Fix the items above before approving.</p>}
    </Drawer>
  );
}

/** Pick a situation, then the right form for the property's province. */
export function SituationPicker({ lease, onClose, only }: { lease: Lease; onClose: () => void; only?: Situation }) {
  const { state } = useStore();
  const [sit, setSit] = useState<Situation | null>(only ?? null);
  const [form, setForm] = useState<FormDef | null>(null);
  const prop = propertyOf(state, lease)!;
  const tenant = state.tenants.find((t) => t.id === lease.tenantId)!;
  if (form) return <FormWizard lease={lease} formId={form.id} onClose={onClose} />;
  return (
    <Drawer title={sit ? SITUATIONS.find((s) => s.id === sit)!.label : `Forms for ${tenant.names[0]}`} onClose={onClose}>
      {!sit ? (
        <>
          <p className="soft" style={{ marginTop: 0 }}>What is happening? Keyholder picks the right {province(prop.province).name} form.</p>
          <div className="choices">{SITUATIONS.map((s) => <button key={s.id} className="choice" onClick={() => setSit(s.id)}><span className="t">{s.label}</span><span className="s">{s.hint}</span></button>)}</div>
        </>
      ) : (
        <>
          {!only && <button className="btn ghost small" onClick={() => setSit(null)} style={{ marginBottom: 12 }}><Icon name="back" size={14} />All situations</button>}
          <div className="stack">{formsFor(prop.province, sit).map((f) => (
            <button key={f.id} className="choice" onClick={() => setForm(f)}>
              <span className="t">{f.code} · {f.title}</span>
              <span className="s">{f.plain}</span>
              <span className="s">{f.official ? 'Official form' : 'Keyholder template'}{f.kind === 'application' ? ' · application to the tribunal' : ''}</span>
            </button>
          ))}</div>
        </>
      )}
    </Drawer>
  );
}
