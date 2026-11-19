// The playable board: rules, canvas drawing, pointer input. No host imports, so it runs in any page.
// One Game outlives the canvas it draws on: attach() when the page mounts, detach() when it leaves.

import { generate, makeGrid, probe, headDir, buildMask } from './core.js';

const HOLD_MS = 360, DOUBLE_MS = 300, ZOOMS = [1, 1.75, 3];
const now = () => performance.now();
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Game {
  constructor({ onChange, onEvent, colors } = {}) {
    this.onChange = onChange || (() => {});
    this.onEvent = onEvent || (() => {});
    this.colors = colors || (() => ({}));
    this.board = null; this.arrows = []; this.grid = null; this.mask = null;
    this.maxLives = 3; this.lives = 3; this.mistakes = 0; this.cleared = 0; this.total = 0; this.moves = 0;
    this.status = 'empty'; // empty | play | won | jam
    this.startedAt = 0; this.endedAt = 0;
    this.flying = []; this.hintId = -1; this.bumpUntil = new Map();
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.canvas = null; this.frame = 0; this.pointers = new Map(); this.cleanup = [];
    this.preview = null; this.lastTap = null; this.pendingMiss = null;
  }

  // ---- rules -------------------------------------------------------------------------------

  /** `board` may be supplied already built (it must match `spec`); otherwise it is generated. */
  deal(spec, meta = {}, board = null) {
    this.spec = spec; this.meta = meta; this.maxLives = meta.lives || 3;
    this.board = board || generate(spec);
    this.mask = buildMask(spec.w, spec.h, spec.shape);
    this.reset();
    this.onEvent('deal');
  }

  /** Put the same board back, full lives. */
  reset() {
    if (!this.board) return;
    const { w, h } = this.board;
    this.arrows = this.board.arrows.map(a => ({ id: a.id, cells: a.cells }));
    this.grid = makeGrid(w, h, this.arrows);
    this.total = this.arrows.length; this.cleared = 0; this.dots = 0; this.mistakes = 0; this.moves = 0; this.hints = 0;
    this.lives = this.maxLives; this.status = 'play'; this.startedAt = 0; this.endedAt = 0; if (this.canvas) this.hiddenAt = 0;
    this.flying = []; this.hintId = -1; this.bumpUntil.clear();
    this.preview = null; this.lastTap = null; this.dropMiss();
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.changed();
  }

  get left() { return this.arrows.length; }
  get touched() { return this.moves > 0; }
  // The clock stops while the board is off screen (the modal closed to read the chat).
  get seconds() { return this.startedAt ? ((this.endedAt || this.hiddenAt || Date.now()) - this.startedAt) / 1000 : 0; }

  snapshot() {
    return { status: this.status, left: this.left, total: this.total, cleared: this.cleared, dots: this.dots || 0, lives: this.lives, maxLives: this.maxLives, started: !!this.startedAt,
      mistakes: this.mistakes, hints: this.hints || 0, seconds: this.seconds, level: this.meta?.level || 0, handicap: this.meta?.handicap || 0, mode: this.meta?.mode || 'free',
      zoomed: this.zoom > 1.01, w: this.board?.w || 0, h: this.board?.h || 0 };
  }

  changed() { if (this.canvas) this.canvas.style.cursor = this.zoom > 1.01 ? 'grab' : 'pointer'; this.onChange(this.snapshot()); this.draw(); }

  isFree(arrow) { return probe(this.board.w, this.board.h, this.grid, arrow.cells).blocker === -1; }
  dropMiss() { if (this.pendingMiss) { clearTimeout(this.pendingMiss.timer); this.pendingMiss = null; } }
  // A blocked tap waits a beat before it costs a life, so a double-click to zoom never does.
  flushMiss() { const m = this.pendingMiss; if (m) { this.dropMiss(); this.tap(m.id); } }

  tap(id) {
    if (this.status !== 'play') return;
    const arrow = this.arrows.find(a => a.id === id);
    if (!arrow) return;
    const { w, h } = this.board, hit = probe(w, h, this.grid, arrow.cells);
    if (!this.startedAt) this.startedAt = Date.now();
    this.moves++;
    if (this.hintId === id) this.hintId = -1;
    if (hit.blocker === -1) {
      for (const [x, y] of arrow.cells) this.grid[y * w + x] = -1;
      this.arrows = this.arrows.filter(a => a !== arrow);
      this.flying.push({ kind: 'exit', cells: arrow.cells, t0: now(), reach: this.exitReach(arrow.cells) });
      this.cleared++; this.dots += arrow.cells.length;
      if (!this.arrows.length) { this.status = 'won'; this.endedAt = Date.now(); this.hintId = -1; }
      this.onEvent(this.status === 'won' ? 'won' : 'exit');
    } else {
      this.mistakes++; this.lives--;
      arrow.bump = { t0: now(), free: hit.free };
      this.bumpUntil.set(hit.blocker, now() + 420);
      if (this.lives <= 0) { this.status = 'jam'; this.endedAt = Date.now(); }
      this.onEvent(this.status === 'jam' ? 'jam' : 'blocked');
    }
    this.changed();
  }

  /** Point at an arrow that can leave right now. */
  hint() {
    if (this.status !== 'play') return;
    const { w, h } = this.board;
    const free = this.arrows.find(a => probe(w, h, this.grid, a.cells).blocker === -1);
    if (!free) return;
    // Asking again while the same arrow is still marked is not a second hint.
    if (this.hintId !== free.id) this.hints++;
    this.hintId = free.id;
    this.reveal(free);
    this.onEvent('hint');
    this.changed();
  }

  // ---- view --------------------------------------------------------------------------------

  attach(canvas) {
    this.detach();
    if (this.hiddenAt && this.startedAt && !this.endedAt) this.startedAt += Date.now() - this.hiddenAt;
    this.hiddenAt = 0;
    this.canvas = canvas;
    const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); this.cleanup.push(() => target.removeEventListener(type, fn, opts)); };
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas.parentElement || canvas);
    this.cleanup.push(() => observer.disconnect());
    on(canvas, 'pointerdown', e => this.pointerDown(e));
    on(canvas, 'pointermove', e => this.pointerMove(e));
    on(canvas, 'pointerup', e => this.pointerUp(e));
    on(canvas, 'pointercancel', e => this.pointerUp(e, true));
    on(canvas, 'contextmenu', e => e.preventDefault());
    on(canvas, 'wheel', e => this.wheel(e), { passive: false });
    this.resize();
  }

  detach() {
    for (const fn of this.cleanup.splice(0)) fn();
    if (this.frame) cancelAnimationFrame(this.frame);
    for (const p of this.pointers.values()) clearTimeout(p.hold);
    this.flushMiss();
    if (this.canvas && !this.hiddenAt) this.hiddenAt = Date.now();
    this.frame = 0; this.canvas = null; this.pointers.clear(); this.preview = null;
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
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) { c.width = Math.round(width * dpr); c.height = Math.round(height * dpr); }
    c.style.width = width + 'px'; c.style.height = height + 'px';
    this.viewW = width; this.viewH = height; this.dpr = dpr;
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

  maxZoom() { return this.board ? Math.max(ZOOMS[ZOOMS.length - 1], 46 / this.layout().fit) : 1; }

  /** Double-click: step through fit → closer → closest → fit, keeping the clicked spot in place. */
  cycleZoom(sx, sy) {
    const next = ZOOMS.find(z => z > this.zoom + 0.05);
    if (!next) this.fit(); else this.zoomAt(next / this.zoom, sx, sy);
    this.onEvent('zoom', { step: next ? ZOOMS.indexOf(next) / (ZOOMS.length - 1) : 0 });
  }

  clampPan() {
    if (!this.board || !this.viewW) return;
    const { cell } = this.layout(), { w, h } = this.board;
    const mx = Math.max(0, (w * cell - this.viewW) / 2 + 24), my = Math.max(0, (h * cell - this.viewH) / 2 + 24);
    this.panX = clamp(this.panX, -mx, mx); this.panY = clamp(this.panY, -my, my);
  }

  fit() { this.zoom = 1; this.panX = 0; this.panY = 0; this.changed(); }

  zoomAt(factor, sx, sy) {
    if (!this.board) return;
    const before = this.layout(), next = clamp(this.zoom * factor, 1, this.maxZoom());
    if (next === this.zoom) return;
    const bx = (sx - before.ox) / before.cell, by = (sy - before.oy) / before.cell;
    this.zoom = next; this.panX = 0; this.panY = 0;
    const after = this.layout();
    this.panX = sx - (after.ox + bx * after.cell); this.panY = sy - (after.oy + by * after.cell);
    this.clampPan();
    this.changed();
  }

  /** Scroll a hinted arrow into view when zoomed in. */
  reveal(arrow) {
    if (this.zoom <= 1.01 || !this.viewW) return;
    const { cell, ox, oy } = this.layout(), [x, y] = arrow.cells[arrow.cells.length - 1];
    const sx = ox + (x + 0.5) * cell, sy = oy + (y + 0.5) * cell, m = 48;
    if (sx < m || sy < m || sx > this.viewW - m || sy > this.viewH - m) { this.panX += this.viewW / 2 - sx; this.panY += this.viewH / 2 - sy; this.clampPan(); }
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
    if (!assist || id.best < 0 || this.isFree(this.arrows.find(a => a.id === id.best))) return id.best;
    const { fx, fy, cx, cy, at, cell } = id, margin = clamp(10 / cell, 0.2, 0.5);
    let alt = -1, altD = Infinity;
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
      const other = at(x, y);
      if (other < 0 || other === id.best) continue;
      // Distance to the cell's square (0 inside it), and to its centre for taps that hit no cell.
      const edge = Math.hypot(Math.max(x - fx, 0, fx - x - 1), Math.max(y - fy, 0, fy - y - 1));
      const centre = Math.hypot(x + 0.5 - fx, y + 0.5 - fy);
      const ok = id.direct ? edge <= margin : centre <= Math.min(id.reach, id.bestD + margin);
      const d = id.direct ? edge : centre;
      if (ok && d < altD && this.isFree(this.arrows.find(a => a.id === other))) { altD = d; alt = other; }
    }
    return alt >= 0 ? alt : id.best;
  }

  nearest(sx, sy) {
    if (!this.board) return { best: -1 };
    const { cell, ox, oy } = this.layout(), { w, h } = this.board;
    const fx = (sx - ox) / cell, fy = (sy - oy) / cell, cx = Math.floor(fx), cy = Math.floor(fy);
    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? this.grid[y * w + x] : -1);
    const found = { fx, fy, cx, cy, at, cell };
    if (at(cx, cy) >= 0) return { ...found, best: at(cx, cy), bestD: 0, direct: true };
    // Forgive a near miss: small cells are hard to hit, especially by finger.
    const reach = clamp(22 / cell, 0.6, 1.6);
    let best = -1, bestD = reach;
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
      const id = at(x, y);
      if (id < 0) continue;
      const d = Math.hypot(x + 0.5 - fx, y + 0.5 - fy);
      if (d < bestD) { bestD = d; best = id; }
    }
    return { ...found, best, bestD, reach, direct: false };
  }

  local(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  pointerDown(e) {
    if (e.button > 0) return;
    const [x, y] = this.local(e);
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = { x, y, x0: x, y0: y, moved: false, held: false };
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y); a.moved = b.moved = true;
      clearTimeout(a.hold); clearTimeout(b.hold);
      return;
    }
    // Hold still on an arrow to see where it would go. Nothing moves and nothing is lost.
    p.hold = setTimeout(() => {
      if (p.moved || this.status !== 'play' || this.pointers.size !== 1) return;
      const id = this.arrowAt(p.x0, p.y0);
      if (id < 0) return;
      p.held = true; this.preview = { id, until: Infinity };
      this.onEvent('preview', { clear: this.isFree(this.arrows.find(a => a.id === id)) }); this.draw();
    }, HOLD_MS);
  }

  pointerMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const [x, y] = this.local(e), dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch > 0 && d > 0) this.zoomAt(d / this.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this.pinch = d;
      return;
    }
    if (p.held) return;
    if (!p.moved && Math.hypot(x - p.x0, y - p.y0) > 7) { p.moved = true; clearTimeout(p.hold); }
    if (p.moved && this.zoom > 1.01) { this.canvas.style.cursor = 'grabbing'; this.panX += dx; this.panY += dy; this.clampPan(); this.draw(); }
  }

  pointerUp(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p) return;
    clearTimeout(p.hold);
    if (this.canvas) this.canvas.style.cursor = this.zoom > 1.01 ? 'grab' : 'pointer';
    if (p.held) { if (this.preview) this.preview.until = now() + 900; this.draw(); return; }
    if (p.moved || cancelled) return;
    const t = now(), last = this.lastTap, under = this.status === 'play' ? this.arrowAt(p.x, p.y, true) : -1;
    // A second click on the same spot zooms, unless the first one already sent an arrow off.
    if (last && !last.removed && last.id === under && t - last.t < DOUBLE_MS && Math.hypot(p.x - last.x, p.y - last.y) < 24) {
      this.dropMiss(); this.lastTap = null;
      this.cycleZoom(p.x, p.y);
      return;
    }
    this.flushMiss();
    const id = under, arrow = id >= 0 && this.arrows.find(a => a.id === id);
    let removed = false;
    if (arrow && this.isFree(arrow)) { this.tap(id); removed = true; }
    else if (arrow) this.pendingMiss = { id, timer: setTimeout(() => { this.pendingMiss = null; this.tap(id); }, DOUBLE_MS - 60) };
    this.lastTap = { t, x: p.x, y: p.y, id, removed };
  }

  wheel(e) {
    if (!this.board) return;
    e.preventDefault();
    const [x, y] = this.local(e);
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), x, y);
  }

  // ---- drawing -----------------------------------------------------------------------------

  draw() {
    if (!this.canvas || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  paint() {
    const c = this.canvas;
    if (!c || !this.viewW) return;
    const g = c.getContext('2d'), t = now(), colors = this.colors();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.viewW, this.viewH);
    if (!this.board) return;
    const { w, h } = this.board, { cell, ox, oy } = this.layout();
    const X = x => ox + (x + 0.5) * cell, Y = y => oy + (y + 0.5) * cell;
    let busy = false;

    // The silhouette, as faint dots, so cleared ground still shows the shape.
    if (cell >= 7) {
      g.fillStyle = colors.dot; g.globalAlpha = 0.5;
      const r = Math.max(0.6, cell * 0.045);
      g.beginPath();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (this.mask[y * w + x] && this.grid[y * w + x] < 0) { g.moveTo(X(x) + r, Y(y)); g.arc(X(x), Y(y), r, 0, 6.2832); }
      g.fill(); g.globalAlpha = 1;
    }

    const width = clamp(cell * 0.125, 1.3, 4.5);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const stroke = (points, color, alpha = 1, scale = 1) => {
      if (points.length < 2) return;
      g.globalAlpha = alpha; g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width * scale;
      g.beginPath(); g.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) g.lineTo(points[i][0], points[i][1]);
      g.stroke();
      const [ax, ay] = points[points.length - 2], [bx, by] = points[points.length - 1];
      const len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len;
      const tip = cell * 0.34, half = Math.max(width * 1.4, cell * 0.19) * scale;
      g.beginPath();
      g.moveTo(bx + ux * tip, by + uy * tip);
      g.lineTo(bx - uy * half, by + ux * half);
      g.lineTo(bx + uy * half, by - ux * half);
      g.closePath(); g.fill(); g.stroke();
      g.globalAlpha = 1;
    };
    const centres = cells => cells.map(([x, y]) => [X(x), Y(y)]);

    for (const a of this.arrows) {
      let color = colors.arrow, points = centres(a.cells), scale = 1;
      if (a.bump) {
        // Lunge at the blocker, then settle back.
        const k = (t - a.bump.t0) / 380;
        if (k >= 1) a.bump = null;
        else {
          busy = true; color = colors.bad;
          const reach = (a.bump.free + 0.3) * Math.sin(Math.PI * Math.min(1, k)) * (k < 0.5 ? 1 : 0.9);
          points = this.slide(a.cells, reach).map(([x, y]) => [X(x), Y(y)]);
        }
      }
      const flash = this.bumpUntil.get(a.id);
      if (flash) { if (flash > t) { busy = true; color = colors.bad; } else this.bumpUntil.delete(a.id); }
      if (a.id === this.hintId) { busy = true; color = colors.hint; scale = 1 + 0.25 * (0.5 + 0.5 * Math.sin(t / 160)); }
      stroke(points, color, 1, scale);
    }

    // Long-press preview: the route out, or the stretch up to whatever is in the way.
    const pv = this.preview, held = pv && this.arrows.find(a => a.id === pv.id);
    if (pv && (!held || pv.until <= t || this.status !== 'play')) this.preview = null;
    else if (held) {
      if (pv.until !== Infinity) busy = true;
      const hit = probe(w, h, this.grid, held.cells), clear = hit.blocker === -1;
      const [dx, dy] = headDir(held.cells), [hx, hy] = held.cells[held.cells.length - 1];
      const reach = clear ? Math.max(this.viewW, this.viewH) / cell : hit.free + 0.5;
      const fade = pv.until === Infinity ? 1 : clamp((pv.until - t) / 300, 0, 1), color = clear ? colors.go : colors.bad;
      const blocker = clear ? null : this.arrows.find(a => a.id === hit.blocker);
      if (blocker) stroke(centres(blocker.cells), colors.bad, fade);
      stroke(centres(held.cells), color, fade, 1.2);
      g.globalAlpha = fade * 0.9; g.strokeStyle = color; g.lineWidth = Math.max(1.2, width * 0.8);
      g.setLineDash([Math.max(3, cell * 0.22), Math.max(3, cell * 0.24)]);
      g.beginPath(); g.moveTo(X(hx + dx * 0.55), Y(hy + dy * 0.55)); g.lineTo(X(hx + dx * reach), Y(hy + dy * reach)); g.stroke();
      g.setLineDash([]);
      if (!clear) {
        // A bar across the path where it stops.
        const ex = X(hx + dx * reach), ey = Y(hy + dy * reach), half = cell * 0.3;
        g.lineWidth = Math.max(2, width * 1.3);
        g.beginPath(); g.moveTo(ex - dy * half, ey - dx * half); g.lineTo(ex + dy * half, ey + dx * half); g.stroke();
      }
      g.globalAlpha = 1;
    }

    for (const f of this.flying) {
      const s = (t - f.t0) / 1000, travelled = this.still ? f.reach + 1 : 7 * s + 46 * s * s;
      if (travelled > f.reach) { f.done = true; continue; }
      busy = true;
      stroke(this.slide(f.cells, travelled).map(([x, y]) => [X(x), Y(y)]), colors.go, clamp(1.15 - travelled / f.reach, 0.25, 1));
    }
    this.flying = this.flying.filter(f => !f.done);
    if (busy) this.draw();
  }

  // The arrow's body after sliding `d` cells forward along its own path, then straight on.
  slide(cells, d) {
    const [dx, dy] = headDir(cells), n = cells.length - 1, head = cells[n];
    const at = s => {
      if (s >= n) return [head[0] + dx * (s - n), head[1] + dy * (s - n)];
      const i = Math.floor(s), f = s - i, a = cells[i], b = cells[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    };
    const out = [at(d)];
    for (let i = Math.floor(d) + 1; i <= n; i++) out.push(cells[i]);
    if (d > 0) out.push(at(d + n));
    return out;
  }
}
