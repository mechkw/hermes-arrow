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

/**
 * Build a solvable board.
 *   w, h      grid size
 *   shape     silhouette name from SHAPES
 *   maxLen    longest arrow, in cells
 *   straight  0..1, how strongly a growing arrow keeps its heading
 *   seed      integer; same inputs give the same board
 *
 * Arrows are laid down in reverse leaving order: each new arrow leaves before every arrow already
 * on the board, so its path to the edge must be clear of them, and nothing placed earlier may later
 * grow into that path. `lane` remembers, per cell, the newest arrow whose exit path crosses it.
 */
export function generate({ w, h, shape = 'rect', maxLen = 6, straight = 0.55, seed = 1 }) {
  const R = rng(seed), mask = buildMask(w, h, shape);
  const owner = new Int32Array(w * h).fill(-1), lane = new Int32Array(w * h).fill(-1);
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const open = (x, y) => inside(x, y) && mask[y * w + x] && owner[y * w + x] < 0;
  const shuffle = list => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
  const exitClear = (x, y, dx, dy) => { for (x += dx, y += dy; inside(x, y); x += dx, y += dy) if (owner[y * w + x] >= 0) return false; return true; };

  // Grow the tail end. A cell is usable when no arrow that leaves earlier needs it as exit path.
  const growTail = (a, want) => {
    let grew = false, dir = a.cells.length > 1 ? [a.cells[0][0] - a.cells[1][0], a.cells[0][1] - a.cells[1][1]] : null;
    while (a.cells.length < want) {
      const [x, y] = a.cells[0];
      const options = DIRS.filter(([dx, dy]) => open(x + dx, y + dy) && lane[(y + dy) * w + x + dx] < a.id);
      if (!options.length) break;
      const ahead = dir && options.find(d => d[0] === dir[0] && d[1] === dir[1]);
      dir = ahead && R() < straight ? ahead : options[Math.floor(R() * options.length)];
      const next = [x + dir[0], y + dir[1]];
      owner[next[1] * w + next[0]] = a.id; a.cells.unshift(next); grew = true;
    }
    return grew;
  };

  const starts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) starts.push([x, y]);
  shuffle(starts);
  const arrows = [];
  const place = ([hx, hy]) => {
    if (!open(hx, hy)) return;
    // Prefer the heading with the most still-empty board ahead: later arrows will land there and
    // pin this one, which is what makes a board a puzzle rather than a clean-up.
    let d = null, total = 0;
    for (const [dx, dy] of DIRS) {
      if (!open(hx - dx, hy - dy) || !exitClear(hx, hy, dx, dy)) continue;
      let room = 0;
      for (let x = hx + dx, y = hy + dy; inside(x, y); x += dx, y += dy) room += mask[y * w + x];
      const weight = Math.pow(room + 0.25, 2.5);
      total += weight;
      if (R() * total < weight) d = [dx, dy];
    }
    if (!d) return;
    const a = { id: arrows.length, cells: [[hx - d[0], hy - d[1]], [hx, hy]] };
    for (const [x, y] of a.cells) owner[y * w + x] = a.id;
    for (let x = hx + d[0], y = hy + d[1]; inside(x, y); x += d[0], y += d[1]) lane[y * w + x] = a.id;
    growTail(a, 2 + Math.floor(Math.pow(R(), 1.4) * (maxLen - 1)));
    arrows.push(a);
  };
  starts.forEach(place);
  // Mop up: cells that could not seed an arrow get absorbed by a neighbouring tail, or seed one now.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const a of shuffle(arrows.slice())) if (growTail(a, Math.min(maxLen + 2, a.cells.length + 2))) changed = true;
    const before = arrows.length;
    starts.forEach(place);
    if (!changed && arrows.length === before) break;
  }

  // Safety net: the construction is solvable by design; drop anything that somehow is not.
  let out = arrows;
  for (let guard = 0; guard < 50; guard++) {
    const { stuck } = solve(w, h, out);
    if (!stuck.length) break;
    const drop = new Set(stuck);
    out = out.filter(a => !drop.has(a.id));
  }
  out = shuffle(out.slice()).map((a, id) => ({ id, cells: a.cells }));
  return { w, h, shape, seed, arrows: out, order: solve(w, h, out).order };
}
