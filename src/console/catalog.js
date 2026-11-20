// The games catalog: which games are on hand, and which are switched off.
//
// A game outside this bundle is a Desktop plugin of its own. The Desktop loads it (that is the only
// door plugin code may come through: this console never imports, evaluates or fetches a script), and
// the game hands the console a cartridge object through the slot below. Either side may load first
// and either may be reloaded at any time, so both create the slot if it is missing.
//
// Which games are switched off is kept in `catalog.json` in the console's own data folder (the
// Desktop's `ctx.files` door), so a person or an agent can manage the catalog by editing one file.

export const CONTRACT = 3;
export const CATALOG = 'catalog.json', GUIDE = 'README.txt';
/** A game's id is its plugin folder's name. It names the game's saved stats, so it never changes. */
export const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function slot() {
  const s = (globalThis.__hermesCartridges ||= {});
  if (!Array.isArray(s.list)) s.list = [];
  if (!(s.listeners instanceof Set)) s.listeners = new Set();
  return s;
}

/** Put a cartridge in the slot. Returns the function that takes it out again. (The guide's snippet does the same.) */
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

/**
 * Check what a game handed over. Returns { cart } with clean fields, or { id, error } in words a
 * person can act on. `taken` is the set of bundled game ids, which a custom game may not reuse.
 */
export function admit(raw, taken = new Set()) {
  const id = typeof raw?.id === 'string' ? raw.id : '';
  const no = error => ({ id: id || '(no id)', title: text(raw?.title, 40), error });
  if (!raw || typeof raw !== 'object') return no('the cartridge is not an object');
  if (!ID.test(id)) return no('the id must be lowercase letters, digits and dashes');
  if (taken.has(id)) return no(`"${id}" is a bundled game. A fork needs an id of its own`);
  if (raw.contract !== CONTRACT) return no(`built for contract ${JSON.stringify(raw.contract)}; this console speaks ${CONTRACT}`);
  const title = text(raw.title, 40);
  if (!title) return no('the cartridge needs a "title"');
  if (typeof raw.create !== 'function') return no('create(api) is missing');
  // A cover is an inline image. Anything else (a web address, a file path) is ignored, never fetched.
  const cover = typeof raw.cover === 'string' && /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/.test(raw.cover) && raw.cover.length < 400000 ? raw.cover : '';
  return { cart: { id, title, description: text(raw.description, 240), version: text(String(raw.version ?? ''), 20), glyph: [...text(raw.glyph, 8)].slice(0, 2).join(''), opaque: raw.opaque === true, cover, create: raw.create, source: raw } };
}

/** Parse catalog.json. A missing or broken file switches nothing off. */
export function readCatalog(source) {
  try {
    const c = JSON.parse(source);
    return { disabled: Array.isArray(c?.disabled) ? [...new Set(c.disabled.filter(d => typeof d === 'string'))] : [] };
  } catch (error) { return { disabled: [], error: `${CATALOG} is not valid JSON (${error.message})` }; }
}
export const writeCatalog = disabled => `${JSON.stringify({ disabled: [...disabled].sort() }, null, 2)}\n`;

export const GUIDE_TEXT = `Hermes Arrow: catalog folder

catalog.json lists the games that are switched off:

  {"disabled": ["game-id"]}

A game's id is shown under its title in the Library (the gear button in the game, then Library).
Bundled games are switched off the same way. At least one game always stays on.

Custom games are not kept here. Each one is a Desktop plugin of its own, in a folder beside
hermes-arrow in the desktop-plugins folder.

Writing a game, forking a bundled one, and the rules for agents:
https://github.com/mechkw/hermes-arrow/tree/main/skills/hermes-arrow-games
`;
