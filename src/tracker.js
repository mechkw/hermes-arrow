// Watches the agent's turns. Host doors are injected so this runs under test without the app.
//
// SAFETY: the host calls store listeners synchronously, from inside its own state writes. The busy
// map changes inside the app's send path (it marks the chat busy, then sends), so an exception or
// slow work in a listener here would abort or stall the user's message. Nothing in this file runs
// on the host's stack: every callback is deferred to a microtask and wrapped, and an error is
// handed to `onError` instead of thrown.
//
//   $task  what the agent is doing now, refreshed every second while it works
//   $done  the turn that most recently finished, until the next one starts

import { estimateSeconds, levelForTask } from './difficulty.js';

const HISTORY = 40;

export function createTracker({ atom, busyBySession, onEvent, storage, setInterval, now = Date.now, onStart = () => {}, onError = () => {},
  defer = fn => (typeof queueMicrotask === 'function' ? queueMicrotask(fn) : Promise.resolve().then(fn)) }) {
  /** Wrap a host callback: never throws into the host, never runs on its stack. */
  const safe = (where, fn) => (...args) => {
    try { defer(() => { try { fn(...args); } catch (error) { try { onError(where, error); } catch { /* reporting is best-effort */ } } }); } catch { /* could not even defer */ }
  };
  const $task = atom({ busy: false }), $done = atom(null);
  const tasks = new Map();
  let history = [].concat(storage.get('history', []) || []).filter(n => Number.isFinite(n)).slice(-HISTORY);
  let pending = null;

  const publish = () => {
    let first = null;
    for (const t of tasks.values()) if (!first || t.start < first.start) first = t;
    if (!first) { if ($task.get().busy) $task.set({ busy: false }); return; }
    const view = { busy: true, count: tasks.size, start: first.start, elapsed: (now() - first.start) / 1000,
      tools: first.tools, subagents: first.subagents, estimate: first.estimate };
    view.level = levelForTask(view);
    $task.set(view);
  };

  const sync = map => {
    const t = now(), busy = map || {};
    let started = false, ended = false;
    for (const id of Object.keys(busy)) {
      if (!busy[id] || tasks.has(id)) continue;
      const fresh = pending && t - pending.at < 10000 ? pending : null;
      pending = null;
      tasks.set(id, { id, start: t, tools: 0, subagents: 0,
        estimate: estimateSeconds({ text: fresh?.text || '', attachments: fresh?.attachments || 0, history }) });
      started = true;
    }
    for (const [id, task] of [...tasks]) {
      if (busy[id]) continue;
      tasks.delete(id); ended = true;
      const duration = (t - task.start) / 1000;
      if (duration >= 3) { history = [...history, Math.round(duration)].slice(-HISTORY); storage.set('history', history); }
      $done.set({ duration, at: t, tools: task.tools, still: tasks.size });
    }
    // The app's busy map is re-derived on every session-state change, streamed tokens included.
    // Only a turn starting or ending is news; the one-second tick keeps the clock moving.
    if (!started && !ended) return;
    if (started) $done.set(null);
    publish();
    if (started) onStart($task.get());
  };

  const owner = event => tasks.get(event?.session_id) || (tasks.size === 1 ? tasks.values().next().value : null);
  const stops = [
    // Deferred, so a turn already running when the plugin loads reaches `onStart` after the caller holds the tracker.
    busyBySession.subscribe(safe('busy', sync)),
    onEvent('tool.start', safe('tool.start', e => { const t = owner(e); if (t) { t.tools++; publish(); } })),
    onEvent('subagent.start', safe('subagent.start', e => { const t = owner(e); if (t) { t.subagents++; publish(); } })),
    setInterval(safe('tick', () => { if (tasks.size) publish(); }), 1000)
  ];

  return {
    $task, $done,
    /** The composer saw a message go out: remember it for the turn that is about to start. */
    sawPrompt(draft) { try { pending = { text: String(draft?.text || ''), attachments: draft?.attachments?.length || 0, at: now() }; } catch { /* never block a send */ } },
    dismiss() { $done.set(null); },
    history: () => history.slice(),
    dispose() { for (const stop of stops) if (typeof stop === 'function') stop(); }
  };
}
