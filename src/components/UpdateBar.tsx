import { useEffect, useState } from 'react';
import { getConn, serverMode } from '../data/api';

/**
 * "Keyholder was updated" with a Reload button. A tab left open keeps running the version it loaded; the server
 * reports a fingerprint of the app it serves, checked every few minutes and whenever the tab comes back.
 */
export function UpdateBar() {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const mine = serverMode() ? getConn().config?.build : undefined;
    if (!mine) return;
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/session', { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' });
        const b = (await r.json()) as { config?: { build?: string } };
        if (!stop && b.config?.build && b.config.build !== mine) setFresh(true);
      } catch { /* offline: try again later */ }
    };
    const t = setInterval(check, 5 * 60_000);
    document.addEventListener('visibilitychange', check);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!fresh) return null;
  return (
    <div className="update-bar" role="status">
      <span>Keyholder was updated. Reload to get the latest version.</span>
      <button className="btn small primary" onClick={() => location.reload()}>Reload</button>
    </div>
  );
}
