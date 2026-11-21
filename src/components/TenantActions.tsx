import { useState } from 'react';
import type { Lease, Tenant } from '../data/types';
import { useStore } from '../data/store';
import { fmtDate } from '../lib/dates';
import { Drawer, Field, SlideToConfirm } from './ui';

// Ending a lease (a real move-out: the history stays) and deleting a tenant (added by mistake: everything goes).
// Both are on the ⋯ menu of each unit or room in Rentals, and at the top of the tenant's page.

/** End lease: the last day; no rent after it; the unit (or room) is free; receipts and the ledger are kept. */
export function EndLeaseDrawer({ lease, onClose }: { lease: Lease; onClose: () => void }) {
  const { state, act, today } = useStore();
  const t = state.tenants.find((x) => x.id === lease.tenantId);
  const name = t?.names.join(' & ') ?? 'this tenant';
  const [d, setD] = useState(today);
  return (
    <Drawer title="End lease" onClose={onClose}>
      <p style={{ marginTop: 0 }}>{name}{lease.room ? ` · ${lease.room}` : ''}, since {fmtDate(lease.start)}.</p>
      <Field label="Last day of the lease" htmlFor="et-d"><input id="et-d" type="date" className="input" value={d} min={lease.start} onChange={(e) => setD(e.target.value)} /></Field>
      <div className="callout warn">
        <strong>What happens:</strong> no rent is charged to {name} after this day, the {lease.room ? 'room' : 'unit'} shows as free and the vacancy counter starts. Their payments, receipts and notices are kept.
      </div>
      <SlideToConfirm label="Slide to end the lease" onConfirm={() => { act.endTenancy(lease.id, d); onClose(); }} />
    </Drawer>
  );
}

/** Delete tenant: for someone added by mistake. Suggests ending the lease instead when they have payments. */
export function DeleteTenantDrawer({ tenant, onClose, onDeleted, onEndInstead }: { tenant: Tenant; onClose: () => void; onDeleted?: () => void; onEndInstead?: () => void }) {
  const { state, act } = useStore();
  const name = tenant.names.join(' & ');
  const leases = state.leases.filter((l) => l.tenantId === tenant.id);
  const paid = state.payments.filter((p) => leases.some((l) => l.id === p.leaseId) && !p.voided).length;
  const live = leases.some((l) => !l.end);
  return (
    <Drawer title={`Delete ${name}?`} onClose={onClose}>
      <p style={{ marginTop: 0 }}>This removes {name} from Keyholder: their lease, {paid ? `${paid} payment${paid === 1 ? '' : 's'} and receipts` : 'payments and receipts'}, reminders and notices. It cannot be undone.</p>
      {paid > 0 && (
        <div className="callout warn">
          <strong>Did {tenant.names[0].split(' ')[0]} live there?</strong> End the lease instead: you keep their rent history and receipts, which you need for your taxes.
          {live && onEndInstead && <div className="btn-row" style={{ marginTop: 10 }}><button className="btn" onClick={onEndInstead}>End lease instead</button></div>}
        </div>
      )}
      <SlideToConfirm label="Slide to delete the tenant" onConfirm={() => { act.deleteTenant(tenant.id); onClose(); onDeleted?.(); }} />
    </Drawer>
  );
}
