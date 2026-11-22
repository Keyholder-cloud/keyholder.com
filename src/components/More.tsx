import { useState } from 'react';
import { useStore } from '../data/store';
import { Icon } from './Icon';

// Long lists (ledgers, payments, messages, notices) show 8 lines first; "Show more" adds the rest in steps.
export const FIRST = 8;

/** The first `n` items, then more on request. Returns the items to show and the button (null when all fit). */
export function useMore<T>(items: T[], n = FIRST): [T[], React.ReactNode] {
  const [shown, setShown] = useState(n);
  const left = items.length - shown;
  const button = items.length > n ? (
    <div className="more-row">
      {left > 0 ? <button type="button" className="btn ghost small show-more" onClick={() => setShown((s) => s + 20)}><Icon name="next" size={14} />Show more ({left})</button>
        : <button type="button" className="btn ghost small show-more" onClick={() => setShown(n)}>Show fewer</button>}
    </div>
  ) : null;
  return [items.slice(0, shown), button];
}

/** Sends a rent receipt again (a PDF copy with the same number), or for the first time if it was a draft. */
export function ResendReceipt({ receiptId, label = 'Resend' }: { receiptId: string; label?: string }) {
  const { act } = useStore();
  const [sent, setSent] = useState(false);
  return (
    <button type="button" className="btn small ghost resend-receipt" disabled={sent} title="Email this receipt to the tenant again (PDF)"
      onClick={(e) => { e.stopPropagation(); act.resendReceipt(receiptId); setSent(true); }}>
      <Icon name={sent ? 'check' : 'send'} size={14} />{sent ? 'Sent' : label}
    </button>
  );
}
