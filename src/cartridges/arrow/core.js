// Board model for the arrow-escape puzzle. Pure functions, no DOM: runs in Node for tests.
//
// A board is a w×h grid. Each arrow is a snake of orthogonally connected cells, listed tail → head.
// It points along its last segment. An arrow can leave when every cell between its head and the
// board edge, in that direction, is empty. Leaving only ever frees cells, so any order that works
// keeps working: a board is solvable exactly when greedy peeling empties it.

export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Silhouettes, as tests on coordinates normalised to -1..1.
export const SHAPES = {
  rect: () => true,
  disc: (x, y) => x * x + y * y <= 1.02,
  diamond: (x, y) => Math.abs(x) + Math.abs(y) <= 1.04,
  ring: (x, y) => { const r = x * x + y * y; return r <= 1.02 && r >= 0.16; },
  cross: (x, y) => Math.abs(x) <= 0.4 || Math.abs(y) <= 0.4,
  hourglass: (x, y) => Math.abs(x) <= 0.18 + 0.82 * Math.abs(y),
  heart: (x, y) => { const u = x * 1.2, v = -y * 1.2 + 0.25, k = u * u + v * v - 1; return k * k * k - u * u * v * v * v <= 0; },
  wing: (x, y) => y <= 0.95 - 1.5 * Math.abs(x) * Math.abs(x) && y >= -1 + 0.9 * Math.abs(x) * (1 - Math.abs(x)) * 2 - 0.05,
  letter: (x, y) => Math.abs(x) >= 0.45 || Math.abs(y) <= 0.24
};
export const SHAPE_NAMES = Object.keys(SHAPES);

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export function buildMask(w, h, shape) {
  const test = SHAPES[shape] || SHAPES.rect, mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = w > 1 ? ((x + 0.5) / w) * 2 - 1 : 0, ny = h > 1 ? ((y + 0.5) / h) * 2 - 1 : 0;
    mask[y * w + x] = test(nx, ny) ? 1 : 0;
  }
  return mask;
}

export const headDir = cells => {
  const a = cells[cells.length - 2], b = cells[cells.length - 1];
  return [b[0] - a[0], b[1] - a[1]];
};

// Cells from just past the head to the edge. `grid` holds an arrow id per cell, -1 when empty.
// Returns the id of the first arrow in the way (-1 when clear) and how many empty cells precede it.
export function probe(w, h, grid, cells) {
  const [dx, dy] = headDir(cells);
  let [x, y] = cells[cells.length - 1], free = 0;
  for (;;) {
    x += dx; y += dy;
    if (x < 0 || y < 0 || x >= w || y >= h) return { blocker: -1, free };
    const id = grid[y * w + x];
    if (id >= 0) return { blocker: id, free };
    free++;
  }
}

export function makeGrid(w, h, arrows) {
  const grid = new Int32Array(w * h).fill(-1);
  for (const a of arrows) if (!a.gone) for (const [x, y] of a.cells) grid[y * w + x] = a.id;
  return grid;
}

// Greedy peel. Returns the leaving order and whatever could not leave.
export function solve(w, h, arrows) {
  const grid = makeGrid(w, h, arrows), left = new Map(), order = [];
  for (const a of arrows) if (!a.gone) left.set(a.id, a);
  for (let moved = true; moved && left.size;) {
    moved = false;
    for (const a of [...left.values()]) {
      if (probe(w, h, grid, a.cells).blocker !== -1) continue;
      for (const [x, y] of a.cells) grid[y * w + x] = -1;
      left.delete(a.id); order.push(a.id); moved = true;
    }
  }
  return { order, stuck: [...left.keys()] };
}

/** Share of arrows that can leave right now, 0..1. The fewer, the harder the board is to start. */
export function freeShare(board) {
  const grid = makeGrid(board.w, board.h, board.arrows);
  return board.arrows.length ? board.arrows.filter(a => probe(board.w, board.h, grid, a.cells).blocker === -1).length / board.arrows.length : 1;
}

/**
 * How tight a board plays. Clears it one arrow at a time (a random free arrow each step) and counts
 * how many arrows could leave at every step.
 *   start   arrows free on the untouched board
 *   mean    average number free over the whole clear
 *   narrow  share of steps with at most two arrows free
 *   longest longest arrow, in cells
 */
export function profile(board, seed = 1) {
  const { w, h } = board, R = rng(seed), grid = makeGrid(w, h, board.arrows), left = new Map(board.arrows.map(a => [a.id, a]));
  let start = 0, sum = 0, narrow = 0, steps = 0;
  while (left.size) {
    const free = [...left.values()].filter(a => probe(w, h, grid, a.cells).blocker === -1);
    if (!free.length) break;
    if (!steps) start = free.length;
    sum += free.length; if (free.length <= 2) narrow++; steps++;
    const a = free[Math.floor(R() * free.length)];
    for (const [x, y] of a.cells) grid[y * w + x] = -1;
    left.delete(a.id);
  }
  return { start, mean: steps ? sum / steps : 0, narrow: steps ? narrow / steps : 0, longest: Math.max(0, ...board.arrows.map(a => a.cells.length)), arrows: board.arrows.length };
}

/**
 * Build a solvable board.
 *   w, h      grid size
 *   shape     silhouette name from SHAPES
 *   maxLen    longest ordinary arrow, in cells
 *   straight  0..1, how strongly a growing arrow keeps its heading
 *   picks     candidate arrows weighed per step; 1 is plain random
 *   width     how many arrows the board tries to keep free to leave at any moment
 *   opening   how many it allows on the untouched board
 *   long      0..1, share of steps that lay a long arrow
 *   longLen   longest long arrow, in cells
 *   knot      arrows laid after each long one while only a single arrow is kept free
 *   seed      integer; same inputs give the same board
 *
 * Every arrow carries a rank: higher ranks leave first. An arrow may lie across another's exit path
 * only if it outranks it, and its own exit path may only be blocked by arrows that outrank it. Any
 * arrow whose rank fits between those two bounds keeps the board solvable (leave in rank order), so
 * arrows can be added anywhere, including ones that start out blocked. `lane` holds, per cell, the
 * highest rank among arrows whose exit path crosses it.
 *
 * What makes a board hard is how few arrows can leave at any moment. While building, an arrow is
 * "free" until another lies across its exit path. Each step drafts `picks` candidates, half of them
 * seeded on a free arrow's exit path, and keeps the one that best holds every moment of the clear to
 * `width` free arrows (see `overflow`). A long arrow snakes across as many exit paths as it can,
 * pinning many arrows at once; the steps after it aim for a single free arrow, which nests small
 * arrows on the long one's own path. That nest is the knot the player has to find.
 */
export function generate({ w, h, shape = 'rect', maxLen = 6, straight = 0.55, seed = 1, picks = 1, width = 0, opening = 0, long = 0, longLen = 0, knot = 0 }) {
  const R = rng(seed), mask = buildMask(w, h, shape), N = w * h;
  const owner = new Int32Array(N).fill(-1), lane = new Float64Array(N).fill(-Infinity), mark = new Int32Array(N);
  const cross = new Array(N).fill(null);          // per cell: arrows whose exit path crosses it
  const arrows = [], rank = [], free = [], freeList = [], seen = [];
  const depth = [], blocks = [], crowd = [];      // per arrow: turns before it can leave, and whom it pins; per depth: arrows
  let stamp = 0, top = 0;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const open = (x, y) => inside(x, y) && mask[y * w + x] && owner[y * w + x] < 0;
  const shuffle = list => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
  // Lowest rank among arrows standing in an exit path: the new arrow must rank below it.
  const ceiling = (x, y, dx, dy) => { let hi = Infinity; for (x += dx, y += dy; inside(x, y); x += dx, y += dy) { const id = owner[y * w + x]; if (id >= 0 && rank[id] < hi) hi = rank[id]; } return hi; };

  // A heading for a head at (hx, hy), or null when no arrow can ever point out of this cell.
  const heading = (hx, hy) => {
    if (!open(hx, hy)) return null;
    let d = null, total = 0;
    for (const dir of DIRS) {
      const [dx, dy] = dir;
      if (!open(hx - dx, hy - dy)) continue;
      if (Math.max(lane[hy * w + hx], lane[(hy - dy) * w + hx - dx]) >= ceiling(hx, hy, dx, dy)) continue;
      let room = 1;
      for (let x = hx + dx, y = hy + dy; inside(x, y); x += dx, y += dy) room += mask[y * w + x];
      total += room;
      if (R() * total < room) d = dir;
    }
    return d;
  };

  // Arrows this draft would push deeper by lying on this cell: those whose exit path crosses it and
  // that are no deeper than the draft itself. Each is counted once per draft.
  const gain = (cell, at) => {
    const list = cross[cell]; let n = 0;
    if (list) for (const id of list) if (depth[id] <= at && seen[id] !== stamp) n++;
    return n;
  };

  // Draft an arrow without committing it. Cells are collected head first.
  const draft = (hx, hy, d, want, pull) => {
    stamp++;
    let room = 0, hi = Infinity, at = 0;
    for (let x = hx + d[0], y = hy + d[1]; inside(x, y); x += d[0], y += d[1]) {
      const cell = y * w + x, id = owner[cell];
      mark[cell] = stamp;
      if (id >= 0) { if (rank[id] < hi) hi = rank[id]; if (depth[id] >= at) at = depth[id] + 1; } else room += mask[cell];
    }
    const cells = [[hx, hy], [hx - d[0], hy - d[1]]];
    let lo = -Infinity, dir = [-d[0], -d[1]];
    const pins = [];
    const add = (x, y) => {
      const cell = y * w + x, list = cross[cell]; mark[cell] = stamp; if (lane[cell] > lo) lo = lane[cell];
      if (list) for (const id of list) if (depth[id] <= at && seen[id] !== stamp) { seen[id] = stamp; pins.push(id); }
    };
    for (const [x, y] of cells) add(x, y);
    while (cells.length < want) {
      const [x, y] = cells[cells.length - 1];
      let next = null, total = 0;
      for (const o of DIRS) {
        const nx = x + o[0], ny = y + o[1], cell = ny * w + nx;
        if (!open(nx, ny) || mark[cell] === stamp || lane[cell] >= hi) continue;
        const weight = (o[0] === dir[0] && o[1] === dir[1] ? 1 + 5 * straight : 1) * (pull ? 1 + pull * gain(cell, at) : 1);
        total += weight;
        if (R() * total < weight) next = o;
      }
      if (!next) break;
      dir = next;
      cells.push([x + dir[0], y + dir[1]]); add(x + dir[0], y + dir[1]);
    }
    // Clear exit: outrank everything. Otherwise sit between the two bounds.
    const r = hi === Infinity ? top + 1 : lo === -Infinity ? hi - 1 : (lo + hi) / 2;
    return lo < r && r < hi ? { cells, d, pins, room, r, at } : null;
  };

  // How much laying this arrow would add to the board's overflow: the number of arrows, summed over
  // every depth, beyond the limit for that depth. Arrows at one depth can all leave at the same
  // moment, so overflow is what makes a board feel open. Pushing arrows deeper follows through to
  // everything they pin in turn, exactly as `commit` does.
  const trial = [], tried = [], delta = new Map();
  let run = 0;
  const overflow = c => {
    run++; delta.clear();
    const bump = (at, by) => delta.set(at, (delta.get(at) || 0) + by);
    const now = id => (tried[id] === run ? trial[id] : depth[id]);
    bump(c.at, 1);
    for (const stack = [[c.at, c.pins]]; stack.length;) {
      const [from, list] = stack.pop();
      for (const other of list) { const at = now(other); if (at <= from) { bump(at, -1); bump(from + 1, 1); tried[other] = run; trial[other] = from + 1; stack.push([from + 1, blocks[other]]); } }
    }
    let sum = 0;
    for (const [at, by] of delta) { const had = crowd[at] || 0, cap = limit(at); sum += Math.max(0, had + by - cap) - Math.max(0, had - cap); }
    return sum;
  };

  const commit = c => {
    const id = arrows.length, [hx, hy] = c.cells[0];
    rank[id] = c.r; if (c.r > top) top = c.r;
    depth[id] = c.at; crowd[c.at] = (crowd[c.at] || 0) + 1; blocks[id] = [];
    for (const [x, y] of c.cells) {
      const cell = y * w + x; owner[cell] = id;
      if (cross[cell]) for (const other of cross[cell]) { free[other] = false; blocks[id].push(other); }
    }
    for (let x = hx + c.d[0], y = hy + c.d[1]; inside(x, y); x += c.d[0], y += c.d[1]) {
      const cell = y * w + x; if (c.r > lane[cell]) lane[cell] = c.r; (cross[cell] ||= []).push(id);
      if (owner[cell] >= 0) blocks[owner[cell]].push(id);
    }
    free[id] = !c.at; if (!c.at) freeList.push(id);
    arrows.push({ id, cells: c.cells.reverse() });
    // Whatever it pins now leaves later than it does, and so on down the line.
    for (const stack = [id]; stack.length;) {
      const from = stack.pop();
      for (const other of blocks[from]) if (depth[other] <= depth[from]) {
        crowd[depth[other]]--; depth[other] = depth[from] + 1; crowd[depth[other]] = (crowd[depth[other]] || 0) + 1; stack.push(other);
      }
    }
  };

  // Cells that can still carry a head. Once a cell cannot, it never can again: the board only fills.
  const heads = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) heads.push([x, y]);
  const randomHead = () => {
    while (heads.length) {
      const i = Math.floor(R() * heads.length), [x, y] = heads[i], d = heading(x, y);
      if (d) return { x, y, d, i };
      heads[i] = heads[heads.length - 1]; heads.pop();
    }
    return null;
  };
  const retire = i => { heads[i] = heads[heads.length - 1]; heads.pop(); };
  // A head on, or backing onto, the exit path of an arrow that is still free.
  const laneHead = () => {
    for (let tries = 0; tries < 3 && freeList.length; tries++) {
      const i = Math.floor(R() * freeList.length), a = arrows[freeList[i]];
      if (!free[a.id]) { freeList[i] = freeList[freeList.length - 1]; freeList.pop(); tries--; continue; }
      const [dx, dy] = headDir(a.cells); let [x, y] = a.cells[a.cells.length - 1], spot = null, n = 0;
      for (x += dx, y += dy; inside(x, y); x += dx, y += dy) if (open(x, y) && R() * ++n < 1) spot = [x, y];
      if (!spot) continue;
      for (const [ox, oy] of shuffle([[0, 0], ...DIRS])) {
        const d = heading(spot[0] + ox, spot[1] + oy);
        if (d && ((!ox && !oy) || (d[0] === ox && d[1] === oy))) return { x: spot[0] + ox, y: spot[1] + oy, d };
      }
    }
    return null;
  };
  const shortLen = () => 2 + Math.floor(Math.pow(R(), 1.4) * (maxLen - 1));

  let target = 1;
  // The untouched board may offer a few more moves than any later moment does.
  const limit = at => (at ? target : Math.max(target, opening));
  for (let knotLeft = 0; ;) {
    const longStep = longLen > maxLen && R() < long;
    target = knotLeft > 0 ? 1 : Math.max(1, width);
    let best = null, ties = 0, spare = -1;
    for (let i = 0, n = longStep ? Math.max(picks, 6) : picks; i < n; i++) {
      const at = (picks > 1 && i % 2 && laneHead()) || randomHead();
      if (!at) break;
      const c = longStep ? draft(at.x, at.y, at.d, Math.round(longLen * (0.5 + 0.5 * R())), 8) : draft(at.x, at.y, at.d, shortLen(), picks > 1 ? 3 : 0);
      if (at.i >= 0) spare = at.i;
      if (!c) continue;
      if (longStep) c.score = c.cells.length + 2 * c.pins.length;
      else if (picks < 2) c.score = 0;
      else c.score = 0.05 * c.pins.length - overflow(c);
      if (!best || c.score > best.score) { best = c; ties = 1; } else if (c.score === best.score && R() * ++ties < 1) best = c;
    }
    // Nothing worth laying: give up on one of the cells tried, so the search always ends.
    if (!best) { if (!heads.length) break; if (spare >= 0 && spare < heads.length) retire(spare); continue; }
    commit(best);
    knotLeft = longStep && best.cells.length > maxLen ? Math.round(knot * (0.5 + R())) : knotLeft - 1;
  }

  // Mop up: cells left over get absorbed by a neighbouring tail that outranks every exit path there.
  const growTail = (a, want) => {
    let grew = false, dir = [a.cells[0][0] - a.cells[1][0], a.cells[0][1] - a.cells[1][1]];
    while (a.cells.length < want) {
      const [x, y] = a.cells[0];
      const options = DIRS.filter(([dx, dy]) => open(x + dx, y + dy) && lane[(y + dy) * w + x + dx] < rank[a.id]);
      if (!options.length) break;
      const ahead = options.find(d => d[0] === dir[0] && d[1] === dir[1]);
      dir = ahead && R() < straight ? ahead : options[Math.floor(R() * options.length)];
      const next = [x + dir[0], y + dir[1]];
      owner[next[1] * w + next[0]] = a.id; a.cells.unshift(next); grew = true;
    }
    return grew;
  };
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (const a of shuffle(arrows.slice())) if (growTail(a, a.cells.length + 2)) changed = true;
    if (!changed) break;
  }

  // Safety net: the construction is solvable by design; drop anything that somehow is not.
  let out = arrows;
  for (let guard = 0; guard < 50; guard++) {
    const { stuck } = solve(w, h, out);
    if (!stuck.length) break;
    const drop = new Set(stuck);
    out = out.filter(a => !drop.has(a.id));
  }
  const dropped = arrows.length - out.length;
  out = shuffle(out.slice()).map((a, id) => ({ id, cells: a.cells }));
  return { w, h, shape, seed, arrows: out, order: solve(w, h, out).order, dropped };
}
