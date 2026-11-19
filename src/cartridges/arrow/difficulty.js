import { generate } from './core.js';

// How hard a board should be for the task the agent is working on. Pure, no DOM.
// The console says how many seconds of work the task amounts to; the biggest level a player could
// finish in that time is dealt. `secs` is roughly how long a level takes to clear.

// size     board side in cells      maxLen  longest ordinary arrow
// picks    candidate arrows weighed per arrow laid: more makes tighter bottlenecks (see core.js)
// width    arrows the board aims to keep free mid-game      long  share of arrows that run long
export const LEVELS = [
  { n: 1, size: 6, maxLen: 3, picks: 2, width: 3, long: 0, secs: 15, name: 'Blink' },
  { n: 2, size: 9, maxLen: 4, picks: 3, width: 3, long: 0.03, secs: 35, name: 'Errand' },
  { n: 3, size: 13, maxLen: 5, picks: 4, width: 3, long: 0.04, secs: 55, name: 'Task' },
  { n: 4, size: 18, maxLen: 6, picks: 5, width: 3, long: 0.04, secs: 90, name: 'Project' },
  { n: 5, size: 24, maxLen: 7, picks: 6, width: 3, long: 0.04, secs: 150, name: 'Deep work' },
  { n: 6, size: 32, maxLen: 8, picks: 7, width: 3, long: 0.035, secs: 240, name: 'Marathon' },
  { n: 7, size: 40, maxLen: 9, picks: 8, width: 3, long: 0.03, secs: 360, name: 'Odyssey' }
];
export const MAX_LEVEL = LEVELS.length;
export const level = n => LEVELS[Math.max(1, Math.min(MAX_LEVEL, Math.round(n))) - 1];

// The biggest level a player could finish in the time the agent is expected to take.
export function levelForSeconds(seconds) {
  let pick = 1;
  for (const l of LEVELS) if (l.secs <= seconds) pick = l.n;
  return pick;
}

/** Level for the next board dealt during a task. `task.seconds` is the console's measure of the work (effort.js). */
export const levelForTask = task => levelForSeconds(task?.seconds || 0);


/**
 * The handicap shifts how hard a board is WITHOUT changing its level or size: −2 (much easier) to
 * +2 (much harder). It turns the generator's own dials: how hard it works to leave only a move or
 * two open at a time, how many arrows run long, and how long the ordinary ones are. Much easier is
 * a plain random board. Lives and points follow (score.js).
 */
export const HANDICAPS = [-2, -1, 0, 1, 2];
export const HANDICAP_NAMES = { '-2': 'Much easier', '-1': 'Easier', 0: 'Standard', 1: 'Harder', 2: 'Much harder' };
export const handicap = h => Math.max(-2, Math.min(2, Math.round(Number(h) || 0)));
// Per handicap: picks multiplier, free arrows aimed for, long-arrow multiplier.
const DIALS = { '-2': [0, 8, 0.4], '-1': [0.5, 5, 0.7], 0: [1, 3, 1], 1: [2, 2, 1.3], 2: [4, 1, 1.6] };

const SHAPE_POOL = ['rect', 'disc', 'diamond', 'ring', 'cross', 'hourglass', 'heart', 'wing', 'letter'];

/** Concrete generator settings for a level, fitted to the viewport's aspect ratio. */
export function boardSpec(n, { aspect = 1, seed = 1, handicap: raw = 0 } = {}) {
  const hc = handicap(raw);
  const l = level(n), a = Math.max(0.6, Math.min(1.7, aspect || 1));
  const w = Math.max(4, Math.round(l.size * Math.sqrt(a))), h = Math.max(4, Math.round(l.size / Math.sqrt(a)));
  // Small boards stay rectangular: a silhouette needs room to read.
  const shape = l.n < 3 ? 'rect' : SHAPE_POOL[(seed >>> 3) % SHAPE_POOL.length];
  const [tight, width, long] = DIALS[hc];
  return { w, h, shape, maxLen: Math.max(2, l.maxLen + hc), straight: 0.5 + ((seed >>> 7) % 20) / 100, seed,
    picks: Math.max(1, Math.round(l.picks * tight)), width, opening: width * 3,
    // Long arrows run one to two board lengths. The smallest board has no room for them.
    long: l.long * long, longLen: l.long ? Math.round(l.size * 2) : 0, knot: 3 + l.n + hc };
}

/** Build the board for a level and handicap. Same inputs, same board. */
export const dealBoard = (n, opts = {}) => generate(boardSpec(n, opts));
