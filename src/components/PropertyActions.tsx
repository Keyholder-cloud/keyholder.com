import { useState } from 'react';
import type { Property, Unit } from '../data/types';
import { useStore } from '../data/store';
import { activeLeases } from '../lib/finance';
import { Drawer, Field, Seg, SlideToConfirm } from './ui';

// Archiving a property (sold, or no longer rented) and deleting a unit that never had a tenant.

/** A unit can be deleted only if it never had a tenant (a lease keeps the rent history for taxes). */
export const canDeleteUnit = (state: ReturnType<typeof useStore>['state'], unitId: string) => !state.leases.some((l) => l.unitId === unitId);

export function DeleteUnitDrawer({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const { state, act } = useStore();
  const ok = canDeleteUnit(state, unit.id);
  const apps = state.applicants.filter((a) => a.unitId === unit.id).length;
  return (
    <Drawer title={`Delete Unit ${unit.label}?`} onClose={onClose}>
      {ok ? (
        <>
          <p style={{ marginTop: 0 }}>Unit {unit.label} has never had a tenant, so nothing else changes.{apps ? ` Its listing and ${apps} application${apps === 1 ? '' : 's'} are removed too.` : ''}</p>
          <SlideToConfirm label="Slide to delete the unit" onConfirm={() => { act.deleteUnit(unit.id); onClose(); }} />
        </>
      ) : (
        <div className="callout warn">Unit {unit.label} has had tenants, so its rent history is kept for your taxes and it cannot be deleted. If the property was sold, archive the property instead.</div>
      )}
    </Drawer>
  );
}

/** Archive: the day it was sold or stopped being rented; running leases end that day; records stay. */
export function ArchivePropertyDrawer({ property, onClose, onDone }: { property: Property; onClose: () => void; onDone?: () => void }) {
  const { state, act, today } = useStore();
  const [on, setOn] = useState(today);
  const [reason, setReason] = useState<'sold' | 'not-rented'>('sold');
  const unitIds = new Set(state.units.filter((u) => u.propertyId === property.id).map((u) => u.id));
  const running = [...unitIds].flatMap((id) => activeLeases(state, id, today));
  const names = running.map((l) => state.tenants.find((t) => t.id === l.tenantId)?.names[0]).filter(Boolean);
  return (
    <Drawer title={`Archive ${property.nickname}`} onClose={onClose}>
      <Field label="Why?"><Seg label="Why archive?" value={reason} onChange={setReason} options={[{ id: 'sold', label: 'Sold' }, { id: 'not-rented', label: 'No longer rented' }]} /></Field>
      <Field label={reason === 'sold' ? 'Date sold' : 'Last day rented'} htmlFor="ar-on"><input id="ar-on" type="date" className="input" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
      <div className="callout">
        <strong>What happens:</strong>
        <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
          {names.length > 0 && <li>{names.length === 1 ? `${names[0]}'s lease ends` : `${names.length} leases end (${names.join(', ')})`} on this date.</li>}
          <li>It leaves Home, Rentals and your totals. Listings close.</li>
          <li>Its rent, costs, receipts and notices are kept. Your taxes still count it up to this date.</li>
          <li>You can restore it any time from the bottom of Rentals.</li>
        </ul>
      </div>
      <SlideToConfirm label="Slide to archive the property" onConfirm={() => { act.archiveProperty(property.id, on, reason); onClose(); onDone?.(); }} />
    </Drawer>
  );
}
