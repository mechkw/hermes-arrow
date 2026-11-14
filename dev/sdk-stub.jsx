// A stand-in for @hermes/plugin-sdk, just enough to run the plugin in a plain browser tab.
import { useSyncExternalStore } from 'react';

export function atom(initial) {
  let value = initial; const subs = new Set();
  return {
    get: () => value,
    set(next) { value = next; for (const fn of [...subs]) fn(value); },
    subscribe(fn) { subs.add(fn); fn(value); return () => subs.delete(fn); },
    listen(fn) { subs.add(fn); return () => subs.delete(fn); }
  };
}
export const useValue = a => useSyncExternalStore(cb => a.listen(cb), a.get);

export const ROUTES_AREA = 'routes', SIDEBAR_NAV_AREA = 'sidebar.nav', PALETTE_AREA = 'palette';
export const STATUSBAR_AREAS = { left: 'statusBar.left', right: 'statusBar.right' };
export const COMPOSER_AREAS = { middleware: 'composer.middleware' };

export const events = new Map();
export const emit = (type, event) => { for (const fn of events.get(type) || []) fn(event); };
export const $route = atom('/');
export const host = {
  state: { busyBySession: atom({}) },
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
