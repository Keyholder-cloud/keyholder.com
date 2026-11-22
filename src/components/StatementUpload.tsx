import { useState } from 'react';
import { useStore } from '../data/store';
import type { Statement } from '../lib/statements';
import { fmtDate } from '../lib/dates';
import { fmt } from '../lib/money';
import { Drawer, Field } from './ui';
import { Icon } from './Icon';

// Upload a bank or credit card statement: any format (PDF, scans and photos, CSV, Excel, OFX/QFX/QBO, QIF). It is
// read on this device; every line is shown to check before anything is added. Money in is matched to rent (rent
// already marked paid is linked, never paid twice); money out becomes expenses to sort, filed by the vendor's
// remembered choice where there is one.

type Read = { file: File; st?: Statement; err?: string; include: boolean[]; bank: string; account: string; kind: 'bank' | 'card' };
const ACCEPT = '.pdf,.csv,.tsv,.txt,.xlsx,.xls,.ofx,.qfx,.qbo,.qif,image/*,application/pdf,text/csv';

export function UploadStatementButton({ className = 'btn', label = 'Upload statement' }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} id="upload-statement" onClick={() => setOpen(true)}><Icon name="paper" size={16} />{label}</button>
      {open && <StatementUpload onClose={() => setOpen(false)} />}
    </>
  );
}

export function StatementUpload({ onClose }: { onClose: () => void }) {
  const { act } = useStore();
  const [reads, setReads] = useState<Read[]>([]);
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState<{ added: number; duplicates: number } | null>(null);
  const pick = async (files: File[]) => {
    if (!files.length) return;
    const { readStatementFile } = await import('../lib/statementFiles');
    const out: Read[] = [];
    for (const f of files) {
      setBusy(`Reading ${f.name}…`);
      try {
        const st = await readStatementFile(f, (step, pct) => setBusy(`${f.name}: ${step}${pct ? ` (${pct}%)` : ''}…`));
        out.push({ file: f, st, include: st.lines.map(() => true), bank: st.bank ?? '', account: st.account ?? '', kind: st.kind });
      } catch (e) { out.push({ file: f, err: (e as Error).message || 'This file could not be read.', include: [], bank: '', account: '', kind: 'bank' }); }
    }
    setReads((r) => [...r, ...out]); setBusy('');
  };
  const update = (i: number, p: Partial<Read>) => setReads((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const flip = (i: number, kind: 'bank' | 'card') => {
    const r = reads[i]; if (!r.st || r.kind === kind) return;
    update(i, { kind, st: { ...r.st, kind, lines: r.st.lines.map((l) => ({ ...l, amount: -l.amount })) } });
  };
  const ready = reads.filter((r) => r.st && r.st.lines.length && r.bank.trim());
  const importAll = () => {
    let added = 0, duplicates = 0;
    for (const r of ready) { const x = act.importStatement(r.st!, { name: r.file.name, bank: r.bank.trim(), account: r.account.trim() || undefined, kind: r.kind }, r.include); added += x.added; duplicates += x.duplicates; }
    setDone({ added, duplicates });
  };

  if (done) return (
    <Drawer title="Statement added" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <p className="callout pine" role="status" id="statement-done"><Icon name="check" size={16} /> {done.added} line{done.added === 1 ? '' : 's'} added{done.duplicates ? `; ${done.duplicates} were already in Keyholder and were skipped` : ''}.</p>
      <p className="small">Money out is waiting under <strong>From your banks</strong> on Expenses (vendors you filed before are filed already). Money in that is rent was matched to your tenants; rent you already marked paid was linked, not counted twice.</p>
    </Drawer>
  );

  return (
    <Drawer title="Upload a bank statement" onClose={onClose} wide footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" id="statement-import" disabled={!ready.length || !!busy} onClick={importAll}>Add {reads.filter((r) => r.st).reduce((n, r) => n + r.include.filter(Boolean).length, 0)} lines</button>
    </>}>
      <p className="small" style={{ marginTop: 0 }}>For banks Keyholder cannot connect to, or months before you connected. Download the statement from your bank (PDF, CSV, Excel, OFX/QFX or QIF), or take a photo of a paper one. It is read on this device; you check every line before it is added.</p>
      <label className="upload-drop">
        <Icon name="paper" size={28} />
        <span><strong>Choose statements</strong><span className="small soft">Several at once is fine: a whole year, month by month.</span></span>
        <input id="statement-file" type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; void pick(fs); }} />
      </label>
      {busy && <p className="small soft" role="status"><span className="spinner" aria-hidden /> {busy}</p>}
      {reads.map((r, i) => (
        <section key={i} className="sheet statement-read">
          <div className="spread"><strong>{r.file.name}</strong><button className="btn ghost small" onClick={() => setReads((rs) => rs.filter((_, j) => j !== i))}>Remove</button></div>
          {r.err ? <p className="callout warn" role="alert">{r.err}</p> : r.st && <>
            <p className="small soft statement-facts">
              <span>{r.st.format.toUpperCase()}</span>
              {r.st.from && <span>{fmtDate(r.st.from)} – {fmtDate(r.st.to ?? r.st.from)}</span>}
              <span>{r.st.lines.length} lines</span>
              <span className={`st-check ${r.st.check}`}>{r.st.check === 'balanced' ? <><Icon name="check" size={13} /> Adds up to the statement's balances</> : r.st.check === 'mismatch' ? <><Icon name="alert" size={13} /> Does not add up: check the lines</> : 'No balances to check against'}</span>
            </p>
            {r.st.warnings.map((w) => <p key={w} className="tiny soft" style={{ margin: '2px 0' }}>{w}</p>)}
            <div className="grid3">
              <Field label="Bank" htmlFor={`st-bank-${i}`}><input id={`st-bank-${i}`} className="input" value={r.bank} placeholder="e.g. RBC Royal Bank" onChange={(e) => update(i, { bank: e.target.value })} /></Field>
              <Field label="Account (last 4, optional)" htmlFor={`st-acct-${i}`}><input id={`st-acct-${i}`} className="input" value={r.account} onChange={(e) => update(i, { account: e.target.value })} /></Field>
              <Field label="Type"><span className="seg-icons" role="radiogroup" aria-label="Statement type">
                <button role="radio" aria-checked={r.kind === 'bank'} onClick={() => flip(i, 'bank')}><Icon name="bank" size={14} />Bank</button>
                <button role="radio" aria-checked={r.kind === 'card'} onClick={() => flip(i, 'card')}><Icon name="cash" size={14} />Credit card</button>
              </span></Field>
            </div>
            {r.st.lines.length === 0 ? <p className="callout warn">No transactions were found in this file. If it is a statement, try the CSV or PDF version from your bank.</p> : (
              <div className="statement-lines"><table>
                <thead><tr><th><input type="checkbox" aria-label="All lines" checked={r.include.every(Boolean)} onChange={(e) => update(i, { include: r.include.map(() => e.target.checked) })} /></th><th>Date</th><th>Description</th><th className="num">Money in</th><th className="num">Money out</th></tr></thead>
                <tbody>{r.st.lines.map((l, j) => (
                  <tr key={j} className={r.include[j] ? '' : 'off'} title={l.raw}>
                    <td><input type="checkbox" aria-label={`Include ${l.description}`} checked={r.include[j]} onChange={(e) => update(i, { include: r.include.map((x, k) => (k === j ? e.target.checked : x)) })} /></td>
                    <td className="mono">{fmtDate(l.date)}</td><td>{l.description}</td>
                    <td className="num in">{l.amount > 0 ? fmt(l.amount) : ''}</td><td className="num">{l.amount < 0 ? fmt(-l.amount) : ''}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            {!r.bank.trim() && r.st.lines.length > 0 && <p className="tiny acct-error">Add the bank's name.</p>}
          </>}
        </section>
      ))}
    </Drawer>
  );
}
