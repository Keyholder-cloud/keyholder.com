import { useEffect, useRef, useState } from 'react';
import { useStore } from '../data/store';
import { activeLeases } from '../lib/finance';
import { tenantPeople } from '../lib/people';
import { clock, hoursUntil, outsideHours, URGENCY, VISIT_KINDS } from '../lib/visits';
import { fmtDate } from '../lib/dates';
import { Drawer, Field } from './ui';
import { Icon } from './Icon';

/** Notify everyone in a unit of a visit (inspection, maintenance…); the landlord gets a copy. */
export function VisitNoticeDrawer({ unitId, onClose }: { unitId?: string; onClose: () => void }) {
  const { state, act, today } = useStore();
  const units = state.units.filter((u) => state.properties.some((p) => p.id === u.propertyId && !p.archived) && activeLeases(state, u.id, today).length > 0);
  const [uid, setUidRaw] = useState(unitId && units.some((u) => u.id === unitId) ? unitId : units[0]?.id ?? '');
  // Opened for a unit before the account's data has loaded: pick that unit once it is there (unless changed by hand).
  const touched = useRef(false);
  const setUid = (v: string) => { touched.current = true; setUidRaw(v); };
  const ready = units.map((u) => u.id).join(',');
  useEffect(() => {
    if (touched.current) return;
    if (unitId && units.some((u) => u.id === unitId)) setUidRaw(unitId);
    else if (!units.some((u) => u.id === uid) && units[0]) setUidRaw(units[0].id);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [kind, setKind] = useState<string>(VISIT_KINDS[0]);
  const [urgency, setUrgency] = useState('');
  const [notes, setNotes] = useState('');
  const unit = state.units.find((u) => u.id === uid);
  const prop = state.properties.find((p) => p.id === unit?.propertyId);
  const people = unit ? activeLeases(state, unit.id, today).flatMap((l) => { const t = state.tenants.find((x) => x.id === l.tenantId); return t ? tenantPeople(t) : []; }) : [];
  const noEmail = people.filter((p) => !p.email);
  // Emailed anyway; a tenant who has not agreed to notices by email should also get a paper copy.
  const leasesHere = unit ? activeLeases(state, unit.id, today) : [];
  const paper = leasesHere.map((l) => state.tenants.find((x) => x.id === l.tenantId)).filter((t) => t && !t.emailConsent && t.noticeMethod !== 'email').flatMap((t) => tenantPeople(t!).filter((p) => p.email).map((p) => p.name.split(' ')[0]));
  const hours = date ? hoursUntil(date, time) : Infinity;
  const short = hours < 24;
  const past = hours < 0;
  const ok = !!unit && !!date && !!time && !past && (!short || !!urgency) && people.length > 0;
  const send = () => { act.sendVisitNotice({ unitId: uid, date, time, kind, ...(short ? { urgency } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) }); onClose(); };
  return (
    <Drawer title="Notify tenants of a visit" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" id="vn-send" disabled={!ok} onClick={send}><Icon name="send" size={16} />Send notice</button></>}>
      {units.length === 0 ? <p className="soft">No units with tenants yet.</p> : <>
        <Field label="Unit" htmlFor="vn-unit">
          <select id="vn-unit" className="input" value={uid} onChange={(e) => setUid(e.target.value)}>
            {units.map((u) => { const p = state.properties.find((x) => x.id === u.propertyId); return <option key={u.id} value={u.id}>{p?.nickname} · {/^[A-Z0-9]{1,3}$/i.test(u.label) ? `Unit ${u.label}` : u.label}</option>; })}
          </select>
        </Field>
        {people.length > 0 && <p className="small soft" id="vn-to" style={{ marginTop: -4 }}>To {people.map((p) => p.name).join(', ')}, with a copy to you{prop ? ` · ${prop.address}` : ''}.</p>}
        {paper.length > 0 && <p className="small callout" id="vn-paper">{paper.join(' and ')} {paper.length === 1 ? 'has' : 'have'} not agreed to notices by email. They will get this email too; for a notice that counts, also give them a paper copy.</p>}
        {noEmail.length > 0 && <p className="small callout warn">{noEmail.map((p) => p.name.split(' ')[0]).join(' and ')} {noEmail.length === 1 ? 'has' : 'have'} no email: give {noEmail.length === 1 ? 'them' : 'them'} a paper copy.</p>}
        <div className="grid2">
          <Field label="Date" htmlFor="vn-date"><input id="vn-date" type="date" className="input" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Time" htmlFor="vn-time"><input id="vn-time" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        {past && <p className="small acct-error" role="alert">That time has passed.</p>}
        {outsideHours(time) && urgency !== 'Emergency' && <p className="small callout warn">Entry is usually allowed only between 8 a.m. and 8 p.m., unless it is an emergency or the tenant agrees.</p>}
        <Field label="Visit type" htmlFor="vn-kind">
          <select id="vn-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>{VISIT_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        </Field>
        {short && !past && <Field label="Less than 24 hours' notice: why?" htmlFor="vn-urg" hint="Most provinces ask for at least 24 hours' written notice, except in an emergency or when the tenant agrees.">
          <div className="seg" role="radiogroup" id="vn-urg" aria-label="Urgency">{URGENCY.map((u) => <button key={u} type="button" role="radio" aria-checked={urgency === u} onClick={() => setUrgency(u)}>{u}</button>)}</div>
        </Field>}
        <Field label="Notes (optional)" htmlFor="vn-notes"><textarea id="vn-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. The plumber will check the kitchen sink. About 30 minutes." maxLength={1000} /></Field>
        {date && !past && <p className="small soft">Sends now: {kind.toLowerCase()} on {fmtDate(date)} at {clock(time)}{short ? ` · ${Math.max(0, Math.round(hours))} hours' notice` : ''}</p>}
      </>}
    </Drawer>
  );
}

/** Visit notices sent, newest first, with a button to send one (Paperwork → Notices). */
export function VisitNotices({ openFor }: { openFor?: string }) {
  const { state } = useStore();
  const [open, setOpen] = useState<boolean>(!!openFor);
  const vs = state.visits ?? [];
  return (
    <section className="section" id="visit-notices">
      <div className="spread" style={{ marginBottom: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Visits: inspections and maintenance</h2>
        <button className="btn primary" id="visit-new" onClick={() => setOpen(true)}><Icon name="send" size={16} />Notify tenants of a visit</button>
      </div>
      <div className="sheet">
        {vs.length === 0 ? <p className="soft" style={{ margin: 0 }}>No visit notices yet. Tell everyone in a unit about an inspection or repair, with a copy to you.</p> : (
          <ul className="rows">{vs.slice(0, 20).map((v) => {
            const u = state.units.find((x) => x.id === v.unitId); const p = state.properties.find((x) => x.id === u?.propertyId);
            return <li key={v.id} className="row"><span className="margin">{fmtDate(v.date)}</span><span><span className="title">{v.urgency ? 'Urgent · ' : ''}{v.kind} at {clock(v.time)} · {p?.nickname} {u ? (/^[A-Z0-9]{1,3}$/i.test(u.label) ? `Unit ${u.label}` : u.label) : ''}</span><span className="sub" style={{ display: 'block' }}>To {v.to.join(', ')} · sent {fmtDate(v.sentAt.slice(0, 10))}{v.notes ? ` · ${v.notes}` : ''}</span></span></li>;
          })}</ul>
        )}
      </div>
      {open && <VisitNoticeDrawer unitId={openFor} onClose={() => setOpen(false)} />}
    </section>
  );
}
