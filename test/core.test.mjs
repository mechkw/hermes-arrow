import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, solve, makeGrid, probe, headDir, buildMask, SHAPE_NAMES } from '../src/core.js';
import { LEVELS, level, boardSpec, estimateSeconds, levelForSeconds, levelForTask, heatSeconds } from '../src/difficulty.js';

function check(board) {
  const { w, h, arrows } = board, seen = new Set();
  for (const a of arrows) {
    assert.ok(a.cells.length >= 2, 'arrow has a body');
    a.cells.forEach(([x, y], i) => {
      assert.ok(x >= 0 && y >= 0 && x < w && y < h, 'cell on board');
      const key = y * w + x;
      assert.ok(!seen.has(key), 'cells never overlap');
      seen.add(key);
      if (i) { const [px, py] = a.cells[i - 1]; assert.equal(Math.abs(px - x) + Math.abs(py - y), 1, 'cells are adjacent'); }
    });
    const [dx, dy] = headDir(a.cells);
    assert.equal(Math.abs(dx) + Math.abs(dy), 1);
  }
  assert.equal(board.dropped, 0, 'nothing had to be dropped to make it solvable');
  const { stuck, order } = solve(w, h, arrows);
  assert.deepEqual(stuck, [], 'board is solvable');
  assert.equal(order.length, arrows.length);
  // Replay the recorded solution strictly, one arrow at a time.
  const grid = makeGrid(w, h, arrows), byId = new Map(arrows.map(a => [a.id, a]));
  for (const id of board.order) {
    const a = byId.get(id);
    assert.equal(probe(w, h, grid, a.cells).blocker, -1, 'solution step is legal');
    for (const [x, y] of a.cells) grid[y * w + x] = -1;
  }
  return seen.size;
}

test('every level and silhouette yields a valid, solvable board', () => {
  for (const l of LEVELS) for (let seed = 1; seed <= 12; seed++) {
    const board = generate(boardSpec(l.n, { seed: seed * 7919, aspect: seed % 3 === 0 ? 0.6 : seed % 3 === 1 ? 1 : 1.6 }));
    const filled = check(board);
    assert.ok(board.arrows.length >= 4, `level ${l.n} has arrows`);
    assert.ok(filled >= buildMask(board.w, board.h, board.shape).reduce((t, v) => t + v, 0) * 0.85, `level ${l.n} seed ${seed} is reasonably full (${filled}/${board.w * board.h})`);
  }
  for (const shape of SHAPE_NAMES) check(generate({ w: 20, h: 20, shape, maxLen: 12, seed: 42 }));
});

test('boards are not trivially open, and deterministic', () => {
  const spec = boardSpec(5, { seed: 1234 });
  const a = generate(spec), b = generate(spec);
  assert.deepEqual(a.arrows, b.arrows);
  const grid = makeGrid(a.w, a.h, a.arrows);
  const free = a.arrows.filter(x => probe(a.w, a.h, grid, x.cells).blocker === -1).length;
  assert.ok(free < a.arrows.length * 0.7, `some arrows start blocked (${free}/${a.arrows.length} free)`);
});

test('levels grow with size', () => {
  let last = 0;
  for (const l of LEVELS) {
    const n = generate({ ...boardSpec(l.n, { seed: 99 }), shape: 'rect' }).arrows.length;
    assert.ok(n > last, `level ${l.n} has more arrows than the one before (${n} vs ${last})`);
    last = n;
  }
});

test('harder prompts and longer runs pick higher levels', () => {
  const quick = estimateSeconds({ text: 'thanks' });
  const ask = estimateSeconds({ text: 'what time is it in Tokyo?' });
  const big = estimateSeconds({ text: 'Audit the entire repository, refactor the auth module, write tests for every endpoint and deploy to staging. Be thorough.' });
  assert.ok(quick < ask && ask < big, `${quick} < ${ask} < ${big}`);
  assert.ok(levelForSeconds(big) > levelForSeconds(quick));
  const slowUser = estimateSeconds({ text: 'fix the header bug', history: [300, 420, 380, 500] });
  const fastUser = estimateSeconds({ text: 'fix the header bug', history: [10, 14, 12, 20] });
  assert.ok(slowUser > fastUser);
  assert.equal(levelForSeconds(0), 1);
  assert.equal(levelForSeconds(1e6), LEVELS.length);
  const early = { estimate: 20, elapsed: 5, tools: 0, subagents: 0 }, late = { estimate: 20, elapsed: 400, tools: 30, subagents: 2 };
  assert.ok(heatSeconds(late) > heatSeconds(early));
  assert.ok(levelForTask(late) > levelForTask(early));
});

test('generation is fast enough to run on the UI thread', () => {
  const t = performance.now();
  generate(boardSpec(7, { seed: 5 }));
  const ms = performance.now() - t;
  assert.ok(ms < 1500, `largest board built in ${ms.toFixed(0)} ms`);
});

import { livesFor, liveStreak, score, settle, STREAK_IDLE_MS, hintFactor, nextHintCost } from '../src/score.js';

test('lives run from 2 to 5 with difficulty', () => {
  assert.deepEqual(LEVELS.map(l => livesFor(l.n)), [2, 2, 3, 3, 4, 4, 5]);
});

test('points reward speed, difficulty, lives kept and streaks', () => {
  const base = { level: 3, arrows: 30, seconds: 60, lives: 2, streak: 1 };
  const p = o => score({ ...base, ...o }).points;
  assert.ok(p({ seconds: 30 }) > p({}), 'faster is worth more');
  assert.ok(p({ seconds: 600 }) < p({}), 'slower is worth less');
  assert.equal(p({ seconds: 5 }), p({ seconds: 1 }), 'the time bonus is capped');
  assert.ok(p({ level: 5 }) > p({}), 'harder is worth more');
  assert.ok(p({ lives: 3 }) > p({}) && p({ lives: 0 }) < p({}), 'lives kept are worth more');
  assert.ok(p({ streak: 4 }) > p({}), 'a streak is worth more');
  assert.equal(p({ streak: 50 }), p({ streak: 11 }), 'the streak bonus is capped');
});

test('streak grows on wins, ends on a loss or 36 idle hours', () => {
  const t0 = 1_000_000_000_000, win = { won: true, level: 2, arrows: 20, seconds: 40, lives: 2 };
  let s = settle({}, win, t0).stats;
  s = settle(s, win, t0 + 1000).stats;
  const third = settle(s, win, t0 + 2000);
  assert.equal(third.stats.streak, 3);
  assert.equal(third.result.streak, 3);
  assert.ok(third.result.points > settle({}, win, t0).result.points, 'third win in a row outscores a first win');
  assert.equal(third.stats.boards, 3);
  assert.equal(third.stats.best, third.result.points, 'best board is tracked');
  const lost = settle(third.stats, { won: false }, t0 + 3000);
  assert.equal(lost.stats.streak, 0);
  assert.equal(lost.lost, 3);
  assert.equal(liveStreak(third.stats, third.stats.lastPlay + STREAK_IDLE_MS - 1), 3, 'still alive just inside 36 h');
  assert.equal(liveStreak(third.stats, third.stats.lastPlay + STREAK_IDLE_MS + 1), 0, 'gone after 36 h');
  assert.equal(settle(third.stats, win, third.stats.lastPlay + STREAK_IDLE_MS + 1).stats.streak, 1, 'a win after the gap starts over at 1');
});

test('hints cost points, and each one costs more than the last', () => {
  const base = { level: 3, arrows: 30, seconds: 60, lives: 2, streak: 1 };
  const p = hints => score({ ...base, hints }).points;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(n => +hintFactor(n).toFixed(2)), [1, 0.95, 0.85, 0.7, 0.5, 0.25]);
  assert.deepEqual([0, 1, 2, 3].map(nextHintCost), [0.05, 0.1, 0.15, 0.2], 'the price goes up every time');
  assert.ok(p(0) > p(1) && p(1) > p(2) && p(2) > p(3));
  assert.ok(p(1) - p(2) > p(0) - p(1), 'the second hint takes more than the first');
  assert.equal(p(6), p(60), 'a board never pays less than the floor');
  assert.equal(hintFactor(60), 0.2);
  assert.equal(nextHintCost(60), 0);
  assert.equal(settle({}, { won: true, ...base, hints: 2 }).result.hint, 0.85, 'the win records what hints cost');
});

import { atom, computed } from 'nanostores';
import { createTracker } from '../src/tracker.js';

test('the tracker never throws into the host or runs on its stack', async () => {
  // The app derives busy from its session store and writes that store inside its send path.
  const $states = atom({}), busy = computed($states, s => Object.fromEntries(Object.entries(s).map(([id, v]) => [id, !!v.busy])));
  const errors = [], handlers = new Map(), kept = new Map();
  let ran = 0;
  const tracker = createTracker({
    atom, busyBySession: busy, onEvent: (type, fn) => { handlers.set(type, fn); return () => {}; },
    storage: { get: (k, d) => kept.get(k) ?? d, set: () => { throw new Error('storage is broken'); } },
    setInterval: () => () => {}, onStart: () => { ran++; throw new Error('boom'); }, onError: (where, e) => errors.push(`${where}: ${e.message}`)
  });
  assert.doesNotThrow(() => $states.set({ s1: { busy: true } }), 'a failing reaction cannot abort the host write');
  assert.equal(ran, 0, 'and it has not run yet: nothing of ours is on the host stack');
  await Promise.resolve();
  assert.equal(ran, 1);
  assert.deepEqual(errors, ['busy: boom'], 'the failure is reported instead');
  assert.doesNotThrow(() => handlers.get('tool.start')({ session_id: 's1' }));
  assert.doesNotThrow(() => tracker.sawPrompt(null));
  assert.doesNotThrow(() => $states.set({ s1: { busy: false } }));
  await Promise.resolve();
  assert.equal(tracker.$task.get().busy, false, 'the turn still ends cleanly');
  tracker.dispose();
});

test('the tracker stays quiet while a turn streams', async () => {
  const $states = atom({}), busy = computed($states, s => Object.fromEntries(Object.entries(s).map(([id, v]) => [id, !!v.busy])));
  const tracker = createTracker({ atom, busyBySession: busy, onEvent: () => () => {}, storage: { get: (k, d) => d, set: () => {} }, setInterval: () => () => {} });
  let published = 0;
  tracker.$task.listen(() => published++);
  $states.set({ s1: { busy: true } });
  await Promise.resolve();
  assert.equal(published, 1, 'a turn starting is published');
  for (let i = 0; i < 50; i++) $states.set({ s1: { busy: true, tokens: i } });
  await Promise.resolve();
  assert.equal(published, 1, 'fifty streamed updates publish nothing');
  $states.set({ s1: { busy: false } });
  await Promise.resolve();
  assert.equal(published, 2, 'the turn ending is published');
  tracker.dispose();
});

import { profile } from '../src/core.js';
import { dealBoard, HANDICAPS } from '../src/difficulty.js';
import { handicapFactor } from '../src/score.js';

test('the handicap makes a level harder or easier without resizing it', () => {
  for (const n of [3, 5, 7]) {
    const mean = hc => {
      const t = { mean: 0, narrow: 0 };
      for (let s = 1; s <= 12; s++) { const b = dealBoard(n, { seed: s * 104729 + n, handicap: hc }); check(b); const p = profile(b, s); t.mean += p.mean / 12; t.narrow += p.narrow / 12; }
      return t;
    };
    const [easy, , std, , hard] = HANDICAPS.map(mean);
    assert.ok(easy.mean > std.mean && std.mean > hard.mean, `level ${n}: fewer arrows free at a time as it gets harder (${[easy, std, hard].map(v => v.mean.toFixed(1))})`);
    assert.ok(easy.narrow < std.narrow && std.narrow < hard.narrow, `level ${n}: more moments with one or two moves (${[easy, std, hard].map(v => v.narrow.toFixed(2))})`);
    const a = dealBoard(n, { seed: 77, handicap: 2 }), b = dealBoard(n, { seed: 77, handicap: -2 }), c = dealBoard(n, { seed: 77, handicap: 2 });
    assert.deepEqual([a.w, a.h, a.shape], [b.w, b.h, b.shape], 'same size and silhouette');
    assert.deepEqual(a.arrows, c.arrows, 'deterministic');
  }
  assert.deepEqual(HANDICAPS.map(h => livesFor(3, h)), [5, 4, 3, 2, 1]);
  assert.deepEqual(HANDICAPS.map(handicapFactor), [0.7, 0.85, 1, 1.15, 1.3]);
  assert.ok(score({ level: 3, arrows: 30, seconds: 60, lives: 2, handicap: 2 }).points > score({ level: 3, arrows: 30, seconds: 60, lives: 2 }).points);
});

test('big boards are packed, knotted, and carry arrows longer than the board', () => {
  for (const n of [5, 6, 7]) {
    let longest = 0, narrow = 0, start = 0;
    for (let s = 1; s <= 8; s++) {
      const b = dealBoard(n, { seed: s * 7907 + n }), p = profile(b, s), cells = b.arrows.reduce((t, a) => t + a.cells.length, 0);
      check(b);
      assert.ok(cells >= buildMask(b.w, b.h, b.shape).reduce((t, v) => t + v, 0) * 0.9, `level ${n} seed ${s} fills its silhouette`);
      longest += p.longest / 8; narrow += p.narrow / 8; start += p.start / p.arrows / 8;
    }
    assert.ok(longest >= level(n).size, `level ${n}: the longest arrow outruns the board side (${longest.toFixed(0)} cells)`);
    assert.ok(narrow >= 0.2, `level ${n}: at least a fifth of the clear has one or two moves (${narrow.toFixed(2)})`);
    assert.ok(start <= 0.15, `level ${n}: few arrows are free on the untouched board (${start.toFixed(2)})`);
  }
});

import { pace, rate } from '../src/score.js';

test('pace reads dots as tokens per second', () => {
  assert.deepEqual(pace({ dots: 84, arrows: 13, seconds: 10 }), { tps: 84, aps: 1.3 });
  assert.deepEqual(pace({ dots: 9, arrows: 1, seconds: 0.4 }), { tps: 0, aps: 0 }, 'nothing in the first two seconds');
  assert.deepEqual(pace({}), { tps: 0, aps: 0 });
  assert.deepEqual([8.44, 9.96, 62.3].map(rate), ['8.4', '10', '62']);
});
