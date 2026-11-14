// Browser harness: mounts the built plugin against the stub SDK and gives buttons to fake agent turns.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import plugin from 'hermes-arrow-plugin';
import { host, events, emit, useValue, atom } from '@hermes/plugin-sdk';

const contributions = [], disposers = [], memory = new Map();
const $hash = atom(window.location.hash);
window.addEventListener('hashchange', () => $hash.set(window.location.hash));
const ctx = {
  register(c) { contributions.push(c); return () => {}; },
  registerMany(list) { contributions.push(...list); return () => {}; },
  onEvent(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); return () => events.get(type).delete(fn); },
  onDispose(fn) { disposers.push(fn); },
  setInterval(fn, ms) { const id = setInterval(fn, ms); return () => clearInterval(id); },
  setTimeout(fn, ms) { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
  storage: { get: (k, d) => (memory.has(k) ? memory.get(k) : d), set: (k, v) => memory.set(k, v), remove: k => memory.delete(k) }
};
globalThis.__hermesArrowDebug = app => { window.arrow = app; };
// `?busy` loads the plugin while a turn is already running, as happens when the Desktop reloads plugins mid-task.
if (window.location.search.includes('busy')) host.state.busyBySession.set({ s0: true });
plugin.register(ctx);

const find = area => contributions.filter(c => c.area === area);
// The fake agent. `send` runs the composer middleware exactly as the app would before a turn starts.
window.agent = {
  send(text, id = 's1') { for (const c of find('composer.middleware')) c.data.handler({ text }); host.state.busyBySession.set({ ...host.state.busyBySession.get(), [id]: true }); },
  tool(id = 's1') { emit('tool.start', { session_id: id, payload: {} }); },
  finish(id = 's1') { host.state.busyBySession.set({ ...host.state.busyBySession.get(), [id]: false }); }
};

function Shell() {
  const hash = useValue($hash), [text, setText] = useState('Audit the entire repo, refactor auth and write tests for every endpoint. Be thorough.');
  const page = find('routes')[0], chip = find('statusBar.right')[0], nav = find('sidebar.nav')[0];
  const game = hash.replace(/^#/, '') === page.data.path;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        {game ? page.render() : (
          <div style={{ padding: 24, display: 'grid', gap: 10, maxWidth: 560 }}>
            <b>Fake chat</b>
            <textarea rows={3} value={text} onChange={e => setText(e.target.value)} />
            <span style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => window.agent.send(text)}>Send (agent starts working)</button>
              <a href={'#' + nav.data.path}>{nav.data.label}</a>
            </span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 26, padding: '0 8px', borderTop: '1px solid var(--ui-stroke-tertiary)', fontSize: 11 }}>
        <button onClick={() => window.agent.send(text)}>send</button>
        <button onClick={() => window.agent.tool()}>tool</button>
        <button onClick={() => window.agent.finish()}>finish</button>
        <span style={{ flex: 1 }} />
        {chip.render()}
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Shell />);
