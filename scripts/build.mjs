// Bundles src/ into the single plugin.js Hermes Desktop loads. `--dev` also builds the browser harness.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
const common = { bundle: true, format: 'esm', jsx: 'automatic', target: 'es2022', logLevel: 'warning', legalComments: 'none',
  // Sound clips ride inside the bundle as base64: the Desktop loader resolves code only.
  loader: { '.mp3': 'base64' },
  // The one place the version is written is package.json.
  define: { __VERSION__: JSON.stringify(version) } };

await build({
  ...common,
  entryPoints: [root + 'src/plugin.jsx'],
  outfile: root + 'plugin.js',
  // The only three specifiers the Desktop loader resolves.
  external: ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'],
  banner: { js: `// Hermes Arrow ${version} — built from src/ by scripts/build.mjs. Edit the sources, not this file.` }
});

if (process.argv.includes('--dev')) {
  await build({
    ...common,
    entryPoints: [root + 'dev/main.jsx'],
    outfile: root + 'dev/dist/app.js',
    alias: { '@hermes/plugin-sdk': root + 'dev/sdk-stub.jsx', 'hermes-arrow-plugin': root + 'plugin.js' },
    define: { ...common.define, 'process.env.NODE_ENV': '"development"' }
  });
}
