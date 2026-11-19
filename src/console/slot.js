// The cartridge slot: how a game that lives in its own Desktop plugin reaches the console.
//
// Every Desktop plugin is loaded into the same window, so the slot is one plain object on
// `globalThis`. A cartridge pushes itself onto `list` and calls the listeners; the console reads the
// list. Either side may load first, and either may be reloaded at any time, so both create the
// object if it is missing and neither keeps anything else there. docs/CARTRIDGES.md has the few
// lines a cartridge needs.

export const CONTRACT = 1;

export function slot() {
  const s = (globalThis.__hermesCartridges ||= {});
  if (!Array.isArray(s.list)) s.list = [];
  if (!(s.listeners instanceof Set)) s.listeners = new Set();
  return s;
}

/** Why a cartridge cannot be loaded, or '' when it can. */
export function refusal(cart) {
  if (!cart || typeof cart !== 'object') return 'not an object';
  if (typeof cart.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(cart.id)) return 'id must be lowercase letters, digits and dashes';
  if (typeof cart.name !== 'string' || !cart.name.trim()) return 'name is missing';
  if (typeof cart.create !== 'function') return 'create(api) is missing';
  if (cart.contract !== CONTRACT) return `built for contract ${cart.contract}, this console speaks ${CONTRACT}`;
  return '';
}

/** Put a cartridge in the slot. Returns the function that takes it out again. */
export function insert(cart) {
  const s = slot(), tell = () => { for (const fn of [...s.listeners]) { try { fn(); } catch { /* a listener's failure is its own */ } } };
  s.list = s.list.filter(c => c?.id !== cart?.id).concat(cart);
  tell();
  return () => { s.list = s.list.filter(c => c !== cart); tell(); };
}

/** Call `fn` whenever a cartridge goes in or comes out. Returns the function that stops it. */
export function watch(fn) {
  const s = slot();
  s.listeners.add(fn);
  return () => s.listeners.delete(fn);
}
