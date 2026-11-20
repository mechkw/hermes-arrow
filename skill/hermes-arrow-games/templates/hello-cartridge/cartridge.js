// Tap: the smallest useful cartridge. One square is lit; tap it before you tap anything else.
//
// Copy this folder into the cartridges folder under a name of your own and the game appears in the
// Library (⚙, then Library). It is plain JavaScript with no build step, and it imports nothing but
// React: everything else comes from the `api` the console hands to create().
// ../../references/cartridge-guide.md explains every line.

import { createElement as h, Fragment } from 'react';

const LEVELS = [{ size: 3, goal: 8 }, { size: 4, goal: 12 }, { size: 5, goal: 18 }, { size: 6, goal: 26 }];
const MAX = LEVELS.length;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// The console reports the agent's task as seconds of work. This game turns that into its own levels.
const levelFor = task => ((task.seconds || 0) >= 240 ? 4 : task.seconds >= 90 ? 3 : task.seconds >= 30 ? 2 : 1);
// This game's own idea of a "token": one hit is worth twenty.
const TOKENS_PER_HIT = 20;

function create(api) {
  const { kit, atom, useValue, storage } = api;
  let level = clamp(Number(storage.get('level', 1)) || 1, 1, MAX);
  let stats = { boards: 0, points: 0, best: 0, ...(storage.get('stats', {}) || {}) };
  const $s = atom({ status: 'idle' });

  // No recorded clips here: each cue names a synthesised stand-in, which the console plays.
  const sound = api.voice({
    cues: { hit: () => ({ synth: 'hit' }), miss: () => ({ synth: 'miss' }), win: () => ({ synth: 'win' }) },
    synth: {
      hit: (note, o) => note({ freq: 500 + 500 * o.k, dur: 0.08, gain: 0.1 }),
      miss: note => note({ freq: 140, to: 90, dur: 0.16, type: 'square', gain: 0.08 }),
      win: note => [523, 659, 784].forEach((freq, i) => note({ at: i * 0.09, freq, dur: 0.2 }))
    }
  });

  const seconds = () => { const s = $s.get(); return s.startedAt ? ((s.endedAt || Date.now()) - s.startedAt) / 1000 : 0; };
  const pace = () => { const t = seconds(); return t >= 2 ? ($s.get().hits * TOKENS_PER_HIT) / t : 0; };
  const pick = (cells, not) => { let i; do { i = Math.floor(Math.random() * cells); } while (i === not); return i; };

  function deal(n = level) {
    const { size, goal } = LEVELS[n - 1];
    $s.set({ status: 'play', level: n, size, goal, hits: 0, misses: 0, lit: pick(size * size, -1), startedAt: 0, endedAt: 0 });
  }
  function setLevel(n) { level = clamp(n, 1, MAX); storage.set('level', level); deal(level); }

  function tap(i) {
    const s = $s.get();
    if (s.status !== 'play') return;
    const startedAt = s.startedAt || Date.now();
    if (i !== s.lit) { sound.play('miss'); api.haptic('tap'); return $s.set({ ...s, startedAt, misses: s.misses + 1 }); }
    const hits = s.hits + 1;
    if (hits < s.goal) { sound.play('hit', hits / s.goal); return $s.set({ ...s, startedAt, hits, lit: pick(s.size * s.size, s.lit) }); }
    // Board over. Scoring is this game's own: ten a hit, times the level, times speed, less five a miss.
    const endedAt = Date.now(), took = Math.max(0.5, (endedAt - startedAt) / 1000);
    const points = Math.max(0, Math.round(s.goal * 10 * s.level * clamp((s.goal * 0.8) / took, 0.5, 2)) - s.misses * 5);
    stats = { boards: stats.boards + 1, points: stats.points + points, best: Math.max(stats.best, points) };
    storage.set('stats', stats);
    sound.play('win');
    $s.set({ ...s, startedAt, endedAt, hits, lit: -1, status: 'won', points, tps: (hits * TOKENS_PER_HIT) / took, agentTps: kit.agentRate() });
  }

  // The left of the bar: any kit parts, in any order.
  function Bar() {
    const s = useValue($s), running = s.status === 'play' && !!s.startedAt;
    return h(Fragment, null,
      h(kit.Stepper, { compact: true, value: s.level || level, max: MAX, label: `L${s.level || level}`, tip: 'Bigger grids, more to tap.', onChange: setLevel }),
      h(kit.Count, { value: Math.max(0, (s.goal || 0) - (s.hits || 0)), label: 'to go' }),
      h(kit.Count, { value: s.misses || 0, label: 'missed' }),
      h(kit.Clock, { running, started: !!s.startedAt, seconds }),
      h(kit.Pace, { running, value: pace, tip: 'Each hit counts as twenty tokens. Beside it, your agent\'s tokens a second in this chat.' }));
  }

  // Buttons on the right of the bar, before the console's own (sound, settings, close).
  function Actions() {
    const s = useValue($s);
    return h(kit.Action, { tip: 'Start over (R)', disabled: s.status === 'idle', onClick: () => deal(s.level) }, 'Restart');
  }

  // The play area. It fills the stage; cards from the kit sit over it.
  function Stage() {
    const s = useValue($s);
    if (s.status === 'idle') deal(api.task().busy ? levelFor(api.task()) : level);
    const size = s.size || 3;
    return h(Fragment, null,
      h('div', { style: { ...kit.S.fill, display: 'grid', placeItems: 'center', padding: 16 } },
        h('div', { style: { width: 'min(90%, 62vh)', aspectRatio: '1', display: 'grid', gridTemplateColumns: `repeat(${size}, 1fr)`, gap: 6 }, 'data-grid': size },
          Array.from({ length: size * size }, (_, i) => h('button', {
            key: i, type: 'button', 'aria-label': i === s.lit ? 'Lit square' : 'Square', 'data-lit': i === s.lit ? '' : undefined, onPointerDown: () => tap(i),
            style: { border: 0, borderRadius: 4, cursor: 'pointer', background: i === s.lit ? 'var(--ui-accent)' : 'var(--ui-bg-quaternary)' }
          })))),
      s.status === 'won' && h(kit.Card, { label: 'Board cleared' },
        h(kit.Eyebrow, null, 'Cleared'),
        h(kit.Headline, { big: true }, `+${kit.fmt(s.points)}`),
        h(kit.Line, null, `${s.goal} hits · ${kit.clock(seconds())} · ${s.misses} missed`),
        h(kit.Rates, { you: s.tps, agent: s.agentTps }),
        h(kit.Stepper, { value: s.level, max: MAX, label: `Level ${s.level}`, onChange: setLevel }),
        h(kit.Button, { onClick: () => deal(s.level) }, 'Play again'),
        h(kit.Line, { faint: true }, `${kit.fmt(stats.points)} points · ${stats.boards} boards all-time`)));
  }

  return {
    Bar, Actions, Stage,
    onKey(key) { if (key !== 'r') return false; deal($s.get().level); return true; },
    // A new agent task: swap in a board sized to it, unless one is being played.
    taskStarted(task) { const s = $s.get(); if (s.status !== 'play' || !s.startedAt) deal(levelFor(task)); },
    invite(task) { const n = levelFor(task); return { label: `L${n}`, tip: `tap through a level-${n} grid while this runs` }; }
  };
}

// The console calls this once, the first time the game is needed.
export default create;
