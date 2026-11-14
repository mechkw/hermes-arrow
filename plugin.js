// Hermes Arrow 0.6.0 — built from src/ by scripts/build.mjs. Edit the sources, not this file.

// src/plugin.jsx
import { useEffect, useRef, useState } from "react";
import {
  atom,
  Button,
  COMPOSER_AREAS,
  Dialog,
  DialogContent,
  DialogTitle,
  haptic,
  host,
  PALETTE_AREA,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
  Switch,
  Tip,
  useValue
} from "@hermes/plugin-sdk";

// src/core.js
function rng(seed) {
  let a = seed >>> 0 || 2654435769;
  return () => {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var SHAPES = {
  rect: () => true,
  disc: (x, y) => x * x + y * y <= 1.02,
  diamond: (x, y) => Math.abs(x) + Math.abs(y) <= 1.04,
  ring: (x, y) => {
    const r = x * x + y * y;
    return r <= 1.02 && r >= 0.16;
  },
  cross: (x, y) => Math.abs(x) <= 0.4 || Math.abs(y) <= 0.4,
  hourglass: (x, y) => Math.abs(x) <= 0.18 + 0.82 * Math.abs(y),
  heart: (x, y) => {
    const u = x * 1.2, v = -y * 1.2 + 0.25, k = u * u + v * v - 1;
    return k * k * k - u * u * v * v * v <= 0;
  },
  wing: (x, y) => y <= 0.95 - 1.5 * Math.abs(x) * Math.abs(x) && y >= -1 + 0.9 * Math.abs(x) * (1 - Math.abs(x)) * 2 - 0.05,
  letter: (x, y) => Math.abs(x) >= 0.45 || Math.abs(y) <= 0.24
};
var SHAPE_NAMES = Object.keys(SHAPES);
var DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function buildMask(w, h, shape) {
  const test = SHAPES[shape] || SHAPES.rect, mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = w > 1 ? (x + 0.5) / w * 2 - 1 : 0, ny = h > 1 ? (y + 0.5) / h * 2 - 1 : 0;
    mask[y * w + x] = test(nx, ny) ? 1 : 0;
  }
  return mask;
}
var headDir = (cells) => {
  const a = cells[cells.length - 2], b = cells[cells.length - 1];
  return [b[0] - a[0], b[1] - a[1]];
};
function probe(w, h, grid, cells) {
  const [dx, dy] = headDir(cells);
  let [x, y] = cells[cells.length - 1], free = 0;
  for (; ; ) {
    x += dx;
    y += dy;
    if (x < 0 || y < 0 || x >= w || y >= h) return { blocker: -1, free };
    const id = grid[y * w + x];
    if (id >= 0) return { blocker: id, free };
    free++;
  }
}
function makeGrid(w, h, arrows) {
  const grid = new Int32Array(w * h).fill(-1);
  for (const a of arrows) if (!a.gone) for (const [x, y] of a.cells) grid[y * w + x] = a.id;
  return grid;
}
function solve(w, h, arrows) {
  const grid = makeGrid(w, h, arrows), left = /* @__PURE__ */ new Map(), order = [];
  for (const a of arrows) if (!a.gone) left.set(a.id, a);
  for (let moved = true; moved && left.size; ) {
    moved = false;
    for (const a of [...left.values()]) {
      if (probe(w, h, grid, a.cells).blocker !== -1) continue;
      for (const [x, y] of a.cells) grid[y * w + x] = -1;
      left.delete(a.id);
      order.push(a.id);
      moved = true;
    }
  }
  return { order, stuck: [...left.keys()] };
}
function generate({ w, h, shape = "rect", maxLen = 6, straight = 0.55, seed = 1, picks = 1, width = 0, opening = 0, long = 0, longLen = 0, knot = 0 }) {
  const R = rng(seed), mask = buildMask(w, h, shape), N = w * h;
  const owner = new Int32Array(N).fill(-1), lane = new Float64Array(N).fill(-Infinity), mark = new Int32Array(N);
  const cross = new Array(N).fill(null);
  const arrows = [], rank = [], free = [], freeList = [], seen = [];
  const depth = [], blocks = [], crowd = [];
  let stamp = 0, top = 0;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const open = (x, y) => inside(x, y) && mask[y * w + x] && owner[y * w + x] < 0;
  const shuffle = (list) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  const ceiling = (x, y, dx, dy) => {
    let hi = Infinity;
    for (x += dx, y += dy; inside(x, y); x += dx, y += dy) {
      const id = owner[y * w + x];
      if (id >= 0 && rank[id] < hi) hi = rank[id];
    }
    return hi;
  };
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
  const gain = (cell, at) => {
    const list = cross[cell];
    let n = 0;
    if (list) {
      for (const id of list) if (depth[id] <= at && seen[id] !== stamp) n++;
    }
    return n;
  };
  const draft = (hx, hy, d, want, pull) => {
    stamp++;
    let room = 0, hi = Infinity, at = 0;
    for (let x = hx + d[0], y = hy + d[1]; inside(x, y); x += d[0], y += d[1]) {
      const cell = y * w + x, id = owner[cell];
      mark[cell] = stamp;
      if (id >= 0) {
        if (rank[id] < hi) hi = rank[id];
        if (depth[id] >= at) at = depth[id] + 1;
      } else room += mask[cell];
    }
    const cells = [[hx, hy], [hx - d[0], hy - d[1]]];
    let lo = -Infinity, dir = [-d[0], -d[1]];
    const pins = [];
    const add = (x, y) => {
      const cell = y * w + x, list = cross[cell];
      mark[cell] = stamp;
      if (lane[cell] > lo) lo = lane[cell];
      if (list) {
        for (const id of list) if (depth[id] <= at && seen[id] !== stamp) {
          seen[id] = stamp;
          pins.push(id);
        }
      }
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
      cells.push([x + dir[0], y + dir[1]]);
      add(x + dir[0], y + dir[1]);
    }
    const r = hi === Infinity ? top + 1 : lo === -Infinity ? hi - 1 : (lo + hi) / 2;
    return lo < r && r < hi ? { cells, d, pins, room, r, at } : null;
  };
  const trial = [], tried = [], delta = /* @__PURE__ */ new Map();
  let run = 0;
  const overflow = (c) => {
    run++;
    delta.clear();
    const bump = (at, by) => delta.set(at, (delta.get(at) || 0) + by);
    const now2 = (id) => tried[id] === run ? trial[id] : depth[id];
    bump(c.at, 1);
    for (const stack = [[c.at, c.pins]]; stack.length; ) {
      const [from, list] = stack.pop();
      for (const other of list) {
        const at = now2(other);
        if (at <= from) {
          bump(at, -1);
          bump(from + 1, 1);
          tried[other] = run;
          trial[other] = from + 1;
          stack.push([from + 1, blocks[other]]);
        }
      }
    }
    let sum = 0;
    for (const [at, by] of delta) {
      const had = crowd[at] || 0, cap = limit(at);
      sum += Math.max(0, had + by - cap) - Math.max(0, had - cap);
    }
    return sum;
  };
  const commit = (c) => {
    const id = arrows.length, [hx, hy] = c.cells[0];
    rank[id] = c.r;
    if (c.r > top) top = c.r;
    depth[id] = c.at;
    crowd[c.at] = (crowd[c.at] || 0) + 1;
    blocks[id] = [];
    for (const [x, y] of c.cells) {
      const cell = y * w + x;
      owner[cell] = id;
      if (cross[cell]) for (const other of cross[cell]) {
        free[other] = false;
        blocks[id].push(other);
      }
    }
    for (let x = hx + c.d[0], y = hy + c.d[1]; inside(x, y); x += c.d[0], y += c.d[1]) {
      const cell = y * w + x;
      if (c.r > lane[cell]) lane[cell] = c.r;
      (cross[cell] ||= []).push(id);
      if (owner[cell] >= 0) blocks[owner[cell]].push(id);
    }
    free[id] = !c.at;
    if (!c.at) freeList.push(id);
    arrows.push({ id, cells: c.cells.reverse() });
    for (const stack = [id]; stack.length; ) {
      const from = stack.pop();
      for (const other of blocks[from]) if (depth[other] <= depth[from]) {
        crowd[depth[other]]--;
        depth[other] = depth[from] + 1;
        crowd[depth[other]] = (crowd[depth[other]] || 0) + 1;
        stack.push(other);
      }
    }
  };
  const heads = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) heads.push([x, y]);
  const randomHead = () => {
    while (heads.length) {
      const i = Math.floor(R() * heads.length), [x, y] = heads[i], d = heading(x, y);
      if (d) return { x, y, d, i };
      heads[i] = heads[heads.length - 1];
      heads.pop();
    }
    return null;
  };
  const retire = (i) => {
    heads[i] = heads[heads.length - 1];
    heads.pop();
  };
  const laneHead = () => {
    for (let tries = 0; tries < 3 && freeList.length; tries++) {
      const i = Math.floor(R() * freeList.length), a = arrows[freeList[i]];
      if (!free[a.id]) {
        freeList[i] = freeList[freeList.length - 1];
        freeList.pop();
        tries--;
        continue;
      }
      const [dx, dy] = headDir(a.cells);
      let [x, y] = a.cells[a.cells.length - 1], spot = null, n = 0;
      for (x += dx, y += dy; inside(x, y); x += dx, y += dy) if (open(x, y) && R() * ++n < 1) spot = [x, y];
      if (!spot) continue;
      for (const [ox, oy] of shuffle([[0, 0], ...DIRS])) {
        const d = heading(spot[0] + ox, spot[1] + oy);
        if (d && (!ox && !oy || d[0] === ox && d[1] === oy)) return { x: spot[0] + ox, y: spot[1] + oy, d };
      }
    }
    return null;
  };
  const shortLen = () => 2 + Math.floor(Math.pow(R(), 1.4) * (maxLen - 1));
  let target = 1;
  const limit = (at) => at ? target : Math.max(target, opening);
  for (let knotLeft = 0; ; ) {
    const longStep = longLen > maxLen && R() < long;
    target = knotLeft > 0 ? 1 : Math.max(1, width);
    let best = null, ties = 0, spare = -1;
    for (let i = 0, n = longStep ? Math.max(picks, 6) : picks; i < n; i++) {
      const at = picks > 1 && i % 2 && laneHead() || randomHead();
      if (!at) break;
      const c = longStep ? draft(at.x, at.y, at.d, Math.round(longLen * (0.5 + 0.5 * R())), 8) : draft(at.x, at.y, at.d, shortLen(), picks > 1 ? 3 : 0);
      if (at.i >= 0) spare = at.i;
      if (!c) continue;
      if (longStep) c.score = c.cells.length + 2 * c.pins.length;
      else if (picks < 2) c.score = 0;
      else c.score = 0.05 * c.pins.length - overflow(c);
      if (!best || c.score > best.score) {
        best = c;
        ties = 1;
      } else if (c.score === best.score && R() * ++ties < 1) best = c;
    }
    if (!best) {
      if (!heads.length) break;
      if (spare >= 0 && spare < heads.length) retire(spare);
      continue;
    }
    commit(best);
    knotLeft = longStep && best.cells.length > maxLen ? Math.round(knot * (0.5 + R())) : knotLeft - 1;
  }
  const growTail = (a, want) => {
    let grew = false, dir = [a.cells[0][0] - a.cells[1][0], a.cells[0][1] - a.cells[1][1]];
    while (a.cells.length < want) {
      const [x, y] = a.cells[0];
      const options = DIRS.filter(([dx, dy]) => open(x + dx, y + dy) && lane[(y + dy) * w + x + dx] < rank[a.id]);
      if (!options.length) break;
      const ahead = options.find((d) => d[0] === dir[0] && d[1] === dir[1]);
      dir = ahead && R() < straight ? ahead : options[Math.floor(R() * options.length)];
      const next = [x + dir[0], y + dir[1]];
      owner[next[1] * w + next[0]] = a.id;
      a.cells.unshift(next);
      grew = true;
    }
    return grew;
  };
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (const a of shuffle(arrows.slice())) if (growTail(a, a.cells.length + 2)) changed = true;
    if (!changed) break;
  }
  let out = arrows;
  for (let guard = 0; guard < 50; guard++) {
    const { stuck } = solve(w, h, out);
    if (!stuck.length) break;
    const drop = new Set(stuck);
    out = out.filter((a) => !drop.has(a.id));
  }
  const dropped = arrows.length - out.length;
  out = shuffle(out.slice()).map((a, id) => ({ id, cells: a.cells }));
  return { w, h, shape, seed, arrows: out, order: solve(w, h, out).order, dropped };
}

// src/game.js
var HOLD_MS = 360;
var DOUBLE_MS = 300;
var ZOOMS = [1, 1.75, 3];
var now = () => performance.now();
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var Game = class {
  constructor({ onChange, onEvent, colors } = {}) {
    this.onChange = onChange || (() => {
    });
    this.onEvent = onEvent || (() => {
    });
    this.colors = colors || (() => ({}));
    this.board = null;
    this.arrows = [];
    this.grid = null;
    this.mask = null;
    this.maxLives = 3;
    this.lives = 3;
    this.mistakes = 0;
    this.cleared = 0;
    this.total = 0;
    this.moves = 0;
    this.status = "empty";
    this.startedAt = 0;
    this.endedAt = 0;
    this.flying = [];
    this.hintId = -1;
    this.bumpUntil = /* @__PURE__ */ new Map();
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.canvas = null;
    this.frame = 0;
    this.pointers = /* @__PURE__ */ new Map();
    this.cleanup = [];
    this.preview = null;
    this.lastTap = null;
    this.pendingMiss = null;
  }
  // ---- rules -------------------------------------------------------------------------------
  /** `board` may be supplied already built (it must match `spec`); otherwise it is generated. */
  deal(spec, meta = {}, board = null) {
    this.spec = spec;
    this.meta = meta;
    this.maxLives = meta.lives || 3;
    this.board = board || generate(spec);
    this.mask = buildMask(spec.w, spec.h, spec.shape);
    this.reset();
    this.onEvent("deal");
  }
  /** Put the same board back, full lives. */
  reset() {
    if (!this.board) return;
    const { w, h } = this.board;
    this.arrows = this.board.arrows.map((a) => ({ id: a.id, cells: a.cells }));
    this.grid = makeGrid(w, h, this.arrows);
    this.total = this.arrows.length;
    this.cleared = 0;
    this.mistakes = 0;
    this.moves = 0;
    this.hints = 0;
    this.lives = this.maxLives;
    this.status = "play";
    this.startedAt = 0;
    this.endedAt = 0;
    if (this.canvas) this.hiddenAt = 0;
    this.flying = [];
    this.hintId = -1;
    this.bumpUntil.clear();
    this.preview = null;
    this.lastTap = null;
    this.dropMiss();
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.changed();
  }
  get left() {
    return this.arrows.length;
  }
  get touched() {
    return this.moves > 0;
  }
  // The clock stops while the board is off screen (the modal closed to read the chat).
  get seconds() {
    return this.startedAt ? ((this.endedAt || this.hiddenAt || Date.now()) - this.startedAt) / 1e3 : 0;
  }
  snapshot() {
    return {
      status: this.status,
      left: this.left,
      total: this.total,
      cleared: this.cleared,
      lives: this.lives,
      maxLives: this.maxLives,
      started: !!this.startedAt,
      mistakes: this.mistakes,
      hints: this.hints || 0,
      seconds: this.seconds,
      level: this.meta?.level || 0,
      handicap: this.meta?.handicap || 0,
      mode: this.meta?.mode || "free",
      zoomed: this.zoom > 1.01,
      w: this.board?.w || 0,
      h: this.board?.h || 0
    };
  }
  changed() {
    if (this.canvas) this.canvas.style.cursor = this.zoom > 1.01 ? "grab" : "pointer";
    this.onChange(this.snapshot());
    this.draw();
  }
  isFree(arrow) {
    return probe(this.board.w, this.board.h, this.grid, arrow.cells).blocker === -1;
  }
  dropMiss() {
    if (this.pendingMiss) {
      clearTimeout(this.pendingMiss.timer);
      this.pendingMiss = null;
    }
  }
  // A blocked tap waits a beat before it costs a life, so a double-click to zoom never does.
  flushMiss() {
    const m = this.pendingMiss;
    if (m) {
      this.dropMiss();
      this.tap(m.id);
    }
  }
  tap(id) {
    if (this.status !== "play") return;
    const arrow = this.arrows.find((a) => a.id === id);
    if (!arrow) return;
    const { w, h } = this.board, hit = probe(w, h, this.grid, arrow.cells);
    if (!this.startedAt) this.startedAt = Date.now();
    this.moves++;
    if (this.hintId === id) this.hintId = -1;
    if (hit.blocker === -1) {
      for (const [x, y] of arrow.cells) this.grid[y * w + x] = -1;
      this.arrows = this.arrows.filter((a) => a !== arrow);
      this.flying.push({ kind: "exit", cells: arrow.cells, t0: now(), reach: this.exitReach(arrow.cells) });
      this.cleared++;
      if (!this.arrows.length) {
        this.status = "won";
        this.endedAt = Date.now();
        this.hintId = -1;
      }
      this.onEvent(this.status === "won" ? "won" : "exit");
    } else {
      this.mistakes++;
      this.lives--;
      arrow.bump = { t0: now(), free: hit.free };
      this.bumpUntil.set(hit.blocker, now() + 420);
      if (this.lives <= 0) {
        this.status = "jam";
        this.endedAt = Date.now();
      }
      this.onEvent(this.status === "jam" ? "jam" : "blocked");
    }
    this.changed();
  }
  /** Point at an arrow that can leave right now. */
  hint() {
    if (this.status !== "play") return;
    const { w, h } = this.board;
    const free = this.arrows.find((a) => probe(w, h, this.grid, a.cells).blocker === -1);
    if (!free) return;
    if (this.hintId !== free.id) this.hints++;
    this.hintId = free.id;
    this.reveal(free);
    this.onEvent("hint");
    this.changed();
  }
  // ---- view --------------------------------------------------------------------------------
  attach(canvas) {
    this.detach();
    if (this.hiddenAt && this.startedAt && !this.endedAt) this.startedAt += Date.now() - this.hiddenAt;
    this.hiddenAt = 0;
    this.canvas = canvas;
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn, opts));
    };
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas.parentElement || canvas);
    this.cleanup.push(() => observer.disconnect());
    on(canvas, "pointerdown", (e) => this.pointerDown(e));
    on(canvas, "pointermove", (e) => this.pointerMove(e));
    on(canvas, "pointerup", (e) => this.pointerUp(e));
    on(canvas, "pointercancel", (e) => this.pointerUp(e, true));
    on(canvas, "contextmenu", (e) => e.preventDefault());
    on(canvas, "wheel", (e) => this.wheel(e), { passive: false });
    this.resize();
  }
  detach() {
    for (const fn of this.cleanup.splice(0)) fn();
    if (this.frame) cancelAnimationFrame(this.frame);
    for (const p of this.pointers.values()) clearTimeout(p.hold);
    this.flushMiss();
    if (this.canvas && !this.hiddenAt) this.hiddenAt = Date.now();
    this.frame = 0;
    this.canvas = null;
    this.pointers.clear();
    this.preview = null;
  }
  aspect() {
    const c = this.canvas;
    return c && c.clientHeight > 40 ? c.clientWidth / c.clientHeight : 1;
  }
  resize() {
    const c = this.canvas;
    if (!c) return;
    const box = (c.parentElement || c).getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(box.width)), height = Math.max(1, Math.round(box.height));
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    c.style.width = width + "px";
    c.style.height = height + "px";
    this.viewW = width;
    this.viewH = height;
    this.dpr = dpr;
    this.clampPan();
    this.draw();
  }
  // Board → screen. `cell` is the on-screen size of one cell.
  layout() {
    const { w, h } = this.board, pad = Math.min(28, Math.min(this.viewW, this.viewH) * 0.06);
    const fit = Math.max(2, Math.min((this.viewW - pad * 2) / w, (this.viewH - pad * 2) / h));
    const cell = fit * this.zoom;
    return { cell, fit, ox: (this.viewW - w * cell) / 2 + this.panX, oy: (this.viewH - h * cell) / 2 + this.panY };
  }
  maxZoom() {
    return this.board ? Math.max(ZOOMS[ZOOMS.length - 1], 46 / this.layout().fit) : 1;
  }
  /** Double-click: step through fit → closer → closest → fit, keeping the clicked spot in place. */
  cycleZoom(sx, sy) {
    const next = ZOOMS.find((z) => z > this.zoom + 0.05);
    if (!next) this.fit();
    else this.zoomAt(next / this.zoom, sx, sy);
    this.onEvent("zoom", { step: next ? ZOOMS.indexOf(next) / (ZOOMS.length - 1) : 0 });
  }
  clampPan() {
    if (!this.board || !this.viewW) return;
    const { cell } = this.layout(), { w, h } = this.board;
    const mx = Math.max(0, (w * cell - this.viewW) / 2 + 24), my = Math.max(0, (h * cell - this.viewH) / 2 + 24);
    this.panX = clamp(this.panX, -mx, mx);
    this.panY = clamp(this.panY, -my, my);
  }
  fit() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.changed();
  }
  zoomAt(factor, sx, sy) {
    if (!this.board) return;
    const before = this.layout(), next = clamp(this.zoom * factor, 1, this.maxZoom());
    if (next === this.zoom) return;
    const bx = (sx - before.ox) / before.cell, by = (sy - before.oy) / before.cell;
    this.zoom = next;
    this.panX = 0;
    this.panY = 0;
    const after = this.layout();
    this.panX = sx - (after.ox + bx * after.cell);
    this.panY = sy - (after.oy + by * after.cell);
    this.clampPan();
    this.changed();
  }
  /** Scroll a hinted arrow into view when zoomed in. */
  reveal(arrow) {
    if (this.zoom <= 1.01 || !this.viewW) return;
    const { cell, ox, oy } = this.layout(), [x, y] = arrow.cells[arrow.cells.length - 1];
    const sx = ox + (x + 0.5) * cell, sy = oy + (y + 0.5) * cell, m = 48;
    if (sx < m || sy < m || sx > this.viewW - m || sy > this.viewH - m) {
      this.panX += this.viewW / 2 - sx;
      this.panY += this.viewH / 2 - sy;
      this.clampPan();
    }
  }
  // How far an exiting arrow travels (in cells) before it is off the visible canvas.
  exitReach(cells) {
    if (!this.viewW) return this.board.w + this.board.h;
    const { cell, ox, oy } = this.layout(), [dx, dy] = headDir(cells), [x, y] = cells[cells.length - 1];
    const sx = ox + (x + 0.5) * cell, sy = oy + (y + 0.5) * cell;
    const px = dx > 0 ? this.viewW - sx : dx < 0 ? sx : dy > 0 ? this.viewH - sy : sy;
    return px / cell + cells.length + 1;
  }
  /**
   * The arrow under a point. With `assist` (taps only), a point that lands on or nearest a blocked
   * arrow but within a small margin of one that can leave is given to the one that can leave:
   * nobody means to tap the blocked one.
   */
  arrowAt(sx, sy, assist = false) {
    const id = this.nearest(sx, sy);
    if (!assist || id.best < 0 || this.isFree(this.arrows.find((a) => a.id === id.best))) return id.best;
    const { fx, fy, cx, cy, at, cell } = id, margin = clamp(10 / cell, 0.2, 0.5);
    let alt = -1, altD = Infinity;
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
      const other = at(x, y);
      if (other < 0 || other === id.best) continue;
      const edge = Math.hypot(Math.max(x - fx, 0, fx - x - 1), Math.max(y - fy, 0, fy - y - 1));
      const centre = Math.hypot(x + 0.5 - fx, y + 0.5 - fy);
      const ok = id.direct ? edge <= margin : centre <= Math.min(id.reach, id.bestD + margin);
      const d = id.direct ? edge : centre;
      if (ok && d < altD && this.isFree(this.arrows.find((a) => a.id === other))) {
        altD = d;
        alt = other;
      }
    }
    return alt >= 0 ? alt : id.best;
  }
  nearest(sx, sy) {
    if (!this.board) return { best: -1 };
    const { cell, ox, oy } = this.layout(), { w, h } = this.board;
    const fx = (sx - ox) / cell, fy = (sy - oy) / cell, cx = Math.floor(fx), cy = Math.floor(fy);
    const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h ? this.grid[y * w + x] : -1;
    const found = { fx, fy, cx, cy, at, cell };
    if (at(cx, cy) >= 0) return { ...found, best: at(cx, cy), bestD: 0, direct: true };
    const reach = clamp(22 / cell, 0.6, 1.6);
    let best = -1, bestD = reach;
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
      const id = at(x, y);
      if (id < 0) continue;
      const d = Math.hypot(x + 0.5 - fx, y + 0.5 - fy);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return { ...found, best, bestD, reach, direct: false };
  }
  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  pointerDown(e) {
    if (e.button > 0) return;
    const [x, y] = this.local(e);
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = { x, y, x0: x, y0: y, moved: false, held: false };
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      a.moved = b.moved = true;
      clearTimeout(a.hold);
      clearTimeout(b.hold);
      return;
    }
    p.hold = setTimeout(() => {
      if (p.moved || this.status !== "play" || this.pointers.size !== 1) return;
      const id = this.arrowAt(p.x0, p.y0);
      if (id < 0) return;
      p.held = true;
      this.preview = { id, until: Infinity };
      this.onEvent("preview", { clear: this.isFree(this.arrows.find((a) => a.id === id)) });
      this.draw();
    }, HOLD_MS);
  }
  pointerMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const [x, y] = this.local(e), dx = x - p.x, dy = y - p.y;
    p.x = x;
    p.y = y;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch > 0 && d > 0) this.zoomAt(d / this.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this.pinch = d;
      return;
    }
    if (p.held) return;
    if (!p.moved && Math.hypot(x - p.x0, y - p.y0) > 7) {
      p.moved = true;
      clearTimeout(p.hold);
    }
    if (p.moved && this.zoom > 1.01) {
      this.canvas.style.cursor = "grabbing";
      this.panX += dx;
      this.panY += dy;
      this.clampPan();
      this.draw();
    }
  }
  pointerUp(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p) return;
    clearTimeout(p.hold);
    if (this.canvas) this.canvas.style.cursor = this.zoom > 1.01 ? "grab" : "pointer";
    if (p.held) {
      if (this.preview) this.preview.until = now() + 900;
      this.draw();
      return;
    }
    if (p.moved || cancelled) return;
    const t = now(), last = this.lastTap, under = this.status === "play" ? this.arrowAt(p.x, p.y, true) : -1;
    if (last && !last.removed && last.id === under && t - last.t < DOUBLE_MS && Math.hypot(p.x - last.x, p.y - last.y) < 24) {
      this.dropMiss();
      this.lastTap = null;
      this.cycleZoom(p.x, p.y);
      return;
    }
    this.flushMiss();
    const id = under, arrow = id >= 0 && this.arrows.find((a) => a.id === id);
    let removed = false;
    if (arrow && this.isFree(arrow)) {
      this.tap(id);
      removed = true;
    } else if (arrow) this.pendingMiss = { id, timer: setTimeout(() => {
      this.pendingMiss = null;
      this.tap(id);
    }, DOUBLE_MS - 60) };
    this.lastTap = { t, x: p.x, y: p.y, id, removed };
  }
  wheel(e) {
    if (!this.board) return;
    e.preventDefault();
    const [x, y] = this.local(e);
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 18e-4)), x, y);
  }
  // ---- drawing -----------------------------------------------------------------------------
  draw() {
    if (!this.canvas || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }
  paint() {
    const c = this.canvas;
    if (!c || !this.viewW) return;
    const g = c.getContext("2d"), t = now(), colors = this.colors();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.viewW, this.viewH);
    if (!this.board) return;
    const { w, h } = this.board, { cell, ox, oy } = this.layout();
    const X = (x) => ox + (x + 0.5) * cell, Y = (y) => oy + (y + 0.5) * cell;
    let busy = false;
    if (cell >= 7) {
      g.fillStyle = colors.dot;
      g.globalAlpha = 0.5;
      const r = Math.max(0.6, cell * 0.045);
      g.beginPath();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (this.mask[y * w + x] && this.grid[y * w + x] < 0) {
        g.moveTo(X(x) + r, Y(y));
        g.arc(X(x), Y(y), r, 0, 6.2832);
      }
      g.fill();
      g.globalAlpha = 1;
    }
    const width = clamp(cell * 0.125, 1.3, 4.5);
    g.lineCap = "round";
    g.lineJoin = "round";
    const stroke = (points, color, alpha = 1, scale = 1) => {
      if (points.length < 2) return;
      g.globalAlpha = alpha;
      g.strokeStyle = color;
      g.fillStyle = color;
      g.lineWidth = width * scale;
      g.beginPath();
      g.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) g.lineTo(points[i][0], points[i][1]);
      g.stroke();
      const [ax, ay] = points[points.length - 2], [bx, by] = points[points.length - 1];
      const len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len;
      const tip = cell * 0.34, half = Math.max(width * 1.4, cell * 0.19) * scale;
      g.beginPath();
      g.moveTo(bx + ux * tip, by + uy * tip);
      g.lineTo(bx - uy * half, by + ux * half);
      g.lineTo(bx + uy * half, by - ux * half);
      g.closePath();
      g.fill();
      g.stroke();
      g.globalAlpha = 1;
    };
    const centres = (cells) => cells.map(([x, y]) => [X(x), Y(y)]);
    for (const a of this.arrows) {
      let color = colors.arrow, points = centres(a.cells), scale = 1;
      if (a.bump) {
        const k = (t - a.bump.t0) / 380;
        if (k >= 1) a.bump = null;
        else {
          busy = true;
          color = colors.bad;
          const reach = (a.bump.free + 0.3) * Math.sin(Math.PI * Math.min(1, k)) * (k < 0.5 ? 1 : 0.9);
          points = this.slide(a.cells, reach).map(([x, y]) => [X(x), Y(y)]);
        }
      }
      const flash = this.bumpUntil.get(a.id);
      if (flash) {
        if (flash > t) {
          busy = true;
          color = colors.bad;
        } else this.bumpUntil.delete(a.id);
      }
      if (a.id === this.hintId) {
        busy = true;
        color = colors.hint;
        scale = 1 + 0.25 * (0.5 + 0.5 * Math.sin(t / 160));
      }
      stroke(points, color, 1, scale);
    }
    const pv = this.preview, held = pv && this.arrows.find((a) => a.id === pv.id);
    if (pv && (!held || pv.until <= t || this.status !== "play")) this.preview = null;
    else if (held) {
      if (pv.until !== Infinity) busy = true;
      const hit = probe(w, h, this.grid, held.cells), clear = hit.blocker === -1;
      const [dx, dy] = headDir(held.cells), [hx, hy] = held.cells[held.cells.length - 1];
      const reach = clear ? Math.max(this.viewW, this.viewH) / cell : hit.free + 0.5;
      const fade = pv.until === Infinity ? 1 : clamp((pv.until - t) / 300, 0, 1), color = clear ? colors.go : colors.bad;
      const blocker = clear ? null : this.arrows.find((a) => a.id === hit.blocker);
      if (blocker) stroke(centres(blocker.cells), colors.bad, fade);
      stroke(centres(held.cells), color, fade, 1.2);
      g.globalAlpha = fade * 0.9;
      g.strokeStyle = color;
      g.lineWidth = Math.max(1.2, width * 0.8);
      g.setLineDash([Math.max(3, cell * 0.22), Math.max(3, cell * 0.24)]);
      g.beginPath();
      g.moveTo(X(hx + dx * 0.55), Y(hy + dy * 0.55));
      g.lineTo(X(hx + dx * reach), Y(hy + dy * reach));
      g.stroke();
      g.setLineDash([]);
      if (!clear) {
        const ex = X(hx + dx * reach), ey = Y(hy + dy * reach), half = cell * 0.3;
        g.lineWidth = Math.max(2, width * 1.3);
        g.beginPath();
        g.moveTo(ex - dy * half, ey - dx * half);
        g.lineTo(ex + dy * half, ey + dx * half);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    for (const f of this.flying) {
      const s = (t - f.t0) / 1e3, travelled = this.still ? f.reach + 1 : 7 * s + 46 * s * s;
      if (travelled > f.reach) {
        f.done = true;
        continue;
      }
      busy = true;
      stroke(this.slide(f.cells, travelled).map(([x, y]) => [X(x), Y(y)]), colors.go, clamp(1.15 - travelled / f.reach, 0.25, 1));
    }
    this.flying = this.flying.filter((f) => !f.done);
    if (busy) this.draw();
  }
  // The arrow's body after sliding `d` cells forward along its own path, then straight on.
  slide(cells, d) {
    const [dx, dy] = headDir(cells), n = cells.length - 1, head = cells[n];
    const at = (s) => {
      if (s >= n) return [head[0] + dx * (s - n), head[1] + dy * (s - n)];
      const i = Math.floor(s), f = s - i, a = cells[i], b = cells[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    };
    const out = [at(d)];
    for (let i = Math.floor(d) + 1; i <= n; i++) out.push(cells[i]);
    if (d > 0) out.push(at(d + n));
    return out;
  }
};

// src/score.js
var clamp2 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var livesFor = (n, handicap2 = 0) => clamp2(clamp2(2 + Math.floor((n - 1) / 2), 2, 5) - handicap2, 1, 7);
var handicapFactor = (h) => 1 + 0.15 * clamp2(Math.round(h || 0), -2, 2);
var STREAK_IDLE_MS = 36 * 60 * 60 * 1e3;
var liveStreak = (stats, now2 = Date.now()) => stats?.lastPlay && now2 - stats.lastPlay > STREAK_IDLE_MS ? 0 : Math.max(0, stats?.streak || 0);
var HINT_STEP = 0.05;
var HINT_FLOOR = 0.2;
var hintFactor = (n) => Math.max(HINT_FLOOR, 1 - HINT_STEP * (n * (n + 1)) / 2);
var nextHintCost = (n) => Math.round((hintFactor(n) - hintFactor(n + 1)) * 100) / 100;
function score({ level: level2 = 1, arrows = 0, seconds = 0, lives = 0, streak = 1, hints = 0, handicap: handicap2 = 0 }) {
  const base = arrows * 10;
  const difficulty = 1 + (level2 - 1) * 0.25;
  const time = clamp2(arrows * 2 / Math.max(1, seconds), 0.5, 2);
  const life = 1 + 0.1 * Math.max(0, lives);
  const run = 1 + 0.1 * clamp2(streak - 1, 0, 10);
  const hint = hintFactor(Math.max(0, hints));
  const odds = handicapFactor(handicap2);
  return { points: Math.round(base * difficulty * time * life * run * hint * odds), base, difficulty, time, life, run, hint, hints, odds, handicap: handicap2 };
}
function settle(stats, outcome, now2 = Date.now()) {
  const next = { boards: 0, arrows: 0, points: 0, best: 0, bestStreak: 0, ...stats, streak: liveStreak(stats, now2), lastPlay: now2 };
  if (!outcome.won) return { stats: { ...next, streak: 0 }, result: null, lost: next.streak };
  next.streak += 1;
  const result = score({ ...outcome, streak: next.streak });
  next.boards += 1;
  next.points += result.points;
  next.best = Math.max(next.best, result.points);
  next.bestStreak = Math.max(next.bestStreak, next.streak);
  return { stats: next, result: { ...result, streak: next.streak }, lost: 0 };
}

// assets/sfx/soft.mp3
var soft_default = "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";

// assets/sfx/tick.mp3
var tick_default = "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yv8kIvInS0qGm1P4NQ7BU6sNHiIlEtVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LE64ALpPkpjAxTgWEUY4WHjWBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsTKg8okPxFAsGHAAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

// assets/sfx/ding.mp3
var ding_default = "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iDG2GfL1g1wRoUWA2LVbqb5ObFZt+bUtCMvOyR1dtPg2imjUGnXm0SomRpi++ZM796SMHgQKiIIgMymPtN+WuWmroyvErL9hGpzu2t36A7dcGXMR0cEwfHKkeQC2a//7UsTmgAv0vScsmHSBRRrmdPYNnKFJnyakCqM7bHorqVVVhlojIc6DSn5f6OxVuKJydU9KhWFAZ4YcBhqprDXCiYAiQxqGOH7USRITSQNFQdDoCEp0YJWFRKRSdJhKeIjwC6G7Xh2eLW6CPnSyn0erK7Pv1kxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqFaaGbd7pkSR6GkTyoZjA6JI044sxNSRE//tSxOwACvCVJywM9IGFkSNE/Bi4kJEiD0DKy1H/WWxy+y2f6y2OXLAYOP+rAwcf9WBg4bsaar/VXT/aar/VXT+NNV/qrp/tNVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LE7YILPHUWzDzQQaQRYMDMDPBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsTIA8mEtsxGGGsIAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

// assets/sfx/rise.mp3
var rise_default = "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//tQwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAsAAAkuwALCxERFhYcHBwiIicnLS0zMzM4OD4+RERJSUlPT1VVWlpaYGBmZmxscXFxd3d9fYKCiIiIjo6Tk5mZmZ+fpKSqqrCwsLa2u7vBwcfHx8zM0tLY2Njd3ePj6enu7u709Pr6//8AAAAATGF2YzYwLjMxAAAAAAAAAAAAAAAAJAZCAAAAAAAAJLsGhgfkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7UMQAAAmNawwUEQAJiqcvNx6gAv+D/I38jfyN6NI3o0mfIT+Rv/Pp6HPITod5GndDnQjKc6AYtCEUOdAMWgQQynnfzvO8jKc87oScDFoBi0IRTnndCMoc6BzwDM8f/j+7PabbbS4aOMRBoMBIJUzF1iS8QTAnb3ebtbBFhEij0aljLWUhPHx/iINEWNFPNTtxmGYUTKaMB/+PSBSU88/ed/dLoi2b/+UVy6Ixwu/u3/xDG9+bJTeaQkx7/DjEB17tLhTKiKm6iHsQhIDAwZn/+1LEBgALPQVj/MKAAYOfrPzDiwgoHQ9PCsTR3Mj9U8hiRjyoOscerHYVI6FZRoYW/Rk6fqoOXm+4l9lkI36L+7v0S7JKYiNz3sodmDyB1hEhv3VEHP7GPvTS1SXPOqh3uCl1UXU7MVtJYwY8RhxMF4C1gECgTUaEWQ6GwfBIHj6QsZC3eyKGsNtvqSLPvZJXut6Vq4ESDvdtOUw/vVbsiUc8tKtXmpMUPKiJ/VVsQMFg2f/UKHhdFbYf+pBZJBq6dl2puXRkaGePXdGC1863x//7UsQGgAuU2WfnqFYBghQtPPec+CJRQCyRkY5yuy4Jx6bz0sELar81IsaclEfe4E0wDm1WtEoCxPbS0wUAFHUrWThgzzu86v3+xpdP1uQ4VDRjzBIqkspzSH+xbZ7+73ueUc5dSwohM0NW3mgUpVYoWJSDEMCI1KdDIqeKW5+L6peKQDImmJiYYDGUla4rEXZGILmYyCYCzf65hJ7beo3orj70WM380RLp3hAVFGNmVHHRR8cjO617rVaZilEgq2cHvt61KslUWQM2Z2SMkoua//tSxAWACzxXa+e9JcGKEW289I1wojHoogg4sxNGsuKcINhajp5U567EzyrJpG1XiXiPTnR6dAKkDZ92tssLHAgUJh8MhFQjHqFQ3cM1q5ix5W9n7o4xcDZgv/Z6n/4zXr7LV/Bo8oJwYkmskgziXQjoXYZRCyJek2HqTGgqjAzVUMgw2kiaakeyIhP/v5iV4Nl7/pThMeaoRYMuUsws2lJsqXdcxhQRTQJMa5MpczYKgICDJkdcbPIUKvZUpaeLEbjR4j0dFbYAaVA3AJSxJIv/+1LEBQALqNFl56RvAXWOLDmHmKhpzyG8ZpLCrZUgPQSRfilwOob0X0hByCKETkL/TMeZqybNoPkmf3kmAMiGQ59E9q+0QiXIlPmX/JJDM4z/sFQrVsqyMJG0btjZyAH5/MfU5zLN+mkAEQgEwE/hok0itJ5wm6NNNnQdxK30Ety+Hff7sjb7fFqV+YE8uLPR/AwnO3iMoEIk6tZCEg1FT5Au+4OmFPz5YtNmiH/B8ws+DzgvyBSdPIStBRl8BJ1EvVboFFKYAGNQNCjnsaJOkP/7UsQFgAtU/23mJE3BdSSt/PMWEMqh2NAQmBaEkCJ4saHGEBP7sGvGGp5PfSO7jin32YdXk0GyURA0AEBDUBQ2QMw51cljWyI84Nh2cLpKfp+rJIdSm9P/72BKgWnhDUas2/9PUBsrg0JUftVIcx3GcFYmDjJAVzQexpzK0n5nJP+EwpV1i3OxB/Yz+6B/cP6lFmIYoLhIPKylFv9WntvUSRjNS7ZVK+ZqDypSlu36Ky99/Wk+o8dvyk75DdYP6PpZ6QBCYGUGRtImjKBUHGJp//tSxAeACwyXaeexDIFxpO289hVoGB5HcVa2TMQJjVxIEcC15xcSdgLFGN4xpdwTZkf0LP+EMn+f5Iwa8arX8NrWegCF1Kexyt25YS93RXNaIaUCp4Gy2iDPQt3//TsEJEgKpMC/aJkkVy5PI2SdKY+kuuUYweOGBL0ocYrXe6wcYxbmWsyD02omA4Z0D4dF1VFiKPRXb0u63ZjIKVqaiv9LpRXai1ozdZCpf9NEyy6EIRGi///CHV/3MdcQZGBEMkP+uBlG5BN9tRmElCRZ4mn/+1LECwAKLK9z54iywUkPbzz0GiS/Q6CxZw1JFmo/qZbYoktWo9Wwocb1EgaeogEQDf+vVpmVdEOh1FgiDKC7zg6kdQ/916QwTY51rj7vXR0MpDBoiaJ3MMn6LZyhwKTUn7guy97eobU0fW1067WQIRs3OWjfzBRz/8g6LENX0cDkHRBPX0h+ACzHl62vhkSqU3q92+evpLnA+fXU9FZ3//9KhzEwYiI2gZWm2iNwg53aZ0adlMDtmByMAWUvgy/qyFy7rkfGbWOx+a+BhD6jpP/7UsQXAApUxW3sMOrBTI6t/PS1ZAcPbZRQu39+rc+s2rPbV+VUypBCnRZe5+ud5VGEk0J/o/6zvM0zkAIZk0IUYBCiLwnjYIUcUcznxsBJZmQ6D4cb22SuVYc3HeKAvB3Y+s2Qxmb8zHucZHcwC+jdKwdYqAWFa5bgJ2z+hzB+PeUXOwwI3XN+3/3fruWQIUcklGyRTQRlJLzSpC6WcWE9PcSOGW0TXgQXdj31Gkgg0BSjsNuZD8JeojQCsE5+u+JMBr7dXW2F3mOLrPr+PC2+//tSxCIACfCJaawlawFBju109QrIpRtPJ49GYyhQ07F9ogEivEDbCQ/bEu2KlBo8/XY2RDH6c+aOEbVWOnycEznA80OCEjVDNh+yoFANdNzQOM/uOW7DowawXFmCJ1VOQ5a9ZlDoeHguLim7wOKjnyn1tmy3RqNkAhynZE2IdQkWzrBDYqwvuCw12wuDodVeBG6bZZawnocNXDS5vCcChvUgBS3sMQ4bYmsIwEB0F886KMISzXd/rnw+w4YV+D5r/69iEEDRiTR21BAZZrylGej/+1LEMAAKGH+Bpj1H8Uwl7zz1lTxwoclKJIg7YgWFK72j0bIcFnv63ikbEtOrho9lrP2DwPbshR1bJa6uifRv0b/pt7f2212YroRCVXb/VhokogJu+CffqZcyQCSDbO3ZkJIqxdn7IfZ3pRDTrEtvRR9eiRpW52gXYO50IujgvpB8T4fUlo52LDdHLvsKlLfLOqdEVtHinD9bu/U3qioWNI9eJS52N/9fqSDjTiblRLNIOqxo5S52sq5O1CPHJQ7FviQ9WKO+Ocn175iIxJDiOf/7UsQ8AAn0lXXnrHEBQoyvdPMeSqRI7muKQwIcUSEgWjSo0PqsjxDaRFDJfu6ndSxmr6BxN1f+7C/931MVuEMQRSFJJNqXBNDsTuK7RJJ5mcDTQ7EfgyTUQD4r99yKRGJoGAmWdM0PmXyktnf2Uh3GRPtX9ao93+7/6d39kKi2J/06sSopxAwj/017//TMMZATGKOaXQtlU+gEIQTlAVFtMHEnIgRUdgpxv/ykmkP9M1me3J4/NVXTPS0nch38OfQCvjhTNbZkvyJcNlugM+sd//tSxEmACgUvdeYoTYFOpW68wItY/45EpfO7/9EDHMtY5////61IIAARABWqAMqVypDUbyDIfvPUQluIh9NCWWRDib+QPTHX6GjX8iicds0EhYrc++h01TmnJqTmN+z/N/u1D3Z790OcxAHKK3IK3b+VTo7hgqpJJkqYhDK0ZaXQQFvORUHvY8TYVjQpxjTsKFsCeQmBqClzYpPWNW0muS6b/6JjX8z7z/oyvrQ7OELv3RqHW1//1f3eWVbfYQORVt/+aQyjqlV1mVMgNWds/LX/+1LEVYAKVTFpzCyriT+lrrz1ieGZJUOYD9PRZTyg0uSGVbBBwfBqe2D44xZDVt5NUw0I3glXspROlGt1cqaEILY5ibeXvsv/9advTWtsFR2+v+vcTbf/Xo/+uVIQADJEihUIAPjb56klbAORLLgO9z48eBU4YhgfbbUh7hGoFwWMJzn/ciVXcZkUGm/84si0WSqFbX3ISM87z9Sf3/7sq2tKpBjj51/VQpcAIAJEaqFwFIaRzE4fcCMljE2KwMwzqCv+La+hBgVqSP2f2UakKP/7UsRiAAnRL3XnpEsBOKBtvPSJcNxi+2qkBjOpb7mv+DEImtEdH/7Su+9KVL//9q1ZZ1cRYbA6BdrJZQhmf7Htv9XTqpBAQIxFfW7QEVCoFQ7a1cmZkDBKBaeHo7oJr28UL+jPcf3CAi4xq96tTevV/r51iWoPAWAkoJBQgDLVLFAMOoCX/zROIhZADNpn/Fhi2/98pZWxololxstgAnyTKMlzpJqZ7khr4yJFG5KiETa9zEsHF9I0x0+acHRYWPU+IDc3dpvUd7//SiQ2b4uo//tSxHGACtkBb+Y8VAFGkC389KGQplVu12RytnMKnnpBr/yK3NbcxPWu3////16xJNt2tpsEhKjlQZknUWFtQ4220vyaajaYW8UDrT4T9rc8ENxOpoFWxpBnsKv1T/6l1rXAEwhEM46bEhY+ROa904nmXz///3tuxDuWhBDeuQ1T6PmV0iRbSlrTZBB5oeaC+bpxnYzGsvG7Qn0ctr0q7VfF+VMrBr0KazggCIuba/m4B6NPnojOMznwQUEguLJDJeeAbltDrSbDzn/1uH3S32b/+1LEewAKdLFxp7EO0VKhrrTwiyOjpw0xGuxIBCApLFKiUPgGF4REwXA9UREZtG6DdfcMt1svvNhrqJglBl1fwogisLdaMZ6G+4IKG6UOTbIhw+PcRShuhi0gWKhdmEheq/Qweu9//m/5Cyi9+JADAUaDYABy6UZ2sykUReDFYRBu3HJs3QjDLBTKnuig2mjFgfu9tFA2fV0ZM5vzRVxMmEJoAIatj3N3d9jhESJMwiRg+cAPBBQih31/XT8rLkAgIgBwlMzDcEi0QV5fJAlunP/7UsSEgAosdXWnpFDRTY/tvMQKGK6hi/cWgyzYyFj+pjnz/K0ZbCjVEXfJAKNSsCPOCZahIwUYE8eKfxE4eHxoqwTh4QCBLjzoiXmSyuyEAiFk2AKs3ZXsqCMGGgjcJy/hkljMKWhTnydig11XdPb5QdS5/51b6dHL9iMLDwwNEgvSeDIAXqHyj/dASbXigkLD1TwOXS8uhpz6OtH/s/rqDJAEwM3MnCETxUiiOZffIlPmlHGe5Qk9RMsVKw0JlgsAVTQeKfcsQDzUDoHGBhCh//tSxJAAShyDZaecUIEuCKz8x6UIdeHUaMSKijHnYFyjNn3aq1LKDiInZ7wgZCdy1Ff7BtfaVAEyAmkqtRbMDEPgdJpEFSoiJQQjTj2Yek6WSy9tk/3f/4Xi595zh4c9tzFRUdNOgSVy3U1b0g/fIZFhE3nP10H7SQ9w4C3N0Dz6zlH0ajzsGdFMQABiACu0mQCN9pRKhgI1MGEWFeBEuArLB4VDFRjLx8mA6jGjlyP+LNBuEohe8iASiiLShA8TNjw2SqWP7HGCT6OhFDjqCoP/+1LEn4AKSIFjh5hSQUKQLXzzCgDELiLdLIxn6Pi/pcpRAFQRT+SQkoDoSI40+ejs9l5BqYj4jaXfl2F/uxsHndC33PuYtKl77kWlgVZRa1dQGEBAkQFXzJNGw5aj/HuFVqNAwBTV+5p14Y//9FNXvuoEAMhJ9ZJUSjIJQhQhZby3LapPtrFLf5ORyeIrecj9m9DOnQCbInqBgcKmJcKj2hr4iIkkEBQuQCEABkkYmBbBuWVv+AB3ahDHqfjSYu05/9ylhhAAMQEpWkwAFo5tEP/7UsSsAAp8p23mFHaBS4qsvPYhUEbk2d5d2wkYhiDWAf585chLwUZuBet83rjeSNtTKZJE8HMi8RQ6RE59Zp2IGKrfk7Xf6bibCwNEEuVqRYr5kwA0Mnut+TkCoUjchLCXJ6p0o8KTsARCA5eQcY2sJMoWWocxj//AwSItenOplHZWcrTa2coYsKgsSZpvPO/yHht6ByTLV6AK9PE6f4p6v0LIVDATI1/z1iTkIUTk7yjQY5jCVIuhB99B6c2afwmebW0X7qGm6YGg8pp6qEgy//tSxLaAChhVa+elbgFLCu088y5AEIrX2iL0/G25AwxhYUF0hk0txzuat9vbeZW1U9MGXMUhiQv//7b9EwZEBKRJnI4ASb8Iv68rUmVScThvg/o70nL9lQiI3t6Nc6QjQ3Klq6kwLelY08fUCZFPvizrPCQ7I8GCqWv0PJHH3Ocx/+2rTv2WLiouU8kj6YkwADMAJ1pIghX83TlIOUaYYmIjYCA4ro43c5IWaDOVysvcG/451s0JX++9YbjbVFZlMsp6RCi6kJUVcWNCNNhzucn/+1LEwoAJQFlj57FqgUKSrfz0CXC1fWpyS2iZWoFBcitzVGrQIl1+h/145GAKIElcbhJISEDmiUQlVlJHSaxPA5cH6hSkuS5y7Yn9yVFg3dvxnuRVKDW4iUC29UafYyKlpYEcGIpOKvEQB4rWKq/isXjCgQQsSHww5u1DluqrZqiW2FVARCJf7NACz0rIgWOgMgmD7wlAzjqOqw8UzSxKZrJbnctNnwXGL34qIBz91nV0SdVj9Cg48/GzKwiLB4Dyy2LZUE1f1f6/ORQZsNpzvv/7UsTTAAqsf2vnoFZBRpAsvPOOwJPR0p9v20xgAAAAP1oCB+o/O8yplrO4iytpjOxgDncmceEsT0P830pHocGtzb/Vg3Fib3iRw4Q//kUzSYg6wMU0NLICYEDpizNjmSOi7YtMTug84OJUanVuepL0qR865eVRkpcAAAEAKNlogJbUQYbDKjmLIKVrtMLMkD4yFtPl7Z45VmUzV511gqvGeshGj6j7YpdaXNptatNcqggb21BhANDIRJkBQABtjWlQ0y5zOOaL0CFZEaVGHQSD//tSxN2ACwyFX+ewcMFdkCw885bADK1DTpVpkh6eUsUk+KTpzq9FIICBGKoXW2QiDyHJs9x6182ICrMAY6Ubj4hsgLxaazZJdM4JMOqNQJzqKbFr48j3DiT+1hFXMrqfVHMUQdY0EBZKVHHRICrXvNt/E3J54TtYzNLEAQQcHBiz6U66qBRAFRMlIW0UzLajjXaEGWaZ9FyR417wihcz6nNaCiztZ3OgzMdbVUKGR3h1dCKxzpZ7O438SCbDIGLvS8QjFVE3NYrdkzAkWdk2ESz/+1LE44AKnJdr5iC2IXSP6zmHjWgdavZhQ0WGuRpN8PCpV5HRKAAgACAmMJgEBpl3VJuGNCM+I4HQPxzXDEzKBCcw1cH4cVKIXqX15qKhsp1NyAHFWM6+xxUM8GDZ9rnXFVvHF0NDRBqXfSuiX1Gzq+lR2fJsdYMb9n//2LqVAAAAACqKQh1EhO7YWlUG6eZ4sZCY8MjFCeKVjp+Hp/sNL4Xo79cC7bV+bB0bB4gBB5Ai6uwDWbYqIUczc8BqopM4rduZUORVLKe0BtTrfrnb+v/7UsTogA1Uf1nsPEuBc5CrvPWOSJ/V46HARLeNxJQsgLQxeNEIcBM+EzAzdBd80RZUpCFOVJHYtp2KMDUOtL3Z8sUi8j3sWnCJ5rrbedCAxmNEnKj3lToobBoSkGjWWVUw8RHPa9JMFjwbXHqY5MyBfP0IXWccWIbi32laukVRAxVtvZiW9MKNHqJWug7hvFiJaZW+UFE+r93YnusRxH5uP7fa4FiN3u2z0LIqa6TCVY7lbfKyiQVEyItMaDnWQrsyoZ1sVP0f9jszer/o6d+z//tSxOKAC5yBXeesUkFijOr89qJIKzqfJJKGuWHLlF+w5t1UxmIgIC0rjhBkQ029aMhWkyIzOi0rjIfokIco7sRfMkipwTrxQOhp9fxGQ53bTHzAlBQJCERnBDJHmh0q16wsTcL9fkFkBSlc6NYwf6BgkcoxdI10EazL+cS/vXXsEgAAOmoUWcmVvqsbbosUfyHy+MPR0DJoTcDOstBgro2K9BAHJsMG+wEpcSpKnqCLAJbAw2BXG1hSx396HxIrRcxK1oVbsET//alxz08q7R3/+1LE5YEKyFVXx7FNAZEQq3zHjogAAAAmFAF2mcxp8S6tEqVx2KJyAgaBOCICpWkSKxJWFLVhqjsIqRZsBckQTAdWoZnSIC+5R03P62ToYwoKgIlOvo+xdnzIud/n/nYf/n0k4QJ0OsUo+S7JkX6neLsaKDyFXUXZtXGXJbn2dKPGKvQCCAU1C0AVbhpsq+FpV1D4Fh1Z49tznSULfqTvnUxZ839NdhNB4mckvYEgyNc87yomd+Cwo3HVvKfDIadhgg+h0skewPXPv19ItYKq6f/7UsTmAAxNOWXnsFKhcAzsPPYJNL3Sr1KTtdGydPqETUPi/6k04iIAQmz9lrTiEKs7Gw9dkxP5CTtMCLoHZhdpau35N6KLB75WVd7bhCXJOzPhL6lubzcLZen5LUCyYNE+ylIbvh49FGdXqnb9kVTvePCa/N5r+pIrmP760AAAAJTKJEJ59pcpg/aiqdULWuCkylrABWgSoleS2bITpXQXJYDWwFDEsYSijdWVoyjr0ZFJVmlreZhx4YNpEgYiYs69V1uS3OUhjCIQFJXGGUkn//tSxOSACgxTVYwwbIG3JWmxhI5QlnAJMWTU1tvdqsmCABAgI5rbYpF2rDNVJMjkUCXK5THe5TCC1hk5jc7Y9LvZaxL+AuLTxWPQBQ+dU4wfJjhqCwANRq3hq1gneEoTlZ+LbH6W/ppW2ww4qoLSiW/+y76KWgAQATNHG3CA68P4qjDyaStJMqksg2pWlqwFu1BLuaKzGgD8nhqu9PKChupN6f9BZtHsv3+UQbE0pqgprSIphxFUzPzENhjqoS5YJqJUkPKZPjqhKh1IqJXiV57/+1LE4wALzI9TrCxwwVyQq3z2DhgXehpljBk8g7vmTrRdaUsCRJ+kq6T1iaDbn/auwNje+AgBdJBSmrCLytYMCz9bmgnucrrViLpV6lrQCGpRg3QrEaWdP4RtC/D0VPoUEwiZUOE4HBOZbUber5G0NBTUs1jUBXWxxLlA4+5eGlucKsfZopqq/SLBSTddkUinfFwJyBmUSPDRNFcHOg9gCs+umtXTIln1Njpjwa3E0gBRO79zlUrhzeJqiC/RDtaGRlk+HeBy50cqI+vWX2rtFP/7UsTmAAvQf02MJHDBVAqrfPEmQEinewJI7TCDRAInUNetL222SXrmBNRBERk7HUnX9zCZTBWzZQg6ESS5yhnTDJAb+bJQzbrAEbwUWrDgS3uInPOOMLiKDAuJmiNzl03CS0upAYinrdRh56dM+Y4uuoLDjlbt/cSrO3RfqppZARABIkTibIK3CDjBVF0YkWg3i7DoixCriQNPyaK46MaNEkftgMYXj7+qBC83cOWMWCbj58dDAoXCYLICphDxZL/j1WvN9TrttZGDPb3Uev7P//tSxOoADijHVeekdiF0D+zw9I5O0r2AAAACsUjTbOxGgcAt6oOcyiTm8GI6PEY8H8BG2Ukbuo7Sy3p43C1T0zfNJyBzv8N/OhPVOHS7ZFZkGDIXKBMEiIbalxcYxqh7kCVAq9KyvcbiliwkNAxFoexdOMeMujq6aoY1UDNGZ726OaDvpEnDmX8RNPLSDinQshChDiyEUWysGU5l5SzUf3fP2VZavIhJQeqzpnKAsUCh4FgbPJOjW03vERGlNzmkTqmIOoYHzDGP2HnlUAU4YJr/+1LE4IALiJNTp6RygVkKq3z2Fcy6+syTsddqlAAAAVd/c8bDaPsYxDygCLUI9Y/jVawhrMVyd+qSTu1H9W4TptK8YjNrbTsnNnMsdK/Au5pxmMTjLVXKzOLlwxym5fJ3nPOz5dc76H5mV4XnRwpDTlLVR/ZjY/Thi6LNtf/51KIDak0riSkuMFGnUEQRPtSyTRZ2OyOaKdi4VE0aLtWUkcfrMUotwLx62kRV6W8PhO+ePKaElNjbrX7bN9GKrpS39P+1qN+zDiyFBVwq+Hmskf/7UsTlAApwU1PnsSohhxJpdPYNOF9ieXpTIfZawgkVvJJCUsaXy2IoeowEeymwX1YlJGyn8or4cEVe9FHFgKmFjJYRJ6IQsqxmYUZrO5EmG0ZDJDOUiUZ/3hBkI4uQknfHBlgiGinpdj2S5dkXNJGLSSgIalzFaI7Rv+rAEywJTV4YZ0F1wlBpv2rJ9H8acEEo1zohDM2KItW6WQlsa33TCnKRmJPZ+dAQYm8MoV6jfqC6vmMazU8qft4gyAQMg1FAunNrzqX8zaMFKByCwKT5//tSxOgAC+B9Weeka6GLoSiw9g2p9Q65lLP94oAAABFqVc6VYFcIyeoizaLKENRyEt788kSJlNg2KE6YEUsk/FmgGMsXZ2CgLFs6w01VcZHdXVkYWXMhlul2Z2StnbNseu1bP/ZbX6d2BRZ5RLXtebkZh2//6CggAAAFkS7adFubUlqELo0genKEdgVEBwCxOAkUaKN1REuhbMO0BcXzjI71a1wYRsYANIZ21SY7r0igngNr3csoD/wTSUt9CLvmJjlRRqBwoOPFR0rNlhceom3/+1LE5QALJQVRp4xYYX+V6bTzDsQDPFjVoVny/XrZLLFskAqGssEZFLUhm7L8V/aBMGzLXQstR5Q9JGG52lYRUOkPux8CMmEe1vYSkU5lBwyb+zb+nARQWZ6zzOEbpnxj5XyJR8fc5LHwWNL0SiRlS1T8Ei8k9CiYThAAAAAMOiZ3WAssT+bOqsJBFmJLJkKXQyFstdVI8U5KXFQ6ZUdBUhUgYdquEI6vNulpF3cyl5tkvP9rXfMvrMRLc4+x7BkhBwYXiWZFilBZlGLHrQ7Usf/7UsTmgAtspTrMPGtBbiBncPSJ2HDR5Rxrz+uggA1ZEjErWkpenuHEQ1lYH06r+kLrTnKbxTsNCqYemhAVuxPGsbWXk6WstBUTuyXjUb+XlyVFFGguwWGLAstQpyhwbHluIjcSgs9EevMHVG+WQIryI+Jo910BYAtX36glfKpoCJkMeIQpmqww0IlwpTJer8w+rYYTQqm2g1mWhOOPOojmToGLnrlH1v7p6bXo6FhyRcVEzRR6i1QVYeBc9Ul/DSaXpUo6Ig8eekgDBahmSZo6//tSxOkDTGjHNSw8a0FuGKZJhg5QWBADKlazXEAVhKl/WTA4E9I5ZKCo4pJL1SyDoeHUAMXLItiFj7MGPCnq2iS2UkGlIGjujzy2nKbGth7VQfpfFClytWqaGfnwrfLk+f9kbL+VZqZtfkrQ2q+JEqIw8wVMD36r0f9ahAQE2SJEz7Ynh1pE7S6ClEyCPJdQjiRlFO8ekyL3Op8Fo0KmeAVWfS20DDfSBoqk1/FJWxPxDZRwVE5xFH3sT/6/7Wenr/2CvR/0ADKX9eAs8mtNxRD/+1LE54EL2LExjCxwwWSOZaQMJDjJSSaRjMClEgzt88LSRYCXdWGBJAM6B4kvlAC6rACiWSJcMxCoZkFE2ARrqpM3xiZm2AjrCjqhQlEQlLD5IiVBYSyrg6JQ1qPc6DT5Y9DUs/KqfqBr+Ikaga5VzzvkqkxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgAJmgRJBCHkTiWTDcsmRiSRyCUT4SENYd5ICVkjL4h6gf/7UsTpgwtoiyZMGRJBlaHjyZeOUAT0yKo9B0KQeGseCWJBmeOfxQWFmoAQSFhYX+WFhYXFTIwWFSJkJC4r/zKhYVmVC4rd/6xWTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tSxOcACWSLJUexEAGkkWCFhI5Iqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+1LEzIPKuEydJj2KgAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg==";

// assets/sfx/fall.mp3
var fall_default = "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";

// assets/sfx/flourish.mp3
var flourish_default = "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VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsToggqAsxzH5MWBk5ghgJ0wqFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tSxM6DyzCtACZgyMAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=";

// src/sound.js
var CLIPS = { soft: soft_default, tick: tick_default, ding: ding_default, rise: rise_default, fall: fall_default, flourish: flourish_default };
var MASTER = 1;
var semis = (n) => 2 ** (n / 12);
var CLIMB = [0, 2, 4, 7, 9, 12, 14, 16];
var COMBO_MS = 1400;
var CUES = {
  // o.k is board progress 0..1, o.step the place in the current run of quick moves.
  move: (o) => ({ clip: o.step % 3 === 2 ? "soft" : "tick", rate: (o.step % 3 === 2 ? 1.5 : 1) * semis(CLIMB[Math.min(o.step, CLIMB.length - 1)] - 3 + 3 * o.k) * (0.985 + 0.03 * o.jitter), dur: 0.34, gain: 0.5, synth: "move" }),
  blocked: () => ({ clip: "fall", rate: 1.06, dur: 0.5, gain: 0.55, synth: "blocked" }),
  lastLife: () => ({ clip: "fall", rate: 0.8, dur: 0.95, gain: 0.7, synth: "blocked" }),
  jam: () => ({ clip: "fall", rate: 0.6, dur: 2, gain: 0.75, synth: "loss" }),
  win: () => ({ clip: "flourish", rate: 1, dur: 1.4, gain: 0.75, synth: "win" }),
  deal: () => ({ clip: "rise", rate: 1, dur: 0.75, gain: 0.3 }),
  hint: () => ({ clip: "ding", rate: 1.5, dur: 0.4, gain: 0.3 }),
  previewClear: () => ({ clip: "soft", rate: 2, dur: 0.16, gain: 0.28 }),
  previewBlocked: () => ({ clip: "soft", rate: 0.75, dur: 0.24, gain: 0.32 }),
  // o.k is how far in the zoom is, 0 (fit) to 1 (closest).
  zoom: (o) => ({ clip: "tick", rate: 0.75 + 0.75 * o.k, dur: 0.09, gain: 0.2 }),
  agentDone: () => ({ clip: "ding", rate: 1, dur: 1, gain: 0.6 }),
  streak: () => ({ clip: "rise", rate: 1.5, dur: 0.7, gain: 0.4 })
};
var CUE_NAMES = Object.keys(CUES);
function bytes(base64) {
  const raw = atob(base64), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}
function createSound(isOn, volume = () => 0.7) {
  let ctx = null, out = null, lastMove = 0, step = 0;
  const buffers = {}, played = [];
  try {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decoder = OAC ? new OAC(1, 1, 44100) : null;
    if (decoder) for (const [name, data] of Object.entries(CLIPS)) {
      const done = decoder.decodeAudioData(bytes(data), (b) => {
        buffers[name] = b;
      }, () => {
      });
      if (done?.catch) done.then((b) => {
        if (b) buffers[name] = b;
      }).catch(() => {
      });
    }
  } catch {
  }
  const audio = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      out = ctx.createGain();
      out.connect(ctx.destination);
    }
    const v = Math.max(0, Math.min(1, Number(volume()) || 0));
    out.gain.value = MASTER * v * v;
    return ctx;
  };
  const sample = (ac, { clip, rate = 1, dur = 1, gain = 0.5 }) => {
    const src = ac.createBufferSource(), amp = ac.createGain(), t = ac.currentTime;
    src.buffer = buffers[clip];
    src.playbackRate.value = Math.max(0.25, Math.min(4, rate));
    const length = Math.min(dur, src.buffer.duration / src.playbackRate.value), fade = Math.min(0.12, length * 0.5);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.setValueAtTime(gain, t + length - fade);
    amp.gain.linearRampToValueAtTime(1e-4, t + length);
    src.connect(amp).connect(out);
    src.start(t);
    src.stop(t + length + 0.02);
  };
  const note = (ac, { at = 0, freq, to, dur, type = "triangle", gain = 0.14 }) => {
    const t = ac.currentTime + at, osc = ac.createOscillator(), amp = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    amp.gain.setValueAtTime(1e-4, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 8e-3);
    amp.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    osc.connect(amp).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };
  const synth = {
    move: (ac, o) => note(ac, { freq: 430 + 260 * o.k, to: 760 + 420 * o.k, dur: 0.1, gain: 0.11 }),
    blocked: (ac) => {
      note(ac, { freq: 150, to: 82, dur: 0.17, type: "square", gain: 0.1 });
      note(ac, { freq: 96, to: 60, dur: 0.2, type: "sawtooth", gain: 0.07 });
    },
    win: (ac) => [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => note(ac, { at: i * 0.095, freq, dur: i === 3 ? 0.42 : 0.16 })),
    loss: (ac) => [392, 311.13, 233.08].forEach((freq, i) => note(ac, { at: i * 0.17, freq, to: freq * 0.94, dur: i === 2 ? 0.5 : 0.22, type: "sawtooth", gain: 0.08 }))
  };
  const fire = (ac, name, o) => {
    const cue = CUES[name](o);
    if (buffers[cue.clip]) sample(ac, cue);
    else if (cue.synth) synth[cue.synth](ac, o);
    else return;
    played.push(name);
    if (played.length > 200) played.shift();
  };
  return {
    /** Cue names actually sounded, oldest first. For tests. */
    played,
    /** Output gain in use, 0..1. */
    gain: () => out?.gain.value ?? 0,
    ready: () => Object.keys(CLIPS).every((name) => buffers[name]),
    play(name, k = 0) {
      if (!isOn() || !CUES[name]) return;
      try {
        const ac = audio();
        if (!ac) return;
        const o = { k: Math.max(0, Math.min(1, Number(k) || 0)), step: 0, jitter: Math.random() };
        if (name === "move") {
          const t = Date.now();
          step = t - lastMove < COMBO_MS ? step + 1 : 0;
          lastMove = t;
          o.step = step;
        }
        if (ac.state === "running") return fire(ac, name, o);
        const asked = performance.now();
        ac.resume().then(() => {
          if (performance.now() - asked < 250 && isOn()) fire(ac, name, o);
        }).catch(() => {
        });
      } catch {
      }
    },
    dispose() {
      try {
        ctx?.close();
      } catch {
      }
      ctx = null;
      out = null;
    }
  };
}

// src/difficulty.js
var LEVELS = [
  { n: 1, size: 6, maxLen: 3, picks: 2, width: 3, long: 0, secs: 15, name: "Blink" },
  { n: 2, size: 9, maxLen: 4, picks: 3, width: 3, long: 0.03, secs: 35, name: "Errand" },
  { n: 3, size: 13, maxLen: 5, picks: 4, width: 3, long: 0.04, secs: 55, name: "Task" },
  { n: 4, size: 18, maxLen: 6, picks: 5, width: 3, long: 0.04, secs: 90, name: "Project" },
  { n: 5, size: 24, maxLen: 7, picks: 6, width: 3, long: 0.04, secs: 150, name: "Deep work" },
  { n: 6, size: 32, maxLen: 8, picks: 7, width: 3, long: 0.035, secs: 240, name: "Marathon" },
  { n: 7, size: 40, maxLen: 9, picks: 8, width: 3, long: 0.03, secs: 360, name: "Odyssey" }
];
var MAX_LEVEL = LEVELS.length;
var level = (n) => LEVELS[Math.max(1, Math.min(MAX_LEVEL, Math.round(n))) - 1];
function levelForSeconds(seconds) {
  let pick = 1;
  for (const l of LEVELS) if (l.secs <= seconds) pick = l.n;
  return pick;
}
var HEAVY = /\b(refactor|implement|build|create|migrate|audit|research|investigate|analy[sz]e|review|debug|deploy|test|rewrite|generate|design|scrape|compare|benchmark|optimi[sz]e|install|convert|translate|summari[sz]e|plan|every|entire|comprehensive|thorough|deep|full|all)\b/gi;
var LIGHT = /^\s*(hi|hello|hey|thanks|thank you|ok|okay|yes|no|yep|nope|cool|great|nice|continue|go on|go ahead)\b[\s.!?]*$/i;
var median = (list) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function estimateSeconds({ text = "", attachments = 0, history = [] } = {}) {
  const base = history.length >= 3 ? Math.max(12, median(history)) : 45;
  const words = (text.trim().match(/\S+/g) || []).length;
  if (LIGHT.test(text)) return Math.max(8, base * 0.3);
  let factor = !words ? 1 : words < 6 ? 0.6 : words < 25 ? 1 : words < 80 ? 1.5 : words < 250 ? 2.2 : 3;
  const heavy = new Set((text.match(HEAVY) || []).map((s) => s.toLowerCase())).size;
  factor += Math.min(6, heavy) * 0.35;
  factor += Math.min(3, attachments) * 0.3;
  if (/\?\s*$/.test(text) && words < 15 && !heavy) factor *= 0.6;
  return Math.max(8, Math.min(1800, base * factor));
}
var heatSeconds = ({ elapsed = 0, tools = 0, subagents = 0 } = {}) => elapsed * 1.25 + tools * 6 + subagents * 40;
var levelForTask = (task) => levelForSeconds(Math.max(task.estimate || 0, heatSeconds(task)));
var HANDICAP_NAMES = { "-2": "Much easier", "-1": "Easier", 0: "Standard", 1: "Harder", 2: "Much harder" };
var handicap = (h) => Math.max(-2, Math.min(2, Math.round(Number(h) || 0)));
var DIALS = { "-2": [0, 8, 0.4], "-1": [0.5, 5, 0.7], 0: [1, 3, 1], 1: [2, 2, 1.3], 2: [4, 1, 1.6] };
var SHAPE_POOL = ["rect", "disc", "diamond", "ring", "cross", "hourglass", "heart", "wing", "letter"];
function boardSpec(n, { aspect = 1, seed = 1, handicap: raw = 0 } = {}) {
  const hc = handicap(raw);
  const l = level(n), a = Math.max(0.6, Math.min(1.7, aspect || 1));
  const w = Math.max(4, Math.round(l.size * Math.sqrt(a))), h = Math.max(4, Math.round(l.size / Math.sqrt(a)));
  const shape = l.n < 3 ? "rect" : SHAPE_POOL[(seed >>> 3) % SHAPE_POOL.length];
  const [tight, width, long] = DIALS[hc];
  return {
    w,
    h,
    shape,
    maxLen: Math.max(2, l.maxLen + hc),
    straight: 0.5 + (seed >>> 7) % 20 / 100,
    seed,
    picks: Math.max(1, Math.round(l.picks * tight)),
    width,
    opening: width * 3,
    // Long arrows run one to two board lengths. The smallest board has no room for them.
    long: l.long * long,
    longLen: l.long ? Math.round(l.size * 2) : 0,
    knot: 3 + l.n + hc
  };
}
var dealBoard = (n, opts = {}) => generate(boardSpec(n, opts));

// src/tracker.js
var HISTORY = 40;
function createTracker({
  atom: atom2,
  busyBySession,
  onEvent,
  storage,
  setInterval,
  now: now2 = Date.now,
  onStart = () => {
  },
  onError = () => {
  },
  defer = (fn) => typeof queueMicrotask === "function" ? queueMicrotask(fn) : Promise.resolve().then(fn)
}) {
  const safe = (where, fn) => (...args) => {
    try {
      defer(() => {
        try {
          fn(...args);
        } catch (error) {
          try {
            onError(where, error);
          } catch {
          }
        }
      });
    } catch {
    }
  };
  const $task = atom2({ busy: false }), $done = atom2(null);
  const tasks = /* @__PURE__ */ new Map();
  let history = [].concat(storage.get("history", []) || []).filter((n) => Number.isFinite(n)).slice(-HISTORY);
  let pending = null;
  const publish = () => {
    let first = null;
    for (const t of tasks.values()) if (!first || t.start < first.start) first = t;
    if (!first) {
      if ($task.get().busy) $task.set({ busy: false });
      return;
    }
    const view = {
      busy: true,
      count: tasks.size,
      start: first.start,
      elapsed: (now2() - first.start) / 1e3,
      tools: first.tools,
      subagents: first.subagents,
      estimate: first.estimate
    };
    view.level = levelForTask(view);
    $task.set(view);
  };
  const sync = (map) => {
    const t = now2(), busy = map || {};
    let started = false, ended = false;
    for (const id of Object.keys(busy)) {
      if (!busy[id] || tasks.has(id)) continue;
      const fresh = pending && t - pending.at < 1e4 ? pending : null;
      pending = null;
      tasks.set(id, {
        id,
        start: t,
        tools: 0,
        subagents: 0,
        estimate: estimateSeconds({ text: fresh?.text || "", attachments: fresh?.attachments || 0, history })
      });
      started = true;
    }
    for (const [id, task] of [...tasks]) {
      if (busy[id]) continue;
      tasks.delete(id);
      ended = true;
      const duration = (t - task.start) / 1e3;
      if (duration >= 3) {
        history = [...history, Math.round(duration)].slice(-HISTORY);
        storage.set("history", history);
      }
      $done.set({ duration, at: t, tools: task.tools, still: tasks.size });
    }
    if (!started && !ended) return;
    if (started) $done.set(null);
    publish();
    if (started) onStart($task.get());
  };
  const owner = (event) => tasks.get(event?.session_id) || (tasks.size === 1 ? tasks.values().next().value : null);
  const stops = [
    // Deferred, so a turn already running when the plugin loads reaches `onStart` after the caller holds the tracker.
    busyBySession.subscribe(safe("busy", sync)),
    onEvent("tool.start", safe("tool.start", (e) => {
      const t = owner(e);
      if (t) {
        t.tools++;
        publish();
      }
    })),
    onEvent("subagent.start", safe("subagent.start", (e) => {
      const t = owner(e);
      if (t) {
        t.subagents++;
        publish();
      }
    })),
    setInterval(safe("tick", () => {
      if (tasks.size) publish();
    }), 1e3)
  ];
  return {
    $task,
    $done,
    /** The composer saw a message go out: remember it for the turn that is about to start. */
    sawPrompt(draft) {
      try {
        pending = { text: String(draft?.text || ""), attachments: draft?.attachments?.length || 0, at: now2() };
      } catch {
      }
    },
    dismiss() {
      $done.set(null);
    },
    history: () => history.slice(),
    dispose() {
      for (const stop of stops) if (typeof stop === "function") stop();
    }
  };
}

// src/plugin.jsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var ID = "hermes-arrow";
var ROUTE = "/hermes-arrow";
var VERSION = "0.6.0";
var MAX_FADE = 0.8;
var MODAL_W = "min(94vw, 1100px)";
var MODAL_H = "min(86vh, 860px)";
var fmt = (n) => Math.round(n).toLocaleString("en-US");
var clock = (seconds) => {
  const s = Math.max(0, Math.floor(seconds)), m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
};
var hashPath = () => (window.location.hash || "").replace(/^#/, "") || "/";
var onGame = () => hashPath().split("?")[0] === ROUTE;
function palette(el) {
  let at = -Infinity, value = {};
  return () => {
    const t = performance.now();
    if (t - at < 1e3 || !el.isConnected) return value;
    at = t;
    const css = getComputedStyle(el), read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const text = css.color || "currentColor";
    value = {
      arrow: read("--ui-accent", text),
      hint: read("--ui-yellow", text),
      bad: read("--ui-red", text),
      go: read("--ui-green", text),
      dot: read("--ui-text-quaternary", text)
    };
    return value;
  };
}
function create(ctx) {
  const $snap = atom({ status: "empty" }), $auto = atom(0), $result = atom(null), $sound = atom(true), $volume = atom(0.7), $stats = atom({}), $modal = atom(false), $fade = atom(0), $offer = atom(true), $handicap = atom(0);
  const stored = (key, fallback) => {
    try {
      const v = ctx.storage.get(key, fallback);
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  };
  const store = (key, value) => {
    try {
      ctx.storage.set(key, value);
    } catch {
    }
  };
  let freeLevel = Math.max(1, Math.min(MAX_LEVEL, Number(stored("freeLevel", 3)) || 3));
  let stats = { boards: 0, arrows: 0, points: 0, best: 0, streak: 0, bestStreak: 0, lastPlay: 0, ...stored("stats", {}) || {} };
  let returnTo = "/", colors = () => ({}), stopAuto = null, taskLevel = 0;
  $stats.set(stats);
  $sound.set(stored("sound", true) !== false);
  $volume.set(Math.max(0, Math.min(1, Number(stored("volume", 0.7)) || 0)));
  $fade.set(Math.max(0, Math.min(MAX_FADE, Number(stored("fade", 0)) || 0)));
  $offer.set(stored("offer", true) !== false);
  $handicap.set(handicap(stored("handicap", 0)));
  const sound = createSound(() => $sound.get(), () => $volume.get());
  const saveStats = (next) => {
    stats = next;
    store("stats", stats);
    $stats.set(stats);
  };
  const finish = (won) => {
    const s = game.snapshot();
    const { stats: next, result, lost } = settle(stats, { won, level: s.level, arrows: s.total, seconds: s.seconds, lives: s.lives, hints: s.hints, handicap: s.handicap });
    saveStats(next);
    $result.set(won ? { ...result, total: next.points } : { lostStreak: lost });
  };
  const game = new Game({
    colors: () => colors(),
    onChange: (snap) => $snap.set(snap),
    onEvent: (type, detail = {}) => {
      const cue = (...args) => {
        if (game.canvas) sound.play(...args);
      };
      if (type === "exit" || type === "won" || type === "blocked" || type === "jam") {
        try {
          haptic("tap");
        } catch {
        }
      }
      if (type === "deal") {
        $result.set(null);
        cue("deal");
      }
      if (type === "exit") {
        stats.arrows++;
        cue("move", game.total ? game.cleared / game.total : 0);
      }
      if (type === "blocked") cue(game.lives === 1 ? "lastLife" : "blocked");
      if (type === "hint") cue("hint");
      if (type === "preview") cue(detail.clear ? "previewClear" : "previewBlocked");
      if (type === "zoom") cue("zoom", detail.step);
      if (type === "won") {
        stats.arrows++;
        finish(true);
        cue("win");
        queueNext();
        const streak = $result.get()?.streak || 0;
        if (streak === 3 || streak >= 5 && streak % 5 === 0) ctx.setTimeout(() => cue("streak"), 900);
      }
      if (type === "jam") {
        finish(false);
        cue("jam");
      }
    }
  });
  const cancelAuto = () => {
    if (stopAuto) {
      stopAuto();
      stopAuto = null;
    }
    $auto.set(0);
  };
  function deal(forceLevel) {
    cancelAuto();
    const task = tracker.$task.get();
    const n = forceLevel || (task.busy ? taskLevel || levelForTask(task) : freeLevel);
    const hc = $handicap.get(), options = { aspect: game.aspect(), seed: Math.random() * 2147483647 | 0, handicap: hc };
    game.deal(boardSpec(n, options), { level: n, lives: livesFor(n, hc), handicap: hc, mode: task.busy ? "task" : "free" }, dealBoard(n, options));
  }
  function queueNext() {
    cancelAuto();
    if (!tracker.$task.get().busy) return;
    $auto.set(Date.now() + 4e3);
    stopAuto = ctx.setTimeout(() => {
      stopAuto = null;
      $auto.set(0);
      if (game.status === "won") deal();
    }, 4e3);
  }
  let reported = false;
  const report = (where, error) => {
    const detail = { where, message: String(error?.message || error), stack: String(error?.stack || "").slice(0, 1500), version: VERSION, at: Date.now() };
    try {
      console.error("[hermes-arrow]", where, error);
    } catch {
    }
    store("lastError", detail);
    if (reported) return;
    reported = true;
    try {
      host.notify?.({ kind: "warning", title: "Hermes Arrow", message: `The game hit an error (${where}): ${detail.message}. Your chat is not affected.` });
    } catch {
    }
  };
  const tracker = createTracker({
    onError: report,
    atom,
    storage: { get: stored, set: store },
    busyBySession: host.state.busyBySession,
    onEvent: (type, fn) => ctx.onEvent(type, fn),
    setInterval: (fn, ms) => ctx.setInterval(fn, ms),
    // A new task replaces a board nobody has started; a board in progress is left alone.
    onStart: () => {
      try {
        taskLevel = 0;
        if (game.status !== "play" || !game.touched) deal();
      } catch (error) {
        report("deal", error);
      }
    }
  });
  let doneAt = 0;
  const stopDone = tracker.$done.subscribe((done) => {
    try {
      if (!done || done.at === doneAt) return;
      doneAt = done.at;
      if (done.duration >= 2 && (onGame() || $modal.get())) sound.play("agentDone");
    } catch (error) {
      report("done", error);
    }
  });
  const restart = () => {
    game.reset();
    sound.play("deal");
  };
  const setFreeLevel = (n) => {
    freeLevel = Math.max(1, Math.min(MAX_LEVEL, n));
    store("freeLevel", freeLevel);
    deal(freeLevel);
  };
  const setLevel = (n) => {
    const next = Math.max(1, Math.min(MAX_LEVEL, n));
    if (!tracker.$task.get().busy) return setFreeLevel(next);
    taskLevel = next;
    deal(next);
  };
  const setHandicap = (v) => {
    const next = handicap(v);
    $handicap.set(next);
    store("handicap", next);
    if (game.status === "play" && !game.touched) deal(game.meta?.level);
  };
  const open = () => {
    if (!onGame()) $modal.set(true);
  };
  const close = () => $modal.set(false);
  const setFade = (v) => {
    const next = Math.max(0, Math.min(MAX_FADE, Math.round(v * 20) / 20));
    $fade.set(next);
    store("fade", next);
  };
  const setOffer = (on) => {
    $offer.set(!!on);
    store("offer", !!on);
  };
  const toggleSound = () => {
    const on = !$sound.get();
    $sound.set(on);
    store("sound", on);
    if (on) sound.play("move", 0.5);
  };
  let lastBlip = 0;
  const setVolume = (v) => {
    const next = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
    $volume.set(next);
    store("volume", next);
    if (!$sound.get()) {
      $sound.set(true);
      store("sound", true);
    }
    if (Date.now() - lastBlip > 110) {
      lastBlip = Date.now();
      sound.play("move", 0.5);
    }
  };
  const back = () => {
    tracker.dismiss();
    if ($modal.get()) return close();
    host.navigate(returnTo && returnTo.split("?")[0] !== ROUTE ? returnTo : "/");
  };
  const S = {
    page: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, outline: "none", userSelect: "none", WebkitUserSelect: "none", color: "var(--ui-text-primary)" },
    bar: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 12px", padding: "8px 12px", borderBottom: "1px solid var(--ui-stroke-tertiary)", fontSize: "0.8125rem", lineHeight: 1.2 },
    range: { width: "100%", height: 16, margin: 0, accentColor: "var(--ui-accent)", cursor: "pointer" },
    settings: { width: 330, padding: 12, display: "grid", gap: 12, fontSize: "0.8125rem", color: "var(--ui-text-primary)" },
    setting: { display: "grid", gridTemplateColumns: "88px 1fr 84px", alignItems: "center", gap: 8 },
    hidden: { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" },
    grow: { flex: "1 1 0", minWidth: 0 },
    muted: { color: "var(--ui-text-tertiary)" },
    faint: { color: "var(--ui-text-quaternary)", fontSize: "0.6875rem" },
    num: { fontVariantNumeric: "tabular-nums" },
    chip: { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px", borderRadius: 3, fontSize: "0.6875rem", fontWeight: 600, background: "var(--ui-bg-quaternary)" },
    stage: { position: "relative", flex: "1 1 0", minHeight: 0, overflow: "hidden", touchAction: "none" },
    canvas: { position: "absolute", inset: 0, display: "block", touchAction: "none", cursor: "pointer" },
    veil: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, pointerEvents: "none" },
    card: {
      pointerEvents: "auto",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      alignItems: "center",
      textAlign: "center",
      padding: "18px 22px",
      minWidth: 220,
      maxWidth: 320,
      borderRadius: 5,
      background: "var(--ui-bg-elevated)",
      border: "1px solid var(--ui-stroke-secondary)",
      boxShadow: "0 8px 30px color-mix(in srgb, var(--ui-base, transparent) 55%, transparent)"
    },
    title: { fontSize: "1.25rem", fontWeight: 650, letterSpacing: "-0.01em" },
    row: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" },
    done: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 12px",
      fontSize: "0.8125rem",
      fontWeight: 600,
      background: "color-mix(in srgb, var(--ui-green) 20%, transparent)",
      borderLeft: "3px solid var(--ui-green)"
    }
  };
  function Lives({ lives, max }) {
    const low = lives <= 1;
    return /* @__PURE__ */ jsx(Tip, { label: `${lives} of ${max} lives. Harder boards start with more.`, children: /* @__PURE__ */ jsx("span", { style: { display: "inline-flex", gap: 3 }, "aria-label": `${lives} of ${max} lives`, children: Array.from({ length: max }, (_, i) => /* @__PURE__ */ jsx("span", { style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      boxSizing: "border-box",
      background: i < lives ? low ? "var(--ui-red)" : "var(--ui-accent)" : "transparent",
      border: i < lives ? "none" : "1px solid var(--ui-stroke-secondary)"
    } }, i)) }) });
  }
  function Timer({ snap }) {
    const [, tick] = useState(0);
    const running = snap.status === "play" && snap.started;
    useEffect(() => {
      if (!running) return;
      const id = window.setInterval(() => tick((n) => n + 1), 250);
      return () => window.clearInterval(id);
    }, [running]);
    return /* @__PURE__ */ jsx("span", { style: { ...S.num, color: snap.started ? "var(--ui-text-primary)" : "var(--ui-text-quaternary)" }, "aria-label": "Board time", children: clock(snap.started ? game.seconds : 0) });
  }
  function Streak() {
    const stats2 = useValue($stats), run = liveStreak(stats2);
    if (run < 2) return null;
    return /* @__PURE__ */ jsx(Tip, { label: `${run} boards cleared in a row. Each adds 10% to your points. Ends on a jam or after 36 hours away.`, children: /* @__PURE__ */ jsxs("span", { style: { ...S.chip, color: "var(--ui-yellow)" }, children: [
      "\xD7",
      run,
      " streak"
    ] }) });
  }
  function AgentStatus({ boardLevel }) {
    const task = useValue(tracker.$task);
    if (!task.busy) return /* @__PURE__ */ jsx("span", { style: S.muted, children: "Agent idle" });
    return /* @__PURE__ */ jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }, children: [
      /* @__PURE__ */ jsx("span", { style: { width: 7, height: 7, borderRadius: 7, background: "var(--ui-accent)", flex: "none" } }),
      /* @__PURE__ */ jsxs("span", { style: { fontWeight: 600, ...S.num }, children: [
        "Working ",
        clock(task.elapsed)
      ] }),
      task.tools > 0 && /* @__PURE__ */ jsxs("span", { style: { ...S.muted, ...S.num }, children: [
        task.tools,
        " tool",
        task.tools === 1 ? "" : "s"
      ] }),
      task.count > 1 && /* @__PURE__ */ jsxs("span", { style: S.muted, children: [
        "+",
        task.count - 1,
        " more"
      ] }),
      task.level > boardLevel && /* @__PURE__ */ jsx(Tip, { label: "The task is running long: your next board is bigger", children: /* @__PURE__ */ jsxs("span", { style: S.chip, children: [
        "next L",
        task.level
      ] }) })
    ] });
  }
  function DoneBanner() {
    const done = useValue(tracker.$done);
    if (!done || done.duration < 2) return null;
    return /* @__PURE__ */ jsxs("div", { style: S.done, role: "status", children: [
      /* @__PURE__ */ jsxs("span", { style: S.grow, children: [
        "Hermes finished ",
        /* @__PURE__ */ jsxs("span", { style: { ...S.num, fontWeight: 500 }, children: [
          "in ",
          clock(done.duration)
        ] }),
        done.still > 0 && /* @__PURE__ */ jsxs("span", { style: { ...S.muted, fontWeight: 400 }, children: [
          " \xB7 ",
          done.still,
          " still running"
        ] })
      ] }),
      /* @__PURE__ */ jsx(Button, { size: "sm", onClick: back, children: "Back to chat" }),
      /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", "aria-label": "Dismiss", onClick: () => tracker.dismiss(), children: "\u2715" })
    ] });
  }
  function LevelPicker({ value, compact = false, mode }) {
    const variant = compact ? "ghost" : "outline";
    const label = /* @__PURE__ */ jsxs("span", { style: { minWidth: compact ? 0 : 96, ...S.num, ...compact ? { ...S.chip, padding: "2px 6px" } : null }, children: [
      "L",
      value,
      " \xB7 ",
      level(value).name
    ] });
    return /* @__PURE__ */ jsxs("span", { style: { ...S.row, gap: compact ? 2 : 6, flexWrap: "nowrap" }, children: [
      /* @__PURE__ */ jsx(Button, { size: "sm", variant, "aria-label": "Lower level", disabled: value <= 1, onClick: () => setLevel(value - 1), children: "\u2212" }),
      compact ? /* @__PURE__ */ jsx(Tip, { label: `${mode === "task" ? "Sized to the task Hermes is working on" : "Free play"}. \u2212 and + deal a new board at another level.`, children: label }) : label,
      /* @__PURE__ */ jsx(Button, { size: "sm", variant, "aria-label": "Higher level", disabled: value >= MAX_LEVEL, onClick: () => setLevel(value + 1), children: "+" })
    ] });
  }
  function Overlay({ snap }) {
    const task = useValue(tracker.$task), auto = useValue($auto), result = useValue($result);
    const [, tick] = useState(0);
    useEffect(() => {
      if (!auto) return;
      const id = window.setInterval(() => tick((n) => n + 1), 250);
      return () => window.clearInterval(id);
    }, [auto]);
    if (snap.status === "won") {
      const next = task.busy ? taskLevel || levelForTask(task) : freeLevel;
      return /* @__PURE__ */ jsx("div", { style: S.veil, children: /* @__PURE__ */ jsxs("div", { style: S.card, role: "dialog", "aria-label": "Board cleared", children: [
        /* @__PURE__ */ jsx("div", { style: { ...S.faint, textTransform: "uppercase", letterSpacing: "0.08em" }, children: "Cleared" }),
        /* @__PURE__ */ jsxs("div", { style: { ...S.title, ...S.num, fontSize: "1.75rem", lineHeight: 1 }, children: [
          "+",
          fmt(result?.points || 0)
        ] }),
        /* @__PURE__ */ jsxs("div", { style: { ...S.muted, ...S.num }, children: [
          snap.total,
          " arrows \xB7 ",
          clock(snap.seconds),
          " \xB7 ",
          snap.lives,
          "/",
          snap.maxLives,
          " lives"
        ] }),
        result?.points > 0 && /* @__PURE__ */ jsxs("div", { style: { ...S.faint, ...S.num }, children: [
          "L",
          snap.level,
          " \xD7",
          result.difficulty.toFixed(2),
          " \xB7 time \xD7",
          result.time.toFixed(2),
          " \xB7 lives \xD7",
          result.life.toFixed(1),
          result.streak > 1 ? ` \xB7 streak ${result.streak} \xD7${result.run.toFixed(1)}` : "",
          result.hints > 0 ? ` \xB7 ${result.hints} hint${result.hints === 1 ? "" : "s"} \xD7${result.hint.toFixed(2)}` : "",
          result.handicap ? ` \xB7 ${HANDICAP_NAMES[result.handicap].toLowerCase()} \xD7${result.odds.toFixed(2)}` : ""
        ] }),
        task.busy ? /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(LevelPicker, { value: next }),
          /* @__PURE__ */ jsxs(Button, { onClick: () => deal(), children: [
            "Next board \xB7 L",
            next,
            auto ? ` (${Math.max(1, Math.ceil((auto - Date.now()) / 1e3))})` : ""
          ] })
        ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(LevelPicker, { value: freeLevel }),
          /* @__PURE__ */ jsx(Button, { onClick: () => deal(freeLevel), children: "Play again" })
        ] }),
        /* @__PURE__ */ jsxs("div", { style: { ...S.faint, ...S.num }, children: [
          fmt(result?.total ?? stats.points),
          " points \xB7 ",
          stats.boards,
          " boards all-time"
        ] })
      ] }) });
    }
    if (snap.status === "jam") {
      return /* @__PURE__ */ jsx("div", { style: S.veil, children: /* @__PURE__ */ jsxs("div", { style: { ...S.card, borderColor: "var(--ui-red)" }, role: "dialog", "aria-label": "Out of lives", children: [
        /* @__PURE__ */ jsx("div", { style: { ...S.title, color: "var(--ui-red)" }, children: "Jammed" }),
        /* @__PURE__ */ jsxs("div", { style: S.muted, children: [
          snap.left,
          " of ",
          snap.total,
          " arrows left"
        ] }),
        result?.lostStreak > 1 && /* @__PURE__ */ jsxs("div", { style: { ...S.chip, color: "var(--ui-yellow)" }, children: [
          "\xD7",
          result.lostStreak,
          " streak ended"
        ] }),
        /* @__PURE__ */ jsx(LevelPicker, { value: snap.level }),
        /* @__PURE__ */ jsxs("div", { style: S.row, children: [
          /* @__PURE__ */ jsx(Button, { onClick: () => restart(), children: "Retry board" }),
          /* @__PURE__ */ jsx(Button, { variant: "outline", onClick: () => deal(snap.level), children: "New board" })
        ] })
      ] }) });
    }
    return null;
  }
  function Settings({ modal }) {
    const volume = useValue($volume), fade = useValue($fade), offer = useValue($offer), hc = useValue($handicap);
    return /* @__PURE__ */ jsxs(Popover, { children: [
      /* @__PURE__ */ jsx(PopoverTrigger, { asChild: true, children: /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", "aria-label": "Settings", children: "\u2699" }) }),
      /* @__PURE__ */ jsxs(PopoverContent, { align: "end", style: S.settings, onKeyDown: (e) => e.stopPropagation(), children: [
        /* @__PURE__ */ jsxs("label", { style: S.setting, children: [
          /* @__PURE__ */ jsx("span", { children: "Volume" }),
          /* @__PURE__ */ jsx("input", { type: "range", min: "0", max: "100", step: "5", value: Math.round(volume * 100), "aria-label": "Volume", onChange: (e) => setVolume(e.target.value / 100), style: S.range }),
          /* @__PURE__ */ jsxs("span", { style: { ...S.num, ...S.muted, textAlign: "right" }, children: [
            Math.round(volume * 100),
            "%"
          ] })
        ] }),
        /* @__PURE__ */ jsxs("label", { style: S.setting, children: [
          /* @__PURE__ */ jsx("span", { children: "Difficulty" }),
          /* @__PURE__ */ jsx("input", { type: "range", min: "-2", max: "2", step: "1", value: hc, "aria-label": "Difficulty handicap", onChange: (e) => setHandicap(e.target.value), style: S.range }),
          /* @__PURE__ */ jsx("span", { style: { ...S.muted, textAlign: "right" }, children: HANDICAP_NAMES[hc] })
        ] }),
        /* @__PURE__ */ jsx("div", { style: { ...S.faint, marginTop: -6 }, children: hc ? `Every level's boards are ${hc > 0 ? "harder" : "easier"}: ${hc > 0 ? "fewer" : "more"} arrows free to move, ${Math.abs(hc)} ${hc > 0 ? "fewer" : "more"} ${Math.abs(hc) === 1 ? "life" : "lives"}, points \xD7${handicapFactor(hc).toFixed(2)}.` : "Shifts how hard each level is without changing its size." }),
        modal && /* @__PURE__ */ jsxs("label", { style: S.setting, children: [
          /* @__PURE__ */ jsx("span", { children: "Transparency" }),
          /* @__PURE__ */ jsx("input", { type: "range", min: "0", max: MAX_FADE * 100, step: "5", value: Math.round(fade * 100), "aria-label": "Transparency", onChange: (e) => setFade(e.target.value / 100), style: S.range }),
          /* @__PURE__ */ jsxs("span", { style: { ...S.num, ...S.muted, textAlign: "right" }, children: [
            Math.round(fade * 100),
            "%"
          ] })
        ] }),
        /* @__PURE__ */ jsxs("label", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }, children: [
          /* @__PURE__ */ jsx("span", { children: "Offer a game when I send a prompt" }),
          /* @__PURE__ */ jsx(Switch, { checked: offer, onCheckedChange: setOffer, "aria-label": "Offer a game when I send a prompt" })
        ] })
      ] })
    ] });
  }
  function Page({ modal = false }) {
    const canvas = useRef(null), root = useRef(null);
    const snap = useValue($snap), task = useValue(tracker.$task), soundOn = useValue($sound), volume = useValue($volume);
    const hintCost = Math.round(nextHintCost(snap.hints || 0) * 100), fade = useValue($fade);
    const barStyle = modal && fade > 0 ? { ...S.bar, background: "color-mix(in srgb, var(--ui-chat-bubble-background, var(--ui-bg-elevated)) 50%, transparent)" } : S.bar;
    useEffect(() => {
      colors = palette(canvas.current);
      game.attach(canvas.current);
      if (game.status === "empty" || game.status === "play" && !game.touched) deal();
      root.current?.focus({ preventScroll: true });
      return () => {
        game.detach();
        colors = () => ({});
      };
    }, []);
    const key = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "h") game.hint();
      else if (k === "r") restart();
      else if (k === "f" || k === "0") game.fit();
      else if (k === "m") toggleSound();
      else if (k === "[" || k === "-") setVolume(volume - 0.1);
      else if (k === "]" || k === "=" || k === "+") setVolume(volume + 0.1);
      else if (k === "n" && !task.busy) deal(freeLevel);
      else return;
      e.preventDefault();
    };
    const playing = snap.status === "play";
    return /* @__PURE__ */ jsxs("div", { ref: root, style: S.page, tabIndex: -1, onKeyDown: key, "data-hermes-arrow": VERSION, children: [
      /* @__PURE__ */ jsx(DoneBanner, {}),
      /* @__PURE__ */ jsxs("div", { style: barStyle, "data-bar": "", children: [
        /* @__PURE__ */ jsx(LevelPicker, { value: snap.level || freeLevel, compact: true, mode: snap.mode }),
        snap.handicap !== 0 && snap.handicap != null && /* @__PURE__ */ jsx(Tip, { label: "Difficulty handicap, set under \u2699. It changes how hard each level's boards are, and what they pay.", children: /* @__PURE__ */ jsx("span", { style: S.chip, children: HANDICAP_NAMES[snap.handicap] }) }),
        /* @__PURE__ */ jsxs("span", { style: { ...S.num, fontWeight: 600 }, children: [
          snap.left ?? 0,
          /* @__PURE__ */ jsx("span", { style: { ...S.muted, fontWeight: 400 }, children: " left" })
        ] }),
        /* @__PURE__ */ jsx(Lives, { lives: snap.lives ?? 3, max: snap.maxLives ?? 3 }),
        /* @__PURE__ */ jsx(Timer, { snap }),
        /* @__PURE__ */ jsx(Streak, {}),
        /* @__PURE__ */ jsx("span", { style: { ...S.grow, display: "flex", justifyContent: "center" }, children: /* @__PURE__ */ jsx(AgentStatus, { boardLevel: snap.level || 0 }) }),
        /* @__PURE__ */ jsxs("span", { style: S.row, children: [
          snap.zoomed && /* @__PURE__ */ jsx(Tip, { label: "Zoom back out (F). Double-click the board to step through zoom levels.", children: /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", onClick: () => game.fit(), children: "Fit" }) }),
          /* @__PURE__ */ jsx(Tip, { label: soundOn ? "Sound on (M)" : "Sound off (M)", children: /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", "aria-label": soundOn ? "Mute sound" : "Unmute sound", "aria-pressed": soundOn, onClick: toggleSound, style: { opacity: soundOn ? 1 : 0.5 }, children: soundOn ? "\u266A" : "\u266A\u0338" }) }),
          /* @__PURE__ */ jsx(Tip, { label: hintCost ? `Show an arrow that can leave (H). Takes ${hintCost}% off this board's points, and the next one costs more.` : "Show an arrow that can leave (H). Hints have already taken all they can from this board.", children: /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", disabled: !playing, "aria-label": "Hint", onClick: () => game.hint(), children: [
            "Hint",
            hintCost > 0 && /* @__PURE__ */ jsxs("span", { style: { ...S.num, marginLeft: 5, color: "var(--ui-yellow)" }, children: [
              "\u2212",
              hintCost,
              "%"
            ] })
          ] }) }),
          /* @__PURE__ */ jsx(Tip, { label: "Start this board over (R)", children: /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", disabled: !snap.total, onClick: () => restart(), children: "Restart" }) }),
          !task.busy && playing && /* @__PURE__ */ jsx(Tip, { label: "Deal a different board (N)", children: /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", onClick: () => deal(freeLevel), children: "New" }) }),
          /* @__PURE__ */ jsx(Settings, { modal }),
          modal && /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", "aria-label": "Close game", onClick: close, children: "\u2715" })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: S.stage, children: [
        /* @__PURE__ */ jsx("canvas", { ref: canvas, style: S.canvas, "aria-label": `Arrow puzzle, ${snap.left ?? 0} arrows left. Tap an arrow whose path to the edge is clear. Hold an arrow to preview its path. Double-click to zoom.` }),
        /* @__PURE__ */ jsx(Overlay, { snap })
      ] })
    ] });
  }
  function Modal() {
    const isOpen = useValue($modal), fade = useValue($fade);
    useEffect(() => {
      const fn = () => {
        if (onGame()) close();
      };
      window.addEventListener("hashchange", fn);
      return () => window.removeEventListener("hashchange", fn);
    }, []);
    if (!isOpen) return null;
    const solid = Math.round((1 - fade) * 100);
    return /* @__PURE__ */ jsx(Dialog, { open: true, onOpenChange: (next) => {
      if (!next) close();
    }, children: /* @__PURE__ */ jsxs(
      DialogContent,
      {
        showCloseButton: false,
        blurBackdrop: fade === 0,
        overlayClassName: fade > 0 ? "bg-transparent" : void 0,
        "aria-describedby": void 0,
        "aria-label": "Hermes Arrow",
        "data-hermes-arrow-modal": "",
        onOpenAutoFocus: (e) => e.preventDefault(),
        style: { width: MODAL_W, maxWidth: "none", height: MODAL_H, maxHeight: "none", background: `color-mix(in srgb, var(--ui-chat-bubble-background, var(--ui-bg-elevated)) ${solid}%, transparent)` },
        children: [
          /* @__PURE__ */ jsx(DialogTitle, { style: S.hidden, children: "Hermes Arrow" }),
          /* @__PURE__ */ jsx("div", { style: { margin: "-1rem", height: `calc(${MODAL_H} - 2px)`, minHeight: 0, borderRadius: "inherit", overflow: "hidden" }, children: /* @__PURE__ */ jsx(Page, { modal: true }) })
        ]
      }
    ) });
  }
  function Chip() {
    const task = useValue(tracker.$task), isOpen = useValue($modal);
    const [here, setHere] = useState(onGame());
    useEffect(() => {
      const fn = () => setHere(onGame());
      window.addEventListener("hashchange", fn);
      return () => window.removeEventListener("hashchange", fn);
    }, []);
    return /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Modal, {}),
      task.busy && task.elapsed >= 4 && !here && !isOpen && /* @__PURE__ */ jsx(Tip, { label: `Hermes Arrow: play a level-${task.level} board while this runs`, children: /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          onClick: open,
          className: "inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] tabular-nums transition-colors text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground",
          style: { display: "inline-flex", alignItems: "center", gap: 4, height: "100%", fontVariantNumeric: "tabular-nums" },
          children: [
            /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "\u27A4" }),
            /* @__PURE__ */ jsxs("span", { children: [
              "Play \xB7 L",
              task.level
            ] })
          ]
        }
      ) })
    ] });
  }
  const offers = ({ busy } = {}) => {
    try {
      return busy && $offer.get() && !onGame() ? [{ id: `${ID}.play`, label: "Play Arrow", icon: "game", run: () => {
        try {
          open();
        } catch (error) {
          report("offer", error);
        }
      } }] : [];
    } catch (error) {
      report("offers", error);
      return [];
    }
  };
  function OfferLink() {
    const task = useValue(tracker.$task), offer = useValue($offer), isOpen = useValue($modal);
    if (!task.busy || !offer || isOpen || onGame()) return null;
    return /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", onClick: open, children: "\u27A4 Play Arrow" });
  }
  return { $handicap, setHandicap, report, Page, Chip, offers, OfferLink, close, $modal, $fade, $offer, tracker, game, open, deal, sound, stopDone, stats: () => stats, $result };
}
var plugin_default = {
  id: ID,
  name: "Hermes Arrow",
  description: "An arrow-escape puzzle for the wait. Boards scale with how long and hard your agent is working.",
  register(ctx) {
    const app = create(ctx);
    const dispose = () => {
      try {
        app.stopDone?.();
        app.tracker.dispose();
        app.game.detach();
        app.sound.dispose();
      } catch {
      }
    };
    ctx.onDispose(dispose);
    try {
      this.contribute(ctx, app);
    } catch (error) {
      dispose();
      throw error;
    }
    globalThis.__hermesArrowDebug?.(app);
  },
  contribute(ctx, app) {
    ctx.registerMany([
      { id: "page", area: ROUTES_AREA, data: { path: ROUTE }, render: () => /* @__PURE__ */ jsx(app.Page, {}) },
      { id: "nav", area: SIDEBAR_NAV_AREA, order: 90, data: { path: ROUTE, label: "Arrow", codicon: "arrow-right" } },
      { id: "chip", area: STATUSBAR_AREAS.right, order: 85, render: () => /* @__PURE__ */ jsx(app.Chip, {}) },
      COMPOSER_AREAS.microActions ? { id: "offer", area: COMPOSER_AREAS.microActions, data: { resolve: app.offers } } : { id: "offer", area: COMPOSER_AREAS.underside, render: () => /* @__PURE__ */ jsx(app.OfferLink, {}) },
      { id: "open", area: PALETTE_AREA, data: { id: `${ID}.open`, label: "Hermes Arrow: Play", keywords: ["game", "arrow", "puzzle", "wait", "play"], run: app.open } },
      // Read-only: the draft passes through untouched. Its wording seeds the difficulty estimate.
      { id: "prompt", area: COMPOSER_AREAS.middleware, data: { handler: (draft) => {
        try {
          app.tracker.sawPrompt(draft);
        } catch {
        }
        return draft;
      } } }
    ]);
  }
};
export {
  plugin_default as default
};
