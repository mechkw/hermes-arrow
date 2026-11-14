import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, solve, makeGrid, probe, headDir, SHAPE_NAMES } from '../src/core.js';
import { LEVELS, boardSpec, estimateSeconds, levelForSeconds, levelForTask, heatSeconds } from '../src/difficulty.js';

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
    assert.ok(filled >= board.w * board.h * 0.2, `level ${l.n} seed ${seed} is reasonably full (${filled}/${board.w * board.h})`);
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

import { livesFor, liveStreak, score, settle, STREAK_IDLE_MS } from '../src/score.js';

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
