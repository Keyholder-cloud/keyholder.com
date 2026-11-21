import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

type MenuPos = { top?: number; bottom?: number; right: number };
export type MenuItem = { label: string; onClick?: () => void; danger?: boolean; note?: string; icon?: string };
/** ⋯ menu that floats above the page (never clipped by its card); opens upward near the bottom of the screen. */
export function FloatMenu({ items, label = 'More options', trigger, triggerClass = 'btn ghost small dots', id }: { items: MenuItem[]; label?: string; trigger?: React.ReactNode; triggerClass?: string; id?: string }) {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const place = (): MenuPos | null => {
    if (!btn.current) return null;
    const r = btn.current.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return null;
    const right = Math.max(8, window.innerWidth - r.right);
    return window.innerHeight - r.bottom < 140 ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right };
  };
  const toggle = () => setPos((p) => (p ? null : place()));
  const open = !!pos;
  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const follow = () => setPos(place());
    const down = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); btn.current?.focus(); } };
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key); window.removeEventListener('scroll', follow, true); window.removeEventListener('resize', follow); };
  }, [open]);
  return (
    <span className="row-menu">
      <button ref={btn} id={id} className={triggerClass} aria-label={trigger ? undefined : label} aria-haspopup="menu" aria-expanded={!!pos} onClick={toggle}>{trigger ?? '⋯'}</button>
      {pos && createPortal(
        <div ref={menu} className="row-menu-pop floating" role="menu" style={pos}>
          {items.map((it) => (
            <button key={it.label} role="menuitem" className={it.danger ? 'danger' : undefined} aria-disabled={!it.onClick || undefined} disabled={!it.onClick}
              onClick={() => { if (!it.onClick) return; setPos(null); it.onClick(); }}>
              {it.icon && <Icon name={it.icon} size={15} />}{it.label}{it.note && <span className="menu-note">{it.note}</span>}
            </button>
          ))}
        </div>, document.body)}
    </span>
  );
}

