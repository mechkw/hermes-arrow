// Plays the built plugin in a real browser against the stub SDK. Run: npm run build -- --dev && npm run test:browser
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { extname, join, normalize } from 'node:path';

const root = new URL('../dev/', import.meta.url).pathname, out = new URL('./out/', import.meta.url).pathname, repo = new URL('..', import.meta.url).pathname;
await mkdir(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
    // /games/<id>/plugin.js serves a game plugin: the skill's templates, then forks built into dist/.
    const game = /^games\/([a-z0-9-]+)\/plugin\.js$/.exec(path);
    const body = game
      ? await readFile(join(repo, 'skills/hermes-arrow-games/templates', game[1], 'plugin.js')).catch(() => readFile(join(repo, 'dist/cartridges', game[1], 'plugin.js')))
      : await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const errors = [];
async function open(viewport, theme, query = '', disk = null) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500, deviceScaleFactor: viewport.width < 500 ? 3 : 1 });
  const page = await context.newPage();
  // Count synthesised notes instead of listening to them.
  await page.addInitScript(() => {
    window.notes = 0;
    const make = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { window.notes++; return make.call(this); };
    window.samples = 0;
    const source = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () { window.samples++; return source.call(this); };
  });
  if (disk) await page.addInitScript(d => { window.__disk = d; }, disk);
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url + query);
  if (theme) await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
  return page;
}
const snap = page => page.evaluate(() => window.arrow.game.snapshot());
const played = page => page.evaluate(() => [...window.arrow.sound.played]);
// Screen position of an arrow's head, and whether it can leave, straight from the live game.
const target = (page, wantFree) => page.evaluate(wantFree => {
  const g = window.arrow.game, { w, h } = g.board, { cell, ox, oy } = g.layout(), box = g.canvas.getBoundingClientRect();
  const ray = a => { const n = a.cells.length - 1, dx = a.cells[n][0] - a.cells[n - 1][0], dy = a.cells[n][1] - a.cells[n - 1][1];
    for (let x = a.cells[n][0] + dx, y = a.cells[n][1] + dy; x >= 0 && y >= 0 && x < w && y < h; x += dx, y += dy) if (g.grid[y * w + x] >= 0) return false; return true; };
  const a = g.arrows.find(a => ray(a) === wantFree);
  if (!a) return null;
  const [x, y] = a.cells[a.cells.length - 1];
  return { x: box.left + ox + (x + 0.5) * cell, y: box.top + oy + (y + 0.5) * cell };
}, wantFree);
async function clear(page) {
  for (let i = 0; i < 2000; i++) {
    const p = await target(page, true);
    if (!p) break;
    await page.mouse.click(p.x, p.y);
  }
}
const shot = (page, name) => page.screenshot({ path: join(out, name + '.png') });

try {
  // --- Free play: deal, clear by real clicks, lose lives, retry -------------------------------
  let page = await open({ width: 1180, height: 760 });
  await page.click('a:has-text("Arrow")');
  await page.waitForFunction(() => window.arrow?.game.status === 'play');
  let s = await snap(page);
  assert.equal(s.level, 3, 'free play starts at level 3');
  assert.equal(s.mode, 'free');
  await shot(page, '01-free-l3-dark');

  assert.deepEqual([s.lives, s.maxLives, s.started], [3, 3, false], 'level 3 has three lives and the timer waits');

  // Double-click steps through three zoom levels and back; it never costs a life, even on a blocked arrow.
  const zoom = () => page.evaluate(() => +window.arrow.game.zoom.toFixed(2));
  const blocked = await target(page, false);
  const seen = [];
  for (let i = 0; i < 3; i++) { await page.mouse.dblclick(blocked.x, blocked.y); await page.waitForTimeout(350); seen.push(await zoom()); }
  assert.deepEqual(seen, [1.75, 3, 1], 'double-click rotates fit → 1.75× → 3× → fit');
  s = await snap(page);
  assert.deepEqual([s.lives, s.started], [3, false], 'double-clicking a blocked arrow is free');
  await page.mouse.dblclick(30, 300);
  await page.waitForTimeout(350);
  assert.equal(await zoom(), 1.75, 'empty space zooms too');
  const pan = () => page.evaluate(() => [window.arrow.game.panX, window.arrow.game.panY].map(Math.round));
  const before = await pan();
  await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(520, 340, { steps: 6 }); await page.mouse.up();
  const after = await pan();
  assert.ok(after[0] < before[0] && after[1] < before[1], `dragging moves the zoomed board (${before} → ${after})`);
  assert.equal((await snap(page)).lives, 3, 'a drag is not a tap');
  await shot(page, '01b-zoomed');
  await page.keyboard.press('f');
  assert.equal(await zoom(), 1);

  // Long press shows where an arrow would go without moving it.
  const held = await target(page, false);
  await page.mouse.move(held.x, held.y); await page.mouse.down(); await page.waitForTimeout(520);
  assert.ok(await page.evaluate(() => window.arrow.game.preview?.id >= 0), 'holding an arrow previews its path');
  await shot(page, '01c-preview-blocked');
  await page.mouse.up();
  const free = await target(page, true);
  await page.mouse.move(free.x, free.y); await page.mouse.down(); await page.waitForTimeout(520);
  await shot(page, '01d-preview-clear');
  await page.mouse.up();
  await page.waitForTimeout(350);
  s = await snap(page);
  assert.deepEqual([s.lives, s.left, s.started], [3, s.total, false], 'a preview changes nothing');
  let cues = await played(page);
  assert.ok(await page.evaluate(() => window.arrow.sound.ready()), 'all six clips decoded');
  assert.ok(cues.includes('zoom') && cues.includes('previewBlocked') && cues.includes('previewClear'), `zoom and both previews have their own cue (${[...new Set(cues)]})`);
  assert.ok(!cues.includes('move') && !cues.includes('blocked'), `no move or miss cue yet (${cues})`);

  await page.mouse.click(blocked.x, blocked.y);
  await page.waitForTimeout(330);
  s = await snap(page);
  assert.equal(s.started, true, 'the timer starts with the first arrow tapped');
  assert.equal((await played(page)).at(-1), 'blocked', 'a blocked tap has its cue');
  assert.equal(s.lives, 2, 'a blocked tap costs a life');
  assert.equal(s.left, s.total, 'and removes nothing');
  await page.waitForTimeout(150);
  await shot(page, '02-blocked');

  await page.keyboard.press('h');
  assert.ok(await page.evaluate(() => window.arrow.game.hintId >= 0), 'H highlights a free arrow');
  await page.waitForTimeout(120);
  await shot(page, '03-hint');
  assert.equal((await played(page)).at(-1), 'hint', 'the hint has its cue');

  for (let i = 0; i < 2; i++) { const p = await target(page, false); await page.mouse.click(p.x, p.y); await page.waitForTimeout(450); }
  assert.equal((await snap(page)).status, 'jam', 'three misses jam the board');
  assert.deepEqual((await played(page)).slice(-2), ['lastLife', 'jam'], 'the miss that leaves one life sounds a warning, the last one the jam');
  await page.waitForSelector('text=Jammed');
  assert.equal(await page.evaluate(() => window.arrow.stats().streak), 0);
  await shot(page, '04-jammed');
  await page.click('text=Retry board');
  s = await snap(page);
  assert.deepEqual([s.status, s.lives, s.left], ['play', 3, s.total], 'retry restores the same board');

  assert.equal((await played(page)).at(-1), 'deal', 'a board dealt by a click has its cue');
  let notes = (await played(page)).length;
  const one = await target(page, true);
  await page.mouse.click(one.x, one.y);
  cues = await played(page);
  assert.deepEqual([cues.length - notes, cues.at(-1)], [1, 'move'], 'a leaving arrow makes one sound');
  await page.waitForTimeout(1100);
  assert.match(await page.textContent('[aria-label="Board time"]'), /^0:0[1-9]$/, 'the clock is running');
  await clear(page);
  s = await snap(page);
  assert.equal(s.status, 'won', 'every board can be cleared by clicking');
  await page.waitForSelector('text=Cleared');
  let result = await page.evaluate(() => window.arrow.$result.get());
  assert.ok(result.points > 0 && result.streak === 1, `a win banks points (${result.points}) and starts a streak`);
  cues = await played(page);
  assert.equal(cues.at(-1), 'win', 'the win has its cue');
  assert.equal(cues.filter(c => c === 'move').length, s.total - 1, 'every arrow but the last played a move');
  assert.deepEqual(await page.evaluate(() => [window.notes, window.samples > 10]), [0, true], 'all of it came from the clips, none from the stand-in synth');
  await page.click('text=Play again');
  await clear(page);
  result = await page.evaluate(() => window.arrow.$result.get());
  assert.equal(result.streak, 2, 'a second win in a row makes a streak of 2');
  await page.waitForSelector('text=×2 streak');
  await page.keyboard.press('m');
  notes = await page.evaluate(() => window.samples);
  await page.click('text=Play again');
  const quiet = await target(page, true);
  await page.mouse.click(quiet.x, quiet.y);
  assert.equal(await page.evaluate(() => window.samples), notes, 'muted means silent');
  await page.keyboard.press('m');
  await clear(page);
  await page.waitForTimeout(1100);
  assert.equal((await played(page)).at(-1), 'streak', 'a third win in a row adds the streak cue');
  // Pace: the player's dots per second as "t/s", beside the agent's own rate when the app reports one.
  await page.evaluate(() => { const g = window.arrow.game; g.startedAt -= 20000; g.endedAt = g.startedAt + 20000; window.agent.tps(62.3); });
  await page.click('text=Play again');
  const speeds = sel => page.locator(`${sel} [data-speed]`).evaluateAll(list => list.map(el => `${el.dataset.speed} ${el.innerText.replace(/\s+/g, '')} ${el.querySelector('svg') ? 'icon' : ''}`));
  assert.deepEqual(await speeds('[data-bar]'), ['you –t/s icon', 'agent 62t/s icon'], 'no pace before play starts; the agent rate shows, each behind its icon');
  const first = await target(page, true);
  await page.mouse.click(first.x, first.y);
  await page.evaluate(() => { window.arrow.game.startedAt -= 10000; });
  await page.waitForTimeout(700);
  const mid = await snap(page);
  assert.ok(mid.dots >= 2 && mid.cleared === 1, 'dots count the cells of cleared arrows');
  assert.match((await speeds('[data-bar]')).join('|'), /^you \d+(\.\d)?t\/s icon\|agent 62t\/s icon$/, 'pace shows as t/s against the agent');
  await clear(page);
  await page.waitForTimeout(300);
  assert.match((await speeds('[data-pace]')).join('|'), /^you \d+(\.\d)?t\/s icon\|agent 62t\/s icon$/, 'the cleared card shows both rates');
  assert.doesNotMatch(await page.locator('[data-pace]').innerText(), /arrows/, 'arrows per second stays internal');
  const sides = await page.locator('[data-pace] [data-speed]').evaluateAll(list => list.map(el => ({ role: el.getAttribute('role'), label: el.getAttribute('aria-label'), color: getComputedStyle(el).color, icon: el.querySelector('svg').innerHTML })));
  assert.deepEqual(sides.map(s => s.role), ['img', 'img'], 'each rate is announced as one labelled thing');
  assert.match(sides[0].label, /^You: \d+(\.\d)? tokens a second$/);
  assert.equal(sides[1].label, 'Hermes: 62 tokens a second');
  assert.notEqual(sides[0].color, sides[1].color, 'the two sides differ in colour');
  assert.notEqual(sides[0].icon, sides[1].icon, 'and in icon');
  assert.equal(sides[1].color, await page.locator('[aria-label="Board time"]').evaluate(el => getComputedStyle(el).color), 'the agent rate is in the normal text colour');
  await shot(page, '05b-pace');
  // The agent slot stays in the bar when its rate goes away, and follows the app without a tap.
  const left = () => page.locator('[data-bar] [data-speed="agent"]').evaluate(el => [el.getBoundingClientRect().left, el.innerText.replace(/\s+/g, '')]);
  const withRate = await left();
  await page.evaluate(() => window.agent.tps(0.03));
  await page.waitForTimeout(1200);
  assert.equal((await left())[1], '–t/s', 'a rate that would print as 0.0 shows as none, picked up while idle');
  await page.evaluate(() => window.agent.tps(0));
  await page.waitForTimeout(1200);
  assert.deepEqual(await left(), [withRate[0], '–t/s'], 'the slot keeps its place with no rate');
  await shot(page, '05-cleared-free');
  await page.locator('[aria-label="Higher level"]').first().click();
  s = await snap(page);
  assert.deepEqual([s.level, s.maxLives], [4, 3], 'the level picker deals a harder board');
  for (const [lvl, lives] of [[1, 2], [5, 4], [7, 5]]) { await page.evaluate(n => window.arrow.deal(n), lvl); assert.equal((await snap(page)).maxLives, lives, `level ${lvl} has ${lives} lives`); }

  // --- A heavy task: chip invites, board is sized to the prompt, grows with the work ---------
  await page.evaluate(() => { window.location.hash = '/'; });
  await page.waitForSelector('text=Fake chat');
  await page.evaluate(() => window.agent.send('Audit the entire repo, refactor auth and write tests for every endpoint. Be thorough.'));
  const heavy = await page.evaluate(() => window.arrow.task());
  assert.ok(heavy.busy && heavy.level >= 4, `a heavy prompt starts high (L${heavy.level}, est ${heavy.estimate}s)`);
  await page.waitForSelector('text=/Play · L\\d/', { timeout: 8000 });
  await shot(page, '06-chip');
  await page.click('text=/Play · L\\d/');
  await page.waitForFunction(() => window.arrow.game.status === 'play' && window.arrow.game.meta.mode === 'task');
  s = await snap(page);
  assert.equal(s.level, heavy.level, 'the board matches the task level');
  for (let i = 0; i < 40; i++) await page.evaluate(() => window.agent.tool());
  await page.waitForSelector('text=40 tools');
  const hot = await page.evaluate(() => window.arrow.task());
  assert.ok(hot.level > heavy.level, `tool calls raise the level (L${heavy.level} → L${hot.level})`);
  await page.waitForSelector('text=/next L\\d/');
  await shot(page, '07-task-board');

  await clear(page);
  await page.waitForSelector('text=/Next board · L\\d/');
  await shot(page, '08-cleared-task');
  await page.waitForFunction(lvl => window.arrow.game.status === 'play' && window.arrow.game.meta.level === lvl, hot.level, { timeout: 6000 });
  await page.waitForTimeout(300);
  await shot(page, '09-next-board');

  const p = await target(page, true);
  await page.mouse.click(p.x, p.y);
  await page.evaluate(() => window.agent.finish());
  await page.waitForSelector('text=Hermes finished');
  assert.equal((await played(page)).at(-1), 'agentDone', 'the agent finishing rings while you play');
  assert.equal((await snap(page)).status, 'play', 'finishing does not take the board away');
  await shot(page, '10-agent-done');
  await page.click('text=Back to chat');
  await page.waitForSelector('text=Fake chat');
  assert.equal(await page.evaluate(() => window.arrow.tracker.history().length), 1, 'the turn length is remembered');

  // --- A trivial task gets a trivial board ----------------------------------------------------
  await page.evaluate(() => window.agent.send('thanks', 's2'));
  const light = await page.evaluate(() => window.arrow.task());
  assert.equal(light.level, 1, 'a throwaway message is level 1');
  await page.evaluate(() => window.agent.finish('s2'));
  await page.close();

  // --- Light theme, and a phone-sized viewport with touch --------------------------------------
  page = await open({ width: 1180, height: 760 }, 'light');
  await page.click('a:has-text("Arrow")');
  await page.waitForFunction(() => window.arrow?.game.status === 'play');
  await page.evaluate(() => window.arrow.deal(6));
  await page.waitForTimeout(1200);
  await shot(page, '11-l6-light');
  await page.close();

  page = await open({ width: 390, height: 800 });
  await page.click('a:has-text("Arrow")');
  await page.waitForFunction(() => window.arrow?.game.status === 'play');
  await page.evaluate(() => window.arrow.deal(5));
  s = await snap(page);
  assert.ok(s.h > s.w, `a tall viewport gets a tall board (${s.w}×${s.h})`);
  await page.evaluate(() => window.arrow.game.cycleZoom(195, 400));
  assert.ok((await snap(page)).zoomed, 'zoom works on a phone');
  await page.evaluate(() => window.arrow.game.fit());
  const t = await target(page, true);
  await page.touchscreen.tap(t.x, t.y);
  assert.equal((await snap(page)).cleared, 1, 'a finger tap removes an arrow');
  await page.waitForTimeout(700);
  await shot(page, '12-phone-l5');
  await page.evaluate(() => window.arrow.deal(7));
  await clear(page);
  assert.equal((await snap(page)).status, 'won', 'the largest board clears on a phone');
  await page.close();

  // Volume: the slider and [ ] change it, it is remembered, and touching it un-mutes.
  page = await open({ width: 1180, height: 760 });
  await page.click('a:has-text("Arrow")');
  await page.waitForFunction(() => window.arrow?.game.status === 'play');
  const vol = () => page.evaluate(() => +document.querySelector('[aria-label="Volume"]').value);
  await page.click('[aria-label="Settings"]');
  assert.equal(await vol(), 70, 'volume starts at 70%, in the settings menu');
  assert.equal(await page.locator('[aria-label="Transparency"]').count(), 0, 'transparency is a modal-only setting');
  await page.focus('[tabindex]');
  await page.keyboard.press(']'); await page.keyboard.press(']');
  assert.equal(await vol(), 90, '] turns it up');
  await page.keyboard.press('m');
  await page.keyboard.press('[');
  assert.equal(await vol(), 80, '[ turns it down');
  assert.equal(await page.getAttribute('[aria-label="Mute sound"]', 'aria-pressed'), 'true', 'changing the volume un-mutes');
  await page.fill('[aria-label="Volume"]', '25');
  assert.equal(await vol(), 25, 'the slider sets it');
  await page.click('[aria-label="Settings"]');
  assert.equal(await page.locator('[aria-label="Volume"]').count(), 0, 'the menu closes');

  // Hints cost points, more each time. Asking twice for the same arrow is one hint.
  const hintLabel = () => page.textContent('[aria-label="Hint"]');
  assert.equal(await hintLabel(), 'Hint−5%', 'the button shows what the next hint costs');
  await page.keyboard.press('h'); await page.keyboard.press('h');
  assert.equal((await snap(page)).hints, 1, 'the same hint asked twice counts once');
  assert.equal(await hintLabel(), 'Hint−10%', 'the second hint costs more');

  // A tap that lands on a blocked arrow, but right beside one that can leave, goes to the one that can.
  await page.evaluate(() => window.arrow.deal(3));
  const near = await page.evaluate(() => {
    const g = window.arrow.game, { w, h } = g.board, L = g.layout(), r = g.canvas.getBoundingClientRect();
    const free = id => g.isFree(g.arrows.find(a => a.id === id));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const id = g.grid[y * w + x];
      if (id < 0 || free(id)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, other = nx >= 0 && ny >= 0 && nx < w && ny < h ? g.grid[ny * w + nx] : -1;
        if (other >= 0 && other !== id && free(other)) return { x: r.left + L.ox + (x + 0.5 + dx * 0.38) * L.cell, y: r.top + L.oy + (y + 0.5 + dy * 0.38) * L.cell, cx: r.left + L.ox + (x + 0.5) * L.cell, cy: r.top + L.oy + (y + 0.5) * L.cell, free: other, blocked: id };
      }
    }
    return null;
  });
  assert.ok(near, 'the board has a blocked arrow beside a free one');
  assert.equal(await page.evaluate(n => window.arrow.game.arrowAt(n.x - window.arrow.game.canvas.getBoundingClientRect().left, n.y - window.arrow.game.canvas.getBoundingClientRect().top), near), near.blocked, 'the point is strictly on the blocked arrow');
  await page.mouse.click(near.x, near.y);
  await page.waitForTimeout(350);
  s = await snap(page);
  assert.deepEqual([s.cleared, s.lives, s.maxLives], [1, s.maxLives, s.maxLives], 'the near miss is forgiven: the free arrow leaves and no life is lost');
  assert.ok(await page.evaluate(n => !window.arrow.game.arrows.some(a => a.id === n.free), near), 'and it was the neighbour that left');
  await page.mouse.click(near.cx, near.cy);
  await page.waitForTimeout(350);
  const after2 = await snap(page);
  assert.ok(after2.lives === s.lives - 1 || after2.cleared === 2, 'a tap on the middle of an arrow still means that arrow');
  await page.evaluate(() => window.arrow.deal(3));

  const hop = await target(page, true);
  await page.mouse.click(hop.x, hop.y);
  assert.ok(Math.abs(await page.evaluate(() => window.arrow.sound.gain()) - 0.0625) < 1e-6, 'output gain follows the volume, squared');
  await shot(page, '13-volume');
  await page.close();

  // --- The offer beside the composer, and the game as a modal over the chat ---------------------
  page = await open({ width: 1180, height: 760 });
  assert.equal(await page.locator('[data-pill]').count(), 0, 'no offer while the agent is idle');
  await page.evaluate(() => window.agent.send('Refactor the billing module and write tests for all of it.'));
  await page.waitForSelector('[data-pill]');
  assert.equal(await page.textContent('[data-pill]'), 'Play Arrow', 'sending a prompt puts a pill by the composer');
  assert.equal(await page.locator('[data-hermes-arrow-modal]').count(), 0, 'and nothing opens on its own');
  await shot(page, '14-offer-pill');
  await page.click('[data-pill]');
  await page.waitForSelector('[data-hermes-arrow-modal] canvas');
  await page.waitForFunction(() => window.arrow.game.status === 'play' && window.arrow.game.meta.mode === 'task');
  assert.ok(await page.isVisible('text=Fake chat'), 'the chat stays on screen behind it');
  assert.equal(await page.evaluate(() => window.location.hash.includes('hermes-arrow')), false, 'without leaving the chat');
  await page.waitForTimeout(400);
  await shot(page, '15-modal');
  const mt = await target(page, true);
  await page.mouse.click(mt.x, mt.y);
  assert.equal((await snap(page)).cleared, 1, 'the board plays inside the modal');
  await page.click('[aria-label="Settings"]');
  const bg = () => page.evaluate(() => document.querySelector('[data-hermes-arrow-modal]').style.background);
  assert.match(await bg(), /100%/, 'the modal starts solid');
  await page.fill('[aria-label="Transparency"]', '60');
  assert.match(await bg(), /40%/, 'transparency thins the modal background');
  assert.equal(await page.locator('[aria-label="Volume"]').count(), 1, 'volume is in the same menu');
  assert.match(await page.evaluate(() => document.querySelector('[data-bar]').style.background), /50%/, 'the top bar is a half-opaque layer over the board: midway between the board and solid');
  assert.equal(await page.locator('[aria-label="Mute sound"]').count(), 1, 'mute stays in the header');
  await page.waitForTimeout(200);
  await shot(page, '16-modal-settings-see-through');
  await page.click('[role="switch"]');
  await page.click('[aria-label="Close game"]');
  assert.equal(await page.locator('[data-hermes-arrow-modal]').count(), 0, 'the close button closes it');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-pill]').count(), 0, 'with the offer switched off the pill is gone');
  await page.evaluate(() => window.arrow.open());
  await page.waitForSelector('[data-hermes-arrow-modal] canvas');
  assert.equal((await snap(page)).cleared, 1, 'reopening finds the same board in progress');
  assert.match(await bg(), /40%/, 'and remembers the transparency');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-hermes-arrow-modal]').count(), 0, 'Escape closes it');
  // Off screen, the board's clock stops and a board dealt for a new task makes no sound.
  const hiddenClock = await page.evaluate(() => window.arrow.game.seconds);
  await page.waitForTimeout(1300);
  assert.equal(await page.evaluate(() => window.arrow.game.seconds), hiddenClock, 'the clock does not run while the game is closed');
  await page.evaluate(() => window.arrow.open());
  await page.waitForSelector('[data-hermes-arrow-modal] canvas');
  await page.waitForTimeout(600);
  const shownClock = await page.evaluate(() => window.arrow.game.seconds);
  assert.ok(shownClock > hiddenClock && shownClock < hiddenClock + 1.2, `and resumes where it stopped (${hiddenClock.toFixed(1)} → ${shownClock.toFixed(1)})`);
  await page.keyboard.press('Escape');
  const heard = (await played(page)).length;
  await page.evaluate(() => { window.arrow.deal(2); });
  assert.equal((await played(page)).length, heard, 'a board dealt in the background is silent');
  await page.close();

  // An older Desktop without the pill strip gets the offer under the composer instead.
  page = await open({ width: 1180, height: 760 }, undefined, '?old=1');
  await page.evaluate(() => window.agent.send('Refactor the billing module.'));
  await page.click('[data-underside] >> text=Play Arrow');
  await page.waitForSelector('[data-hermes-arrow-modal] canvas');
  await page.close();

  // Whatever goes wrong inside the plugin, the user's message still goes out.
  page = await open({ width: 1180, height: 760 });
  await page.evaluate(() => { window.arrow.game.deal = () => { throw new Error('boom'); }; });
  errors.length = 0;
  assert.equal(await page.evaluate(() => { window.agent.send('Do the thing.'); return window.agent.sent.length; }), 1, 'a plugin failure on send does not stop the send');
  await page.waitForTimeout(200);
  assert.ok(errors.some(e => e.includes('[hermes-arrow]')), 'the failure is logged');
  errors.length = 0;
  await page.close();

  // --- Level override during a task, and the difficulty handicap ---------------------------------
  page = await open({ width: 1180, height: 760 });
  await page.evaluate(() => window.agent.send('thanks'));
  await page.click('[data-pill]');
  await page.waitForFunction(() => window.arrow.game.status === 'play' && window.arrow.game.meta.mode === 'task');
  assert.equal((await snap(page)).level, 1, 'a throwaway prompt deals level 1');
  await page.click('[aria-label="Higher level"]'); await page.click('[aria-label="Higher level"]');
  s = await snap(page);
  assert.deepEqual([s.level, s.mode], [3, 'task'], 'the bar overrides the task level');
  await clear(page);
  await page.waitForSelector('text=/Next board · L3/');
  assert.equal(await page.locator('[role="dialog"][aria-label="Board cleared"] [aria-label="Higher level"]').count(), 1, 'the cleared card has the level picker during a task too');
  await page.evaluate(() => window.arrow.deal());
  assert.equal((await snap(page)).level, 3, 'the override holds for the next board of this task');
  await page.evaluate(() => { window.agent.finish(); });
  await page.waitForTimeout(50);
  await page.evaluate(() => { window.agent.send('thanks again'); });
  await page.waitForFunction(() => window.arrow.game.meta.level === 1);
  await page.evaluate(() => { window.agent.finish(); });

  await page.evaluate(() => window.arrow.deal(3));
  const standard = await snap(page);
  await page.click('[aria-label="Settings"]');
  await page.fill('[aria-label="Difficulty handicap"]', '2');
  s = await snap(page);
  assert.deepEqual([s.level, s.handicap, s.maxLives, s.w, s.h], [3, 2, standard.maxLives - 2, standard.w, standard.h], 'much harder: same level and size, two lives fewer');
  await page.waitForSelector('text=Much harder');
  await shot(page, '17-handicap');
  await page.fill('[aria-label="Difficulty handicap"]', '-2');
  assert.equal((await snap(page)).maxLives, standard.maxLives + 2, 'much easier: two lives more');
  await page.click('[aria-label="Settings"]');
  await clear(page);
  result = await page.evaluate(() => window.arrow.$result.get());
  assert.equal(result.odds, 0.7, 'and the easier board pays less');
  await page.waitForSelector('text=/much easier ×0.70/');
  await page.close();

  // The plugin must survive being loaded while the agent is already working.
  page = await open({ width: 1180, height: 760 }, undefined, '?busy=1');
  await page.click('a:has-text("Arrow")');
  await page.waitForFunction(() => window.arrow?.game.status === 'play', null, { timeout: 5000 });
  assert.equal((await snap(page)).mode, 'task', 'loading mid-task deals a task board');
  await page.close();

  // --- The library: games that are Desktop plugins of their own -------------------------------
  const TAP = '/games/hello-cartridge/plugin.js';
  const seeded = async (disk, query = '') => {
    const pg = await open({ width: 1180, height: 760 }, undefined, query, disk);
    await pg.click('a:has-text("Arrow")');
    await pg.waitForFunction(() => window.arrow?.game.status === 'play' && window.arrow.$shelf.get().read !== undefined);
    return pg;
  };
  const libraryRows = pg => pg.locator('[data-library] [data-cartridge]').evaluateAll(list => list.map(el => `${el.dataset.cartridge}:${el.dataset.kind}`));

  // Only the bundled game: the first layer names it, and the Library is one click further.
  page = await seeded({});
  await page.click('[aria-label="Settings"]');
  assert.equal(await page.locator('select[aria-label="Game"]').count(), 0, 'one game on: nothing to choose between');
  await page.click('text=Library');
  await page.waitForSelector('[data-library]');
  assert.deepEqual(await libraryRows(page), ['arrow:bundled']);
  assert.equal(await page.locator('[aria-label="Settings"][aria-expanded="true"]').count(), 0, 'the settings panel gets out of the way');
  await page.waitForFunction(() => (window.files.read('README.txt') || '').includes('catalog.json'));
  // A game plugin the Desktop loads while the Library is open appears on its own.
  await page.evaluate(async url => { window.unloadTap = await window.games.load(url); }, TAP);
  await page.waitForSelector('[data-cartridge="hello-cartridge"]');
  await page.close();

  // An older Desktop without the file door keeps the catalog in the plugin's own storage instead.
  page = await seeded({}, `?nofiles&games=${TAP}`);
  await page.click('[aria-label="Settings"]');
  await page.click('text=Library');
  await page.click('[aria-label="Tap on"]');
  assert.deepEqual(await page.evaluate(() => window.store.get('gamesOff')), { 'hello-cartridge': true });
  await page.click('[data-library] >> text=Done');
  await page.close();

  // Games loaded before the console (a Desktop restart), a forked bundled game, and three that are refused.
  const { execFileSync } = await import('node:child_process');
  await rm(repo + 'src/cartridges/arrow-test-fork', { recursive: true, force: true });
  execFileSync('node', ['scripts/cartridge.mjs', 'fork', 'arrow', 'arrow-test-fork'], { cwd: repo });
  execFileSync('node', ['scripts/cartridge.mjs', 'build', 'arrow-test-fork'], { cwd: repo });
  await rm(repo + 'src/cartridges/arrow-test-fork', { recursive: true, force: true });
  page = await seeded({}, `?games=${TAP},/games/arrow-test-fork/plugin.js`);
  await page.evaluate(() => {
    const slot = globalThis.__hermesCartridges, tap = slot.list.find(c => c.id === 'hello-cartridge');
    slot.list = slot.list.concat(
      { ...tap, id: 'arrow' },
      { contract: 3, id: 'broken', title: 'Broken', create() { throw new Error('no cartridge inside'); } },
      { contract: 1, id: 'old', title: 'Old', create() {} },
      { contract: 3, id: 'remote-cover', title: 'Remote', cover: 'https://example.com/cover.png', create: tap.create });
    slot.listeners.forEach(fn => fn());
  });
  await page.waitForFunction(() => window.arrow.$carts.get().length === 5);
  assert.deepEqual(await page.evaluate(() => [window.arrow.$carts.get().map(c => c.id), window.arrow.$active.get()]), [['arrow', 'hello-cartridge', 'arrow-test-fork', 'broken', 'remote-cover'], 'arrow'], 'games loaded first are found; Arrow stays in play');
  const mine = await target(page, true);
  await page.mouse.click(mine.x, mine.y);
  const midBoard = await snap(page);
  await page.click('[aria-label="Settings"]');
  assert.deepEqual(await page.locator('select[aria-label="Game"] option').allInnerTexts(), ['Arrow', 'Tap', 'Arrow (arrow-test-fork)', 'Broken', 'Remote'], 'the first layer lists only games that are on');
  await page.click('text=Library');
  await page.waitForSelector('[data-library] [data-cartridge="hello-cartridge"] img');
  assert.deepEqual(await libraryRows(page), ['arrow:bundled', 'hello-cartridge:custom', 'arrow-test-fork:custom', 'broken:custom', 'remote-cover:custom', 'arrow:custom', 'old:custom']);
  const row = id => page.locator(`[data-library] [data-cartridge="${id}"][data-kind="custom"]`);
  assert.match(await row('hello-cartridge').innerText(), /^Tap\s+Custom\s+hello-cartridge · 1\.0\.0\s+Tap the lit square/, 'title, kind, folder and description');
  assert.match(await page.locator('[data-cartridge="arrow"][data-kind="bundled"]').innerText(), /^Arrow\s+Bundled\s+Playing\s+arrow · /);
  assert.equal(await page.locator('[data-cartridge="arrow"][data-kind="bundled"] img').count(), 1, 'the bundled game has its cover');
  assert.equal(await row('arrow-test-fork').locator('img').count(), 1, 'the fork carries its cover inside its plugin');
  assert.equal(await row('remote-cover').locator('img').count(), 0, 'a cover that is a web address is never fetched');
  assert.match(await row('arrow').innerText(), /Not loaded: "arrow" is a bundled game\. A fork needs an id of its own/);
  assert.match(await row('old').innerText(), /Not loaded: built for contract 1/);
  assert.equal(await row('old').locator('[role="switch"]').count(), 0, 'something that is not a game has no switch');
  await shot(page, '18-library');
  // Switching a game off is written to catalog.json, and takes it off the first layer.
  await page.click('[aria-label="Remote on"]');
  await page.waitForFunction(() => window.files.read('catalog.json'));
  assert.deepEqual(JSON.parse(await page.evaluate(() => window.files.read('catalog.json'))), { disabled: ['remote-cover'] });
  // An agent editing catalog.json has the same effect, without a click.
  await page.evaluate(() => window.files.put('catalog.json', '{"disabled":["remote-cover","arrow-test-fork"]}'));
  await page.waitForFunction(() => window.arrow.$off.get()['arrow-test-fork'], null, { timeout: 9000 });
  assert.equal(await page.locator('[aria-label="Arrow (arrow-test-fork) on"]').isChecked(), false);
  await page.click('[aria-label="Arrow (arrow-test-fork) on"]');
  await page.waitForFunction(() => !window.arrow.$off.get()['arrow-test-fork']);
  await page.click('[data-library] >> text=Done');

  // Play the custom game: its own bar, scoring, stats and sounds.
  await page.click('[aria-label="Settings"]');
  await page.selectOption('select[aria-label="Game"]', 'hello-cartridge');
  await page.waitForSelector('[data-game="hello-cartridge"] [data-grid]');
  assert.equal(await page.locator('[aria-label="Difficulty handicap"]').count(), 0, 'Arrow\'s settings leave with it');
  await page.click('[aria-label="Settings"]');
  assert.match(await page.locator('[data-bar]').innerText(), /L1[\s\S]*8 to go[\s\S]*0 missed/, 'the bar is the game\'s own parts');
  assert.deepEqual(await page.locator('[data-bar] [data-speed]').evaluateAll(list => list.map(el => el.dataset.speed)), ['you', 'agent'], 'built from the same kit');
  await shot(page, '19-tap-cartridge');
  await page.locator('[data-grid] button:not([data-lit])').first().dispatchEvent('pointerdown');
  for (let i = 0; i < 8; i++) await page.locator('[data-lit]').dispatchEvent('pointerdown');
  await page.waitForSelector('[role="dialog"][aria-label="Board cleared"]');
  assert.match(await page.locator('[role="dialog"][aria-label="Board cleared"]').innerText(), /8 hits · 0:0\d · 1 missed/, 'its own scoring and clock');
  const kept = await page.evaluate(() => [window.store.get('cart.hello-cartridge.stats'), window.store.get('stats')?.boards || 0, window.store.get('game')]);
  assert.deepEqual([kept[0].boards, kept[1], kept[2]], [1, 0, 'hello-cartridge'], 'its stats are stored apart from Arrow\'s, and the choice of game is remembered');
  assert.ok((await played(page)).includes('win'), 'its sounds play through the console');
  await shot(page, '20-tap-cleared');
  // A turn starting reaches the game in play, and the invitation is that game's.
  await page.evaluate(() => { window.location.hash = '/'; });
  await page.waitForSelector('text=Fake chat');
  await page.evaluate(() => window.agent.send('Audit the entire repo, refactor auth and write tests for every endpoint. Be thorough.'));
  await page.waitForSelector('[data-pill]');
  assert.deepEqual(await page.locator('[data-pill]').allInnerTexts(), ['Play Tap'], 'the composer offers the game in play');
  await page.click('[data-pill]');
  await page.waitForSelector('[data-hermes-arrow-modal] [data-grid="5"]');
  await page.evaluate(() => window.agent.finish());
  // The forked Arrow is a game of its own, with stats of its own.
  await page.click('[aria-label="Settings"]');
  await page.selectOption('select[aria-label="Game"]', 'arrow-test-fork');
  await page.waitForSelector('[data-game="arrow-test-fork"] canvas');
  await page.click('[aria-label="Settings"]');
  assert.match(await page.locator('[data-bar]').innerText(), /L\d · \w+[\s\S]*left/, 'the fork draws Arrow\'s bar');
  // A game that throws on start is contained.
  await page.click('[aria-label="Settings"]');
  await page.selectOption('select[aria-label="Game"]', 'broken');
  await page.waitForSelector('text=Broken did not start');
  // Switching the game in play off falls back to the first game that is on: Arrow, mid-board as it was left.
  await page.click('text=Library');
  await page.click('[aria-label="Broken on"]');
  await page.waitForSelector('[data-game="arrow"]');
  assert.deepEqual(await page.evaluate(() => [window.arrow.$active.get(), window.arrow.game.snapshot().cleared]), ['arrow', midBoard.cleared], 'back on Arrow, mid-board');
  for (const name of ['Tap', 'Arrow (arrow-test-fork)', 'Arrow']) await page.click(`[aria-label="${name} on"]`);
  assert.equal(await page.evaluate(() => window.arrow.$carts.get().filter(c => !window.arrow.$off.get()[c.id]).length), 1, 'the last game cannot be switched off');
  // A game plugin the Desktop unloads leaves the Library.
  await page.evaluate(() => { const slot = globalThis.__hermesCartridges; slot.list = slot.list.filter(c => c.id !== 'hello-cartridge'); slot.listeners.forEach(fn => fn()); });
  await page.waitForFunction(() => !window.arrow.$rows.get().some(r => r.id === 'hello-cartridge'));
  errors.splice(0, errors.length, ...errors.filter(e => !/no cartridge inside|was not loaded/.test(e)));
  await page.close();

  assert.deepEqual(errors, [], 'no page errors');
  console.log('browser: all checks passed · screenshots in test/out');
} finally {
  await browser.close();
  server.close();
}
