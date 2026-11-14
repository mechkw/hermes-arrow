// Watches the agent's turns. Host doors are injected so this runs under test without the app.
//
//   $task  what the agent is doing now, refreshed every second while it works
//   $done  the turn that most recently finished, until the next one starts

import { estimateSeconds, levelForTask } from './difficulty.js';

const HISTORY = 40;

export function createTracker({ atom, busyBySession, onEvent, storage, setInterval, now = Date.now, onStart = () => {} }) {
  const $task = atom({ busy: false }), $done = atom(null);
  const tasks = new Map();
  let history = [].concat(storage.get('history', []) || []).filter(n => Number.isFinite(n)).slice(-HISTORY);
  let pending = null, live = false;

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
    let started = false;
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
      tasks.delete(id);
      const duration = (t - task.start) / 1000;
      if (duration >= 3) { history = [...history, Math.round(duration)].slice(-HISTORY); storage.set('history', history); }
      $done.set({ duration, at: t, tools: task.tools, still: tasks.size });
    }
    if (started) $done.set(null);
    publish();
    // Never during construction (a turn already running when the plugin loads): the caller does not hold the tracker yet.
    if (started && live) onStart($task.get());
  };

  const owner = event => tasks.get(event?.session_id) || (tasks.size === 1 ? tasks.values().next().value : null);
  const stops = [
    busyBySession.subscribe(sync),
    onEvent('tool.start', e => { const t = owner(e); if (t) { t.tools++; publish(); } }),
    onEvent('subagent.start', e => { const t = owner(e); if (t) { t.subagents++; publish(); } }),
    setInterval(() => { if (tasks.size) publish(); }, 1000)
  ];
  live = true;

  return {
    $task, $done,
    /** The composer saw a message go out: remember it for the turn that is about to start. */
    sawPrompt(draft) { pending = { text: String(draft?.text || ''), attachments: draft?.attachments?.length || 0, at: now() }; },
    dismiss() { $done.set(null); },
    history: () => history.slice(),
    dispose() { for (const stop of stops) if (typeof stop === 'function') stop(); }
  };
}
