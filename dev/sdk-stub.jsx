// A stand-in for @hermes/plugin-sdk, just enough to run the plugin in a plain browser tab.
import { Children, cloneElement, createContext, useContext, useEffect, useState } from 'react';

// The real store libraries, at the app's versions: a listener that throws inside `set` must behave here as it does there.
export { atom, computed } from 'nanostores';
export { useStore as useValue } from '@nanostores/react';
import { atom, computed } from 'nanostores';

export const ROUTES_AREA = 'routes', SIDEBAR_NAV_AREA = 'sidebar.nav', PALETTE_AREA = 'palette';
export const STATUSBAR_AREAS = { left: 'statusBar.left', right: 'statusBar.right' };
// `?old` plays an older Desktop that has no micro-action pill strip.
export const COMPOSER_AREAS = { middleware: 'composer.middleware', underside: 'composer.underside',
  ...(window.location.search.includes('old') ? {} : { microActions: 'composer.microActions' }) };

export const events = new Map();
export const emit = (type, event) => { for (const fn of events.get(type) || []) fn(event); };
export const $route = atom('/');
export const $sessionStates = atom({});
export const $usage = atom(null);
export const host = {
  // As in the app: busy is derived from the session-state store, so plugin listeners run inside the app's own writes.
  state: { focusedUsage: $usage, busyBySession: computed($sessionStates, states => Object.fromEntries(Object.entries(states).map(([id, st]) => [id, Boolean(st.busy)]))) },
  navigate(path) { window.location.hash = path; },
  notify() {}
};
export const haptic = () => {};

const look = {
  default: { background: 'var(--ui-accent)', color: 'var(--ui-base)' },
  outline: { background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--ui-stroke-secondary)' },
  ghost: { background: 'transparent' }
};
export function Button({ variant = 'default', size, style, children, ...rest }) {
  return <button type="button" {...rest} style={{ border: 0, borderRadius: 4, padding: size === 'sm' ? '4px 10px' : '6px 12px', font: 'inherit', fontSize: '0.8125rem',
    color: 'inherit', cursor: 'pointer', opacity: rest.disabled ? 0.45 : 1, ...look[variant], ...style }}>{children}</button>;
}
export const Tip = ({ label, children }) => <span title={label} style={{ display: 'inline-flex' }}>{children}</span>;

// Dialog, Popover and Switch: the same props the plugin passes to the real (Radix) ones.
export function Dialog({ open, onOpenChange, children }) {
  useEffect(() => {
    if (!open) return;
    const fn = e => { if (e.key === 'Escape') onOpenChange?.(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onOpenChange]);
  if (!open) return null;
  return <div data-stub-overlay="" onPointerDown={e => { if (e.target === e.currentTarget) onOpenChange?.(false); }}
    style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center', background: 'rgb(0 0 0 / 0.22)' }}>{children}</div>;
}
export function DialogContent({ children, style, showCloseButton, blurBackdrop, overlayClassName, onOpenAutoFocus, ...rest }) {
  return <div role="dialog" {...rest} style={{ position: 'relative', display: 'flex', flexDirection: 'column', borderRadius: 12, border: '1px solid var(--ui-stroke-secondary)', ...style }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 12, padding: '1rem', minHeight: 0, borderRadius: 'inherit' }}>{children}</div>
  </div>;
}
export const DialogTitle = ({ children, style }) => <h2 style={style}>{children}</h2>;

const PopoverState = createContext(null);
export function Popover({ children, open, onOpenChange }) {
  const own = useState(false), state = onOpenChange ? [!!open, onOpenChange] : own;
  return <PopoverState.Provider value={state}><span style={{ position: 'relative', display: 'inline-flex' }}>{children}</span></PopoverState.Provider>;
}
export function PopoverTrigger({ children }) { const [open, setOpen] = useContext(PopoverState); return cloneElement(children, { onClick: () => setOpen(!open), 'aria-expanded': open }); }
export function PopoverContent({ children, style, align, ...rest }) {
  const [open] = useContext(PopoverState);
  return open ? <div role="dialog" {...rest} style={{ position: 'absolute', top: '100%', right: 0, zIndex: 60, borderRadius: 5, background: 'var(--ui-bg-elevated)', border: '1px solid var(--ui-stroke-secondary)', ...style }}>{children}</div> : null;
}
// The themed select, drawn as a native one so tests can drive it.
export const SelectTrigger = () => null, SelectValue = () => null, SelectContent = () => null, SelectItem = () => null;
export function Select({ value, onValueChange, children }) {
  const kids = Children.toArray(children), trigger = kids.find(k => k.type === SelectTrigger), content = kids.find(k => k.type === SelectContent);
  return (
    <select data-themed="" aria-label={trigger?.props['aria-label']} value={value} onChange={e => onValueChange?.(e.target.value)}>
      {Children.map(content?.props.children, c => <option key={c.props.value} value={c.props.value}>{c.props.children}</option>)}
    </select>
  );
}
export const Switch = ({ checked, onCheckedChange, ...rest }) => <input type="checkbox" role="switch" checked={!!checked} onChange={e => onCheckedChange?.(e.target.checked)} {...rest} />;
