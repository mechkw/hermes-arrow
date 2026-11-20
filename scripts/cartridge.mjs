// Fork a bundled game, or build a game from src/cartridges into a Desktop plugin of its own.
//
//   node scripts/cartridge.mjs fork arrow my-arrow     copy src/cartridges/arrow to src/cartridges/my-arrow
//   node scripts/cartridge.mjs build my-arrow          bundle it into dist/cartridges/my-arrow/plugin.js
//
// The built folder is a complete Desktop plugin: copy it into the Desktop's plugins folder as it is.
// A bundled game is never edited in place: fork it, then switch the original off in the Library.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const fail = message => { console.error(message); process.exit(1); };
const [command, a, b] = process.argv.slice(2);
const src = name => `${root}src/cartridges/${name}/`;
const check = name => { if (!ID.test(name || '')) fail(`"${name}" is not a valid id: use lowercase letters, digits and dashes.`); };
const { version } = JSON.parse(readFileSync(root + 'package.json', 'utf8'));

if (command === 'fork') {
  check(a); check(b);
  if (!existsSync(src(a) + 'cartridge.json')) fail(`There is no game at src/cartridges/${a}.`);
  if (existsSync(src(b))) fail(`src/cartridges/${b} already exists.`);
  cpSync(src(a), src(b), { recursive: true });
  const manifest = JSON.parse(readFileSync(src(b) + 'cartridge.json', 'utf8'));
  manifest.title = `${manifest.title} (${b})`.slice(0, 40);
  manifest.version = '0.1.0';
  manifest.description = `A fork of ${a}. ${manifest.description}`.slice(0, 240);
  writeFileSync(src(b) + 'cartridge.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Forked ${a} to src/cartridges/${b}. Edit it, then: node scripts/cartridge.mjs build ${b}`);
} else if (command === 'build') {
  check(a);
  if (!existsSync(src(a) + 'index.jsx')) fail(`There is no game at src/cartridges/${a}.`);
  const out = `${root}dist/cartridges/${a}/`;
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const manifest = { version, ...JSON.parse(readFileSync(src(a) + 'cartridge.json', 'utf8')) };
  // The plugin wrapper: hand the game to the console through the slot, exactly as the guide's snippet does.
  const entry = `
import game from ${JSON.stringify(src(a) + 'index.jsx')};
${existsSync(src(a) + 'cover.png') ? `import cover from ${JSON.stringify(src(a) + 'cover.png')};` : `const cover = '';`}
const cartridge = { ...game, ...${JSON.stringify(manifest)}, id: ${JSON.stringify(a)}, cover };
export default {
  id: cartridge.id,
  name: cartridge.title + ' (Hermes Arrow game)',
  description: cartridge.description,
  register(ctx) {
    const slot = (globalThis.__hermesCartridges ||= {});
    const tell = () => (slot.listeners || []).forEach(fn => { try { fn(); } catch { /* the console's to handle */ } });
    slot.list = (slot.list || []).filter(c => c.id !== cartridge.id).concat(cartridge);
    tell();
    ctx.onDispose(() => { slot.list = (slot.list || []).filter(c => c !== cartridge); tell(); });
  }
};`;
  await build({
    bundle: true, format: 'esm', jsx: 'automatic', target: 'es2022', logLevel: 'warning', legalComments: 'none',
    loader: { '.mp3': 'base64', '.png': 'dataurl' },
    define: { __VERSION__: JSON.stringify(manifest.version) },
    stdin: { contents: entry, resolveDir: root, loader: 'js' }, outfile: out + 'plugin.js',
    // The only things a Desktop plugin may import.
    external: ['react', 'react/jsx-runtime'],
    banner: { js: `// ${manifest.title} ${manifest.version}: a game for Hermes Arrow, built from src/cartridges/${a}.` }
  });
  console.log(`Built dist/cartridges/${a}/plugin.js. Copy the ${a} folder into the Desktop's plugins folder.`);
} else {
  fail('Usage: node scripts/cartridge.mjs fork <bundled-game> <new-name> | build <name>');
}
