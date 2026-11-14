// Hermes Arrow: a tap-the-arrows-out puzzle for the time your agent spends working.
// The board you are dealt grows with the task: a quick question gets a handful of arrows,
// a long multi-tool job gets a board that takes minutes.

import { useEffect, useRef, useState } from 'react';
import {
  atom, Button, COMPOSER_AREAS, haptic, host, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, STATUSBAR_AREAS, Tip, useValue
} from '@hermes/plugin-sdk';
import { Game } from './game.js';
import { livesFor, liveStreak, settle } from './score.js';
import { createSound } from './sound.js';
import { boardSpec, level, levelForTask, MAX_LEVEL } from './difficulty.js';
import { createTracker } from './tracker.js';

const ID = 'hermes-arrow', ROUTE = '/hermes-arrow', VERSION = '0.3.1';
const fmt = n => Math.round(n).toLocaleString('en-US');

const clock = seconds => {
  const s = Math.max(0, Math.floor(seconds)), m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};
const hashPath = () => (window.location.hash || '').replace(/^#/, '') || '/';
const onGame = () => hashPath().split('?')[0] === ROUTE;

// Theme colours for the canvas, re-read at most once a second so a theme switch follows through.
function palette(el) {
  let at = -Infinity, value = {};
  return () => {
    const t = performance.now();
    if (t - at < 1000 || !el.isConnected) return value;
    at = t;
    const css = getComputedStyle(el), read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const text = css.color || 'currentColor';
    value = { arrow: read('--ui-accent', text), hint: read('--ui-yellow', text), bad: read('--ui-red', text),
      go: read('--ui-green', text), dot: read('--ui-text-quaternary', text) };
    return value;
  };
}

function create(ctx) {
  const $snap = atom({ status: 'empty' }), $auto = atom(0), $result = atom(null), $sound = atom(true), $volume = atom(0.7), $stats = atom({});
  const stored = (key, fallback) => { try { const v = ctx.storage.get(key, fallback); return v == null ? fallback : v; } catch { return fallback; } };
  const store = (key, value) => { try { ctx.storage.set(key, value); } catch { /* storage is best-effort */ } };
  let freeLevel = Math.max(1, Math.min(MAX_LEVEL, Number(stored('freeLevel', 3)) || 3));
  let stats = { boards: 0, arrows: 0, points: 0, best: 0, streak: 0, bestStreak: 0, lastPlay: 0, ...(stored('stats', {}) || {}) };
  let returnTo = '/', colors = () => ({}), stopAuto = null;
  $stats.set(stats);
  $sound.set(stored('sound', true) !== false);
  $volume.set(Math.max(0, Math.min(1, Number(stored('volume', 0.7)) || 0)));
  const sound = createSound(() => $sound.get(), () => $volume.get());
  const saveStats = next => { stats = next; store('stats', stats); $stats.set(stats); };
  // A board is over: bank the points, move the streak.
  const finish = won => {
    const s = game.snapshot();
    const { stats: next, result, lost } = settle(stats, { won, level: s.level, arrows: s.total, seconds: s.seconds, lives: s.lives });
    saveStats(next);
    $result.set(won ? { ...result, total: next.points } : { lostStreak: lost });
  };

  const game = new Game({
    colors: () => colors(),
    onChange: snap => $snap.set(snap),
    onEvent: (type, detail = {}) => {
      if (type === 'exit' || type === 'won' || type === 'blocked' || type === 'jam') { try { haptic('tap'); } catch { /* optional */ } }
      if (type === 'deal') { $result.set(null); sound.play('deal'); }
      if (type === 'exit') { stats.arrows++; sound.play('move', game.total ? game.cleared / game.total : 0); }
      if (type === 'blocked') sound.play(game.lives === 1 ? 'lastLife' : 'blocked');
      if (type === 'hint') sound.play('hint');
      if (type === 'preview') sound.play(detail.clear ? 'previewClear' : 'previewBlocked');
      if (type === 'zoom') sound.play('zoom', detail.step);
      if (type === 'won') {
        stats.arrows++; finish(true); sound.play('win'); queueNext();
        // A streak landing on 3, 5 or a multiple of 5 gets its own flourish, after the win's.
        const streak = $result.get()?.streak || 0;
        if (streak === 3 || (streak >= 5 && streak % 5 === 0)) ctx.setTimeout(() => sound.play('streak'), 900);
      }
      if (type === 'jam') { finish(false); sound.play('jam'); }
    }
  });

  const cancelAuto = () => { if (stopAuto) { stopAuto(); stopAuto = null; } $auto.set(0); };

  /** Deal a board for whatever the agent is doing right now (or free play when it is idle). */
  function deal(forceLevel) {
    cancelAuto();
    const task = tracker.$task.get();
    const n = forceLevel || (task.busy ? levelForTask(task) : freeLevel);
    game.deal(boardSpec(n, { aspect: game.aspect(), seed: (Math.random() * 0x7fffffff) | 0 }), { level: n, lives: livesFor(n), mode: task.busy ? 'task' : 'free' });
  }

  // While the agent is still working, a cleared board is followed by the next one on its own.
  function queueNext() {
    cancelAuto();
    if (!tracker.$task.get().busy) return;
    $auto.set(Date.now() + 4000);
    stopAuto = ctx.setTimeout(() => { stopAuto = null; $auto.set(0); if (game.status === 'won') deal(); }, 4000);
  }

  const tracker = createTracker({
    atom, storage: { get: stored, set: store },
    busyBySession: host.state.busyBySession,
    onEvent: (type, fn) => ctx.onEvent(type, fn),
    setInterval: (fn, ms) => ctx.setInterval(fn, ms),
    // A new task replaces a board nobody has started; a board in progress is left alone.
    onStart: () => { if (game.status !== 'play' || !game.touched) deal(); }
  });

  // Hear the agent finish while your eyes are on the board.
  let doneAt = 0;
  const stopDone = tracker.$done.subscribe(done => {
    if (!done || done.at === doneAt) return;
    doneAt = done.at;
    if (done.duration >= 2 && onGame()) sound.play('agentDone');
  });

  const restart = () => { game.reset(); sound.play('deal'); };
  const setFreeLevel = n => { freeLevel = Math.max(1, Math.min(MAX_LEVEL, n)); store('freeLevel', freeLevel); deal(freeLevel); };
  const open = () => { if (!onGame()) { returnTo = hashPath(); host.navigate(ROUTE); } };
  const toggleSound = () => { const on = !$sound.get(); $sound.set(on); store('sound', on); if (on) sound.play('move', 0.5); };
  // Moving the volume always un-mutes, and plays a note so you can hear the new level.
  let lastBlip = 0;
  const setVolume = v => {
    const next = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
    $volume.set(next); store('volume', next);
    if (!$sound.get()) { $sound.set(true); store('sound', true); }
    if (Date.now() - lastBlip > 110) { lastBlip = Date.now(); sound.play('move', 0.5); }
  };
  const back = () => { tracker.dismiss(); host.navigate(returnTo && returnTo.split('?')[0] !== ROUTE ? returnTo : '/'); };

  // ---- UI ----------------------------------------------------------------------------------

  const S = {
    page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, outline: 'none', userSelect: 'none', WebkitUserSelect: 'none', color: 'var(--ui-text-primary)' },
    bar: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 12px', padding: '8px 12px', borderBottom: '1px solid var(--ui-stroke-tertiary)', fontSize: '0.8125rem', lineHeight: 1.2 },
    volume: { width: 64, height: 16, margin: 0, accentColor: 'var(--ui-accent)', cursor: 'pointer' },
    grow: { flex: '1 1 0', minWidth: 0 },
    muted: { color: 'var(--ui-text-tertiary)' },
    faint: { color: 'var(--ui-text-quaternary)', fontSize: '0.6875rem' },
    num: { fontVariantNumeric: 'tabular-nums' },
    chip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 3, fontSize: '0.6875rem', fontWeight: 600, background: 'var(--ui-bg-quaternary)' },
    stage: { position: 'relative', flex: '1 1 0', minHeight: 0, overflow: 'hidden', touchAction: 'none' },
    canvas: { position: 'absolute', inset: 0, display: 'block', touchAction: 'none', cursor: 'pointer' },
    veil: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, pointerEvents: 'none' },
    card: { pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', textAlign: 'center', padding: '18px 22px', minWidth: 220, maxWidth: 320,
      borderRadius: 5, background: 'var(--ui-bg-elevated)', border: '1px solid var(--ui-stroke-secondary)', boxShadow: '0 8px 30px color-mix(in srgb, var(--ui-base, transparent) 55%, transparent)' },
    title: { fontSize: '1.25rem', fontWeight: 650, letterSpacing: '-0.01em' },
    row: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
    done: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', fontSize: '0.8125rem', fontWeight: 600,
      background: 'color-mix(in srgb, var(--ui-green) 20%, transparent)', borderLeft: '3px solid var(--ui-green)' }
  };

  function Lives({ lives, max }) {
    const low = lives <= 1;
    return (
      <Tip label={`${lives} of ${max} lives. Harder boards start with more.`}>
        <span style={{ display: 'inline-flex', gap: 3 }} aria-label={`${lives} of ${max} lives`}>
          {Array.from({ length: max }, (_, i) => (
            <span key={i} style={{ width: 8, height: 8, borderRadius: 2, boxSizing: 'border-box',
              background: i < lives ? (low ? 'var(--ui-red)' : 'var(--ui-accent)') : 'transparent',
              border: i < lives ? 'none' : '1px solid var(--ui-stroke-secondary)' }} />
          ))}
        </span>
      </Tip>
    );
  }

  // Runs from the first arrow tapped until the board is cleared or jammed.
  function Timer({ snap }) {
    const [, tick] = useState(0);
    const running = snap.status === 'play' && snap.started;
    useEffect(() => { if (!running) return; const id = window.setInterval(() => tick(n => n + 1), 250); return () => window.clearInterval(id); }, [running]);
    return <span style={{ ...S.num, color: snap.started ? 'var(--ui-text-primary)' : 'var(--ui-text-quaternary)' }} aria-label="Board time">{clock(snap.started ? game.seconds : 0)}</span>;
  }

  function Streak() {
    const stats = useValue($stats), run = liveStreak(stats);
    if (run < 2) return null;
    return <Tip label={`${run} boards cleared in a row. Each adds 10% to your points. Ends on a jam or after 36 hours away.`}><span style={{ ...S.chip, color: 'var(--ui-yellow)' }}>×{run} streak</span></Tip>;
  }

  // What the agent is doing. The one fact that matters while playing, so it stays in the bar.
  function AgentStatus({ boardLevel }) {
    const task = useValue(tracker.$task);
    if (!task.busy) return <span style={S.muted}>Agent idle</span>;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: 7, background: 'var(--ui-accent)', flex: 'none' }} />
        <span style={{ fontWeight: 600, ...S.num }}>Working {clock(task.elapsed)}</span>
        {task.tools > 0 && <span style={{ ...S.muted, ...S.num }}>{task.tools} tool{task.tools === 1 ? '' : 's'}</span>}
        {task.count > 1 && <span style={S.muted}>+{task.count - 1} more</span>}
        {task.level > boardLevel && <Tip label="The task is running long: your next board is bigger"><span style={S.chip}>next L{task.level}</span></Tip>}
      </span>
    );
  }

  function DoneBanner() {
    const done = useValue(tracker.$done);
    if (!done || done.duration < 2) return null;
    return (
      <div style={S.done} role="status">
        <span style={S.grow}>Hermes finished <span style={{ ...S.num, fontWeight: 500 }}>in {clock(done.duration)}</span>
          {done.still > 0 && <span style={{ ...S.muted, fontWeight: 400 }}> · {done.still} still running</span>}</span>
        <Button size="sm" onClick={back}>Back to chat</Button>
        <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => tracker.dismiss()}>✕</Button>
      </div>
    );
  }

  function LevelPicker({ value }) {
    return (
      <span style={S.row}>
        <Button size="sm" variant="outline" aria-label="Easier" disabled={value <= 1} onClick={() => setFreeLevel(value - 1)}>−</Button>
        <span style={{ minWidth: 96, ...S.num }}>L{value} · {level(value).name}</span>
        <Button size="sm" variant="outline" aria-label="Harder" disabled={value >= MAX_LEVEL} onClick={() => setFreeLevel(value + 1)}>+</Button>
      </span>
    );
  }

  function Overlay({ snap }) {
    const task = useValue(tracker.$task), auto = useValue($auto), result = useValue($result);
    const [, tick] = useState(0);
    useEffect(() => { if (!auto) return; const id = window.setInterval(() => tick(n => n + 1), 250); return () => window.clearInterval(id); }, [auto]);
    if (snap.status === 'won') {
      const next = task.busy ? levelForTask(task) : freeLevel;
      return (
        <div style={S.veil}><div style={S.card} role="dialog" aria-label="Board cleared">
          <div style={{ ...S.faint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cleared</div>
          <div style={{ ...S.title, ...S.num, fontSize: '1.75rem', lineHeight: 1 }}>+{fmt(result?.points || 0)}</div>
          <div style={{ ...S.muted, ...S.num }}>{snap.total} arrows · {clock(snap.seconds)} · {snap.lives}/{snap.maxLives} lives</div>
          {result?.points > 0 && (
            <div style={{ ...S.faint, ...S.num }}>
              L{snap.level} ×{result.difficulty.toFixed(2)} · time ×{result.time.toFixed(2)} · lives ×{result.life.toFixed(1)}{result.streak > 1 ? ` · streak ${result.streak} ×${result.run.toFixed(1)}` : ''}
            </div>
          )}
          {task.busy
            ? <Button onClick={() => deal()}>Next board · L{next}{auto ? ` (${Math.max(1, Math.ceil((auto - Date.now()) / 1000))})` : ''}</Button>
            : <><LevelPicker value={freeLevel} /><Button onClick={() => deal(freeLevel)}>Play again</Button></>}
          <div style={{ ...S.faint, ...S.num }}>{fmt(result?.total ?? stats.points)} points · {stats.boards} boards all-time</div>
        </div></div>
      );
    }
    if (snap.status === 'jam') {
      return (
        <div style={S.veil}><div style={{ ...S.card, borderColor: 'var(--ui-red)' }} role="dialog" aria-label="Out of lives">
          <div style={{ ...S.title, color: 'var(--ui-red)' }}>Jammed</div>
          <div style={S.muted}>{snap.left} of {snap.total} arrows left</div>
          {result?.lostStreak > 1 && <div style={{ ...S.chip, color: 'var(--ui-yellow)' }}>×{result.lostStreak} streak ended</div>}
          <div style={S.row}>
            <Button onClick={() => restart()}>Retry board</Button>
            <Button variant="outline" onClick={() => deal(snap.level)}>New board</Button>
          </div>
        </div></div>
      );
    }
    return null;
  }

  function Page() {
    const canvas = useRef(null), root = useRef(null);
    const snap = useValue($snap), task = useValue(tracker.$task), soundOn = useValue($sound), volume = useValue($volume);
    useEffect(() => {
      colors = palette(canvas.current);
      game.attach(canvas.current);
      // Fit an unstarted board to this viewport; keep a board in progress.
      if (game.status === 'empty' || (game.status === 'play' && !game.touched)) deal();
      root.current?.focus({ preventScroll: true });
      return () => { game.detach(); colors = () => ({}); };
    }, []);
    const key = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'h') game.hint(); else if (k === 'r') restart(); else if (k === 'f' || k === '0') game.fit(); else if (k === 'm') toggleSound(); else if (k === '[' || k === '-') setVolume(volume - 0.1); else if (k === ']' || k === '=' || k === '+') setVolume(volume + 0.1); else if (k === 'n' && !task.busy) deal(freeLevel); else return;
      e.preventDefault();
    };
    const playing = snap.status === 'play';
    return (
      <div ref={root} style={S.page} tabIndex={-1} onKeyDown={key} data-hermes-arrow={VERSION}>
        <DoneBanner />
        <div style={S.bar}>
          <Tip label={snap.mode === 'task' ? 'Sized to the task Hermes is working on' : 'Free play'}>
            <span style={S.chip}>L{snap.level || freeLevel} · {level(snap.level || freeLevel).name}</span>
          </Tip>
          <span style={{ ...S.num, fontWeight: 600 }}>{snap.left ?? 0}<span style={{ ...S.muted, fontWeight: 400 }}> left</span></span>
          <Lives lives={snap.lives ?? 3} max={snap.maxLives ?? 3} />
          <Timer snap={snap} />
          <Streak />
          <span style={{ ...S.grow, display: 'flex', justifyContent: 'center' }}><AgentStatus boardLevel={snap.level || 0} /></span>
          <span style={S.row}>
            {snap.zoomed && <Tip label="Zoom back out (F). Double-click the board to step through zoom levels."><Button size="sm" variant="ghost" onClick={() => game.fit()}>Fit</Button></Tip>}
            <Tip label={soundOn ? 'Sound on (M)' : 'Sound off (M)'}><Button size="sm" variant="ghost" aria-label={soundOn ? 'Mute sound' : 'Unmute sound'} aria-pressed={soundOn} onClick={toggleSound} style={{ opacity: soundOn ? 1 : 0.5 }}>{soundOn ? '♪' : '♪̸'}</Button></Tip>
            <Tip label={`Volume ${Math.round(volume * 100)}% ([ and ])`}><input type="range" min="0" max="100" step="5" value={Math.round(volume * 100)} aria-label="Volume" onChange={e => setVolume(e.target.value / 100)} onKeyDown={e => e.stopPropagation()} style={{ ...S.volume, opacity: soundOn ? 1 : 0.5 }} /></Tip>
            <Tip label="Show an arrow that can leave (H)"><Button size="sm" variant="outline" disabled={!playing} onClick={() => game.hint()}>Hint</Button></Tip>
            <Tip label="Start this board over (R)"><Button size="sm" variant="ghost" disabled={!snap.total} onClick={() => restart()}>Restart</Button></Tip>
            {!task.busy && playing && <Tip label="Deal a different board (N)"><Button size="sm" variant="ghost" onClick={() => deal(freeLevel)}>New</Button></Tip>}
          </span>
        </div>
        {!task.busy && playing && !snap.cleared && (
          <div style={{ ...S.bar, borderBottom: 'none', justifyContent: 'center', paddingBottom: 0 }}><LevelPicker value={freeLevel} /></div>
        )}
        <div style={S.stage}>
          <canvas ref={canvas} style={S.canvas} aria-label={`Arrow puzzle, ${snap.left ?? 0} arrows left. Tap an arrow whose path to the edge is clear. Hold an arrow to preview its path. Double-click to zoom.`} />
          <Overlay snap={snap} />
        </div>
      </div>
    );
  }

  // Status bar: an invitation that only exists while the agent has been busy for a moment.
  function Chip() {
    const task = useValue(tracker.$task);
    const [here, setHere] = useState(onGame());
    useEffect(() => { const fn = () => setHere(onGame()); window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); }, []);
    if (!task.busy || task.elapsed < 4 || here) return null;
    return (
      <Tip label={`Hermes Arrow: play a level-${task.level} board while this runs`}>
        <button type="button" onClick={open}
          className="inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] tabular-nums transition-colors text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: '100%', fontVariantNumeric: 'tabular-nums' }}>
          <span aria-hidden="true">➤</span><span>Play · L{task.level}</span>
        </button>
      </Tip>
    );
  }

  return { Page, Chip, tracker, game, open, deal, sound, stopDone, stats: () => stats, $result };
}

export default {
  id: ID,
  name: 'Hermes Arrow',
  description: 'An arrow-escape puzzle for the wait. Boards scale with how long and hard your agent is working.',
  register(ctx) {
    const app = create(ctx);
    ctx.onDispose(() => { app.stopDone?.(); app.tracker.dispose(); app.game.detach(); app.sound.dispose(); });
    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: ROUTE }, render: () => <app.Page /> },
      { id: 'nav', area: SIDEBAR_NAV_AREA, order: 90, data: { path: ROUTE, label: 'Arrow', codicon: 'arrow-right' } },
      { id: 'chip', area: STATUSBAR_AREAS.right, order: 85, render: () => <app.Chip /> },
      { id: 'open', area: PALETTE_AREA, data: { id: `${ID}.open`, label: 'Hermes Arrow: Play', keywords: ['game', 'arrow', 'puzzle', 'wait', 'play'], run: app.open } },
      // Read-only: the draft passes through untouched. Its wording seeds the difficulty estimate.
      { id: 'prompt', area: COMPOSER_AREAS.middleware, data: { handler: draft => { try { app.tracker.sawPrompt(draft); } catch { /* never block a send */ } return draft; } } }
    ]);
    // Test harness seam: absent in the app, so this is a no-op there.
    globalThis.__hermesArrowDebug?.(app);
  }
};
