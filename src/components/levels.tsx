import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Mortgage, Property } from '../data/types';
import { useStore } from '../data/store';
import { levelInfo, propertyLevel, type Level } from '../lib/levels';
import { scoreTone } from '../lib/score';
import { portfolio } from '../lib/finance';
import { benchmarks } from '../lib/jurisdiction';
import { fmtShort } from '../lib/money';
import { Drawer, Field, MoneyInput, Seg } from './ui';
import { MortgageFields, newMortgage } from './forms';

// ---------- Stage chip: a small metal swatch with the stage name ----------
export function LevelBadge({ level, plain }: { level: Level; plain?: boolean }) {
  const info = levelInfo(level);
  return (
    <span className={`level-badge ${level}`} title={`${info.name}: ${info.gives}`}>
      <span className="swatch" aria-hidden />
      {!plain && <span>{info.name}</span>}
    </span>
  );
}

// Remember each card's last stage across renders so an upgrade can play its glow once.
const seenStage = new Map<string, Level>();

// ---------- The living property card: its metal shows the property's stage ----------
export function PropertyCard({ property, active, banner }: { property: Property; active?: boolean; banner?: boolean }) {
  const { state, today } = useStore();
  const nav = useNavigate();
  const level = propertyLevel(state, property);
  const row = useMemo(() => portfolio(state, today).rows.find((r) => r.property.id === property.id), [state, today, property.id]);
  const ref = useRef<HTMLDivElement>(null);
  const [upgraded, setUpgraded] = useState(false);

  useEffect(() => {
    const was = seenStage.get(property.id);
    seenStage.set(property.id, level);
    if (was && levelInfo(level).rank > levelInfo(was).rank) {
      setUpgraded(true);
      const t = setTimeout(() => setUpgraded(false), 2600);
      return () => clearTimeout(t);
    }
  }, [level, property.id]);

  // 3D tilt toward the pointer, with a moving highlight. Mouse and pen only; touch keeps the card flat.
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const k = banner ? 0.35 : 1;
    ref.current.style.setProperty('--ry', `${(x - 0.5) * 12 * k}deg`);
    ref.current.style.setProperty('--rx', `${(0.5 - y) * 10 * k}deg`);
    ref.current.style.setProperty('--mx', `${x * 100}%`);
    ref.current.style.setProperty('--my', `${y * 100}%`);
  };
  const onLeave = () => { ref.current?.style.setProperty('--rx', '0deg'); ref.current?.style.setProperty('--ry', '0deg'); };
  if (!row) return null;
  const none = row.valueInfo.basis === 'none';

  return (
    <div ref={ref} className={`pcard ${level}${active ? ' active' : ''}${upgraded ? ' upgraded' : ''}${banner ? ' banner' : ''}`}
      onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className="pcard-light" aria-hidden />
      <button className="pcard-name" onClick={() => !banner && nav(`/rent/property/${property.id}`)} tabIndex={banner ? -1 : 0}>
        <span className="pcard-stage">{levelInfo(level).name}</span>
        <span className="pcard-title">{property.nickname}</span>
        <span className="pcard-addr">{property.address}, {property.city}</span>
      </button>
      <div className="pcard-figs">
        <div><span>Worth</span><strong>{none ? '—' : fmtShort(row.value)}</strong></div>
        <div><span>Yours</span><strong>{row.owedKnown && !none ? fmtShort(row.yours) : '—'}</strong></div>
        <div><span>Return a year</span><strong>{row.returnPct === null ? '—' : `${row.returnPct.toFixed(1)}%`}</strong>{row.returnPct !== null && <em className="vs-gic">GIC {benchmarks().gic.pct}%</em>}</div>
      </div>
      <div className="pcard-source">{none ? 'Step 1 of 2: add what you paid' : `${row.valueInfo.source}${!row.owedKnown ? ' · add what is owed' : ''}`}</div>
    </div>
  );
}


/** Setup progress ring: the bar is the brand indigo; the inner circle stays plain. */
export function ScoreRing({ score, big }: { score: number; big?: boolean }) {
  return (
    <span className={`score-ring tone-${scoreTone(score)}${big ? ' big' : ''}`}
      style={{ ['--p' as string]: `${score}`, ['--ring' as string]: '1' }}>
      <span>{score}</span>
    </span>
  );
}


// ---------- The way up, one step at a time: Bronze → Silver (what you paid) → Gold (the mortgage) ----------
const STEPS: { to: Level; title: string; gives: string }[] = [
  { to: 'silver', title: 'Add what you paid', gives: 'What it is worth to you, your gain since buying, your return next to a GIC, room to borrow.' },
  { to: 'gold', title: 'Add your mortgage', gives: 'What you still owe, mortgage interest for your taxes, depreciation, and what you would keep if you sold.' },
];

/**
 * The property's steps as one numbered path. The step to do now has the only button; a later step is greyed
 * ("Do step 1 first"); a done step is ticked. Replaces the separate invitations that each asked the same thing.
 */
export function LevelSteps({ property, onOwnEstimate }: { property: Property; onOwnEstimate?: () => void }) {
  const { state } = useStore();
  const [open, setOpen] = useState<Level | null>(null);
  const level = propertyLevel(state, property);
  const done = (to: Level) => levelInfo(level).rank >= levelInfo(to).rank;
  const now = STEPS.findIndex((s) => !done(s.to));
  if (now < 0) return null;
  return (
    <div className="sheet level-steps" id="level-steps">
      <div className="ls-head"><LevelBadge level={level} /><span className="small soft">Step {now + 1} of {STEPS.length}</span></div>
      <ol>{STEPS.map((s, i) => {
        const state = done(s.to) ? 'done' : i === now ? 'now' : 'later';
        return (
          <li key={s.to} className={`ls-step ${state}`} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="ls-n" aria-hidden>{state === 'done' ? '✓' : i + 1}</span>
            <div>
              <strong>{s.title}</strong> <span className="ls-to">→ {levelInfo(s.to).name}</span>
              <p className="small soft">{state === 'later' ? `Do step ${now + 1} first.` : s.gives}</p>
            </div>
            {state === 'now' && <button className="btn primary" id={s.to === 'silver' ? 'add-paid' : 'add-mortgage'} onClick={() => setOpen(s.to)}>{s.title}</button>}
            {state === 'done' && <span className="small soft">Done</span>}
          </li>
        );
      })}</ol>
      {onOwnEstimate && now === 0 && <p className="small soft" style={{ margin: '12px 0 0' }}>Have a recent appraisal? <button className="link-btn" id="add-own" onClick={onOwnEstimate}>Use your own estimate instead</button> (optional).</p>}
      {open && <LevelUpForm property={property} to={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---------- Short forms that move a property up one level ----------
export function LevelUpForm({ property, to, onClose }: { property: Property; to: Level; onClose: () => void }) {
  return to === 'gold' ? <GoldForm property={property} onClose={onClose} /> : <SilverForm property={property} onClose={onClose} />;
}

function SilverForm({ property, onClose }: { property: Property; onClose: () => void }) {
  const { act, today } = useStore();
  const [date, setDate] = useState(property.purchaseDate ?? '');
  const [price, setPrice] = useState(property.purchasePrice);
  const [owed, setOwed] = useState(property.approxMortgageBalance);
  const [pay, setPay] = useState(property.approxMortgagePayment);
  const ok = !!date && !!price;
  return (
    <Drawer title="What you paid" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={() => { act.saveProperty({ ...property, purchaseDate: date, purchasePrice: price, approxMortgageBalance: owed, approxMortgagePayment: pay }); onClose(); }}>Save</button></>}>
      <p className="soft" style={{ marginTop: 0 }}>{property.nickname}</p>
      <div className="grid2">
        <Field label="Price you paid" htmlFor="sv-price"><MoneyInput id="sv-price" value={price} onChange={setPrice} autoFocus /></Field>
        <Field label="Date you bought it" htmlFor="sv-date"><input id="sv-date" type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <h3 style={{ margin: '8px 0 4px' }}>Mortgage, roughly <span className="soft small">(optional)</span></h3>
      <p className="small soft" style={{ marginTop: 0 }}>A rough number is fine. It shows what's yours after the mortgage.</p>
      <div className="grid2">
        <Field label="Still owed" htmlFor="sv-owed"><MoneyInput id="sv-owed" value={owed} onChange={setOwed} /></Field>
        <Field label="Monthly payment" htmlFor="sv-pay"><MoneyInput id="sv-pay" value={pay} onChange={setPay} /></Field>
      </div>
    </Drawer>
  );
}

function GoldForm({ property, onClose }: { property: Property; onClose: () => void }) {
  const { state, act, today } = useStore();
  const existing = state.mortgages.find((m) => m.propertyId === property.id);
  const [closing, setClosing] = useState(property.closingCosts);
  const [ltt, setLtt] = useState(property.landTransferTax);
  const [has, setHas] = useState<'yes' | 'no'>(property.mortgageFree ? 'no' : 'yes');
  const [m, setM] = useState<Mortgage>(() => existing ?? newMortgage(property.id, today, property.approxMortgageBalance ?? 0));
  const ok = closing !== undefined && ltt !== undefined && (has === 'no' || (!!m.lender && m.principal > 0));
  const save = () => {
    act.saveProperty({ ...property, closingCosts: closing, landTransferTax: ltt, mortgageFree: has === 'no' });
    if (has === 'yes') act.saveMortgage(m);
    onClose();
  };
  return (
    <Drawer title="Mortgage and purchase costs" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={save}>Save</button></>}>
      <p className="soft" style={{ marginTop: 0 }}>{property.nickname}</p>
      <h3 style={{ marginBottom: 8 }}>Costs when you bought</h3>
      <p className="small soft" style={{ marginTop: 0 }}>On your lawyer's statement. Enter 0 if none.</p>
      <div className="grid2">
        <Field label="Closing costs" htmlFor="gd-cc" hint="Lawyer, inspection, title insurance"><MoneyInput id="gd-cc" value={closing} onChange={setClosing} autoFocus /></Field>
        <Field label="Land transfer tax" htmlFor="gd-ltt"><MoneyInput id="gd-ltt" value={ltt} onChange={setLtt} /></Field>
      </div>
      <Field label="Is there a mortgage?"><Seg label="Mortgage" value={has} onChange={setHas} options={[{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No, it is paid off' }]} /></Field>
      {has === 'yes' && <MortgageFields m={m} onChange={setM} isNew={!existing} />}
    </Drawer>
  );
}
