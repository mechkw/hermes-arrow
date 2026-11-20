// Fork a bundled game, or build a game from src/cartridges into a folder ready for the cartridges folder.
//
//   node scripts/cartridge.mjs fork arrow my-arrow     copy src/cartridges/arrow to src/cartridges/my-arrow
//   node scripts/cartridge.mjs build my-arrow          bundle it into dist/cartridges/my-arrow/
//
// The built folder holds cartridge.json, cartridge.js and the cover: copy it into the cartridges
// folder as it is. A bundled game is never edited in place: fork it, then switch the original off.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const DIR = /^[a-z0-9][a-z0-9-]{0,63}$/;
const fail = message => { console.error(message); process.exit(1); };
const [command, a, b] = process.argv.slice(2);
const src = name => `${root}src/cartridges/${name}/`;
const check = name => { if (!DIR.test(name || '')) fail(`"${name}" is not a valid folder name: use lowercase letters, digits and dashes.`); };
const { version } = JSON.parse(readFileSync(root + 'package.json', 'utf8'));

if (command === 'fork') {
  check(a); check(b);
  if (!existsSync(src(a) + 'cartridge.json')) fail(`There is no game at src/cartridges/${a}.`);
  if (existsSync(src(b))) fail(`src/cartridges/${b} already exists.`);
  cpSync(src(a), src(b), { recursive: true });
  const manifest = JSON.parse(readFileSync(src(b) + 'cartridge.json', 'utf8'));
  manifest.title = `${manifest.title} (${b})`;
  manifest.version = '0.1.0';
  manifest.description = `A fork of ${a}. ${manifest.description}`.slice(0, 240);
  writeFileSync(src(b) + 'cartridge.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Forked ${a} to src/cartridges/${b}. Edit it, then: node scripts/cartridge.mjs build ${b}`);
} else if (command === 'build') {
  check(a);
  if (!existsSync(src(a) + 'index.jsx')) fail(`There is no game at src/cartridges/${a}.`);
  const out = `${root}dist/cartridges/${a}/`;
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const manifest = { version, ...JSON.parse(readFileSync(src(a) + 'cartridge.json', 'utf8')), main: 'cartridge.js' };
  await build({
    bundle: true, format: 'esm', jsx: 'automatic', target: 'es2022', logLevel: 'warning', legalComments: 'none',
    loader: { '.mp3': 'base64', '.png': 'dataurl' },
    define: { __VERSION__: JSON.stringify(manifest.version) },
    entryPoints: [src(a) + 'index.jsx'], outfile: out + 'cartridge.js',
    // The only two things a cartridge may import; the console supplies them.
    external: ['react', 'react/jsx-runtime'],
    banner: { js: `// ${manifest.title} ${manifest.version}: a Hermes Arrow cartridge, built from src/cartridges/${a}.` }
  });
  if (manifest.cover && existsSync(src(a) + manifest.cover)) cpSync(src(a) + manifest.cover, out + manifest.cover); else delete manifest.cover;
  writeFileSync(out + 'cartridge.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Built dist/cartridges/${a}/. Copy that folder into the cartridges folder.`);
} else {
  fail('Usage: node scripts/cartridge.mjs fork <bundled-game> <new-name> | build <name>');
}
