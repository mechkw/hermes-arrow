// The library: games that live as folders in the cartridges folder, outside the plugin.
//
// The cartridges folder is the plugin's own data folder (the Desktop's `ctx.files` door, handle
// 'data'). Every directory in it that holds a valid `cartridge.json` and the script it names is a
// custom game. `catalog.json` beside them records which games are switched off, so an agent or a
// person can manage the catalog by editing one small file. Nothing here touches the DOM except
// `load`, which imports a game's script; the rest runs under test with a fake file door.

export const CONTRACT = 2;
export const MANIFEST = 'cartridge.json', CATALOG = 'catalog.json', GUIDE = 'README.txt';
/** A cartridge's directory name is its id: it names the game's saved stats, so it never changes. */
export const DIR = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Parse and check a cartridge.json. Returns { manifest } or { error } in words a person can act on. */
export function readManifest(source) {
  let m;
  try { m = JSON.parse(source); } catch (error) { return { error: `${MANIFEST} is not valid JSON (${error.message})` }; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { error: `${MANIFEST} must be a JSON object` };
  if (m.contract !== CONTRACT) return { error: `built for contract ${JSON.stringify(m.contract)}; this console speaks ${CONTRACT}` };
  const title = text(m.title, 40);
  if (!title) return { error: `${MANIFEST} needs a "title"` };
  const main = m.main === undefined ? 'cartridge.js' : m.main, cover = m.cover === undefined ? '' : m.cover;
  if (typeof main !== 'string' || !FILE.test(main) || !/\.m?js$/.test(main)) return { error: '"main" must name a .js file in the same folder' };
  if (cover !== '' && (typeof cover !== 'string' || !FILE.test(cover) || !/\.(png|jpe?g|webp|gif|svg)$/i.test(cover))) return { error: '"cover" must name an image file in the same folder' };
  return { manifest: { title, description: text(m.description, 240), version: text(String(m.version ?? ''), 20), glyph: [...text(m.glyph, 8)].slice(0, 2).join(''), main, cover } };
}

/** Parse catalog.json. A missing or broken file switches nothing off. */
export function readCatalog(source) {
  try {
    const c = JSON.parse(source);
    return { disabled: Array.isArray(c?.disabled) ? [...new Set(c.disabled.filter(d => typeof d === 'string'))] : [] };
  } catch (error) { return { disabled: [], error: `${CATALOG} is not valid JSON (${error.message})` }; }
}
export const writeCatalog = disabled => `${JSON.stringify({ disabled: [...disabled].sort() }, null, 2)}\n`;

/**
 * Read the cartridges folder. `taken` is the set of bundled game ids, which a custom game may not reuse.
 * Returns { available, entries, disabled, catalogError }: one entry per directory, either a game
 * (`title`, `main`, `mtimeMs`…) or a reason it was not loaded (`error`).
 */
export async function scan(files, taken = new Set()) {
  if (!files?.list) return { available: false, entries: [], disabled: null };
  const root = await files.list('data', '');
  if (!root?.ok) return { available: false, entries: [], disabled: null };
  const entries = [];
  for (const item of [...root.entries].filter(e => e.isDirectory && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = item.name, entry = { dir };
    entries.push(entry);
    if (!DIR.test(dir)) { entry.error = 'the folder name must be lowercase letters, digits and dashes'; continue; }
    if (taken.has(dir)) { entry.error = `"${dir}" is a bundled game. A fork needs a folder name of its own`; continue; }
    const file = await files.readText('data', `${dir}/${MANIFEST}`);
    if (!file?.ok) { entry.error = file?.error === 'not-found' ? `no ${MANIFEST} in this folder` : `${MANIFEST} could not be read (${file?.error || 'unknown'})`; continue; }
    const { manifest, error } = readManifest(file.text);
    if (error) { entry.error = error; continue; }
    Object.assign(entry, manifest);
    const main = await files.stat('data', `${dir}/${manifest.main}`);
    if (!main?.ok || !main.exists || main.isDirectory) { entry.error = `${manifest.main} is missing`; continue; }
    entry.mtimeMs = Math.max(main.mtimeMs || 0, file.mtimeMs || 0);
  }
  let disabled = [], catalogError;
  const catalog = await files.readText('data', CATALOG);
  if (catalog?.ok) ({ disabled, error: catalogError } = readCatalog(catalog.text));
  return { available: true, entries, disabled, catalogError };
}

// A cartridge's script may import React and nothing else. Those two specifiers are pointed at small
// modules that re-export the console's own React, the same way the Desktop does it for plugins.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(react\/jsx-runtime|react)\2/g;
export const rewrite = (source, urls) => source.replace(SPECIFIER, (all, lead, quote, name) => (urls[name] ? `${lead}${quote}${urls[name]}${quote}` : all));
/** Module source that re-exports everything on `globalThis[key]`. */
export const shimSource = (key, names) => `const m = globalThis[${JSON.stringify(key)}];\nexport default m.default ?? m;\n` +
  (names.length ? `export const { ${names.join(', ')} } = m;\n` : '');
export const exportNames = ns => Object.keys(ns).filter(name => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name));

/** Import a cartridge's script and return its `create(api)`. Throws with a readable reason. */
export async function load(source, urls) {
  const url = URL.createObjectURL(new Blob([rewrite(source, urls)], { type: 'text/javascript' }));
  let mod;
  try { mod = await import(/* @vite-ignore */ url); }
  catch (error) { throw new Error(/resolve module specifier|bare specifier/i.test(String(error?.message)) ? `the script imports something other than react (${error.message})` : `the script failed to load (${error?.message || error})`); }
  finally { URL.revokeObjectURL(url); }
  const create = typeof mod.default === 'function' ? mod.default : mod.default?.create || mod.create;
  if (typeof create !== 'function') throw new Error('the script must default-export create(api)');
  return create;
}

export const GUIDE_TEXT = `Hermes Arrow: cartridges folder

Each folder here is a custom game for Hermes Arrow. A game folder holds:

  cartridge.json   title, description, version, cover and the script's name
  cartridge.js     the game
  cover.png        optional thumbnail for the Library

catalog.json lists the games that are switched off: {"disabled": ["folder-name"]}.
The Library (the gear button in the game, then Library) shows every game found here and
says why a folder was not loaded.

Writing a game, forking a bundled one, and the rules for agents:
https://github.com/mechkw/hermes-arrow/tree/main/skill/hermes-arrow-games
`;
