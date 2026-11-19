// Arrow, the cartridge: a tap-the-arrows-out puzzle. The board you are dealt grows with the task:
// a quick question gets a handful of arrows, a long multi-tool job gets a board that takes minutes.
//
// Everything here reaches the app through `api` (docs/CARTRIDGES.md). It imports nothing from the
// Desktop SDK, so it is also the reference for how a cartridge is put together.

import { useEffect, useRef } from 'react';
import { Game } from './game.js';
import { handicapFactor, livesFor, liveStreak, nextHintCost, pace, settle } from './score.js';
import { boardSpec, dealBoard, handicap, HANDICAP_NAMES, level, levelForTask, MAX_LEVEL } from './difficulty.js';
import voice from './voice.js';

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
const CANVAS = { position: 'absolute', inset: 0, display: 'block', touchAction: 'none', cursor: 'pointer' };

function create(api) {
  const { kit, atom, useValue, storage } = api;
  const { S, fmt, clock, rate, Button } = kit;
  const $snap = atom({ status: 'empty' }), $auto = atom(0), $result = atom(null), $stats = atom({}), $handicap = atom(0);
  let freeLevel = Math.max(1, Math.min(MAX_LEVEL, Number(storage.get('freeLevel', 3)) || 3));
  let stats = { boards: 0, arrows: 0, points: 0, best: 0, streak: 0, bestStreak: 0, lastPlay: 0, ...(storage.get('stats', {}) || {}) };
  // taskLevel: a level the player chose over the one picked for the running task; 0 = follow the task.
  let colors = () => ({}), stopAuto = null, taskLevel = 0;
  $stats.set(stats);
  $handicap.set(handicap(storage.get('handicap', 0)));
  const sound = api.voice(voice);
  const saveStats = next => { stats = next; storage.set('stats', stats); $stats.set(stats); };
  // A board is over: bank the points, move the streak.
  const finish = won => {
    const s = game.snapshot();
    const { stats: next, result, lost } = settle(stats, { won, level: s.level, arrows: s.total, seconds: s.seconds, lives: s.lives, hints: s.hints, handicap: s.handicap });
    const speed = pace({ dots: s.dots, arrows: s.cleared, seconds: s.seconds });
    if (won && speed.tps > (next.bestTps || 0)) next.bestTps = speed.tps;
    saveStats(next);
    $result.set(won ? { ...result, total: next.points, ...speed, agentTps: kit.agentRate() } : { lostStreak: lost });
  };

  const game = new Game({
    colors: () => colors(),
    onChange: snap => $snap.set(snap),
    onEvent: (type, detail = {}) => {
      // Game sounds belong to a board you can see: a board dealt in the background for a new task stays silent.
      const cue = (...args) => { if (game.canvas) sound.play(...args); };
      if (type === 'exit' || type === 'won' || type === 'blocked' || type === 'jam') api.haptic('tap');
      if (type === 'deal') { $result.set(null); cue('deal'); }
      if (type === 'exit') { stats.arrows++; cue('move', game.total ? game.cleared / game.total : 0); }
      if (type === 'blocked') cue(game.lives === 1 ? 'lastLife' : 'blocked');
      if (type === 'hint') cue('hint');
      if (type === 'preview') cue(detail.clear ? 'previewClear' : 'previewBlocked');
      if (type === 'zoom') cue('zoom', detail.step);
      if (type === 'won') {
        stats.arrows++; finish(true); cue('win'); queueNext();
        // A streak landing on 3, 5 or a multiple of 5 gets its own flourish, after the win's.
        const streak = $result.get()?.streak || 0;
        if (streak === 3 || (streak >= 5 && streak % 5 === 0)) api.setTimeout(() => cue('streak'), 900);
      }
      if (type === 'jam') { finish(false); cue('jam'); }
    }
  });

  const cancelAuto = () => { if (stopAuto) { stopAuto(); stopAuto = null; } $auto.set(0); };

  /** Deal a board for whatever the agent is doing right now (or free play when it is idle). */
  function deal(forceLevel) {
    cancelAuto();
    const task = api.task();
    const n = forceLevel || (task.busy ? taskLevel || levelForTask(task) : freeLevel);
    const hc = $handicap.get(), options = { aspect: game.aspect(), seed: (Math.random() * 0x7fffffff) | 0, handicap: hc };
    game.deal(boardSpec(n, options), { level: n, lives: livesFor(n, hc), handicap: hc, mode: task.busy ? 'task' : 'free' }, dealBoard(n, options));
  }

  // While the agent is still working, a cleared board is followed by the next one on its own.
  function queueNext() {
    cancelAuto();
    if (!api.task().busy) return;
    $auto.set(Date.now() + 4000);
    stopAuto = api.setTimeout(() => { stopAuto = null; $auto.set(0); if (game.status === 'won') deal(); }, 4000);
  }

  const restart = () => { game.reset(); sound.play('deal'); };
  const setFreeLevel = n => { freeLevel = Math.max(1, Math.min(MAX_LEVEL, n)); storage.set('freeLevel', freeLevel); deal(freeLevel); };
  const setLevel = n => {
    const next = Math.max(1, Math.min(MAX_LEVEL, n));
    if (!api.task().busy) return setFreeLevel(next);
    taskLevel = next; deal(next);
  };
  // Applies from the next board; a board nobody has started is swapped right away.
  const setHandicap = v => {
    const next = handicap(v);
    $handicap.set(next); storage.set('handicap', next);
    if (game.status === 'play' && !game.touched) deal(game.meta?.level);
  };
  const levelLabel = n => `L${n} · ${level(n).name}`;

  // ---- the bar ------------------------------------------------------------------------------

  function Bar() {
    const snap = useValue($snap), run = liveStreak(useValue($stats));
    const running = snap.status === 'play' && snap.started, value = snap.level || freeLevel;
    return (
      <>
        <kit.Stepper compact value={value} max={MAX_LEVEL} label={levelLabel(value)} onChange={setLevel}
          tip={`${snap.mode === 'task' ? 'Sized to the task Hermes is working on' : 'Free play'}. − and + deal a new board at another level.`} />
        {snap.handicap !== 0 && snap.handicap != null && <kit.Tag tip="Difficulty handicap, set under ⚙. It changes how hard each level's boards are, and what they pay.">{HANDICAP_NAMES[snap.handicap]}</kit.Tag>}
        <kit.Count value={snap.left ?? 0} label="left" />
        <kit.Pips value={snap.lives ?? 3} max={snap.maxLives ?? 3} tip={`${snap.lives ?? 3} of ${snap.maxLives ?? 3} lives. Harder boards start with more.`} />
        {/* Runs from the first arrow tapped until the board is cleared or jammed. */}
        <kit.Clock running={running} started={!!snap.started} seconds={() => game.seconds} />
        {/* The player's speed in the agent's unit: grid dots uncovered per second, as "tokens". */}
        <kit.Pace running={running} value={() => pace({ dots: snap.dots, arrows: snap.cleared, seconds: snap.started ? game.seconds : 0 }).tps}
          tip="Your speed in your agent's unit: every grid dot you uncover counts as ten tokens. Beside it, your agent's average tokens a second in this chat." />
        <kit.Streak run={run} tip={`${run} boards cleared in a row. Each adds 10% to your points. Ends on a jam or after 36 hours away.`} />
      </>
    );
  }

  // Beside the agent's status: the board the task has grown into.
  function Note() {
    const snap = useValue($snap), next = levelForTask(api.useTask());
    return next > (snap.level || 0) ? <kit.Tag tip="The task is running long: your next board is bigger">next L{next}</kit.Tag> : null;
  }

  function Actions() {
    const snap = useValue($snap), task = api.useTask();
    const hintCost = Math.round(nextHintCost(snap.hints || 0) * 100), playing = snap.status === 'play';
    return (
      <>
        {snap.zoomed && <kit.Action tip="Zoom back out (F). Double-click the board to step through zoom levels." onClick={() => game.fit()}>Fit</kit.Action>}
        <kit.Action variant="outline" label="Hint" disabled={!playing} onClick={() => game.hint()} cost={hintCost > 0 ? `−${hintCost}%` : ''}
          tip={hintCost ? `Show an arrow that can leave (H). Takes ${hintCost}% off this board's points, and the next one costs more.` : 'Show an arrow that can leave (H). Hints have already taken all they can from this board.'}>Hint</kit.Action>
        <kit.Action tip="Start this board over (R)" disabled={!snap.total} onClick={() => restart()}>Restart</kit.Action>
        {!task.busy && playing && <kit.Action tip="Deal a different board (N)" onClick={() => deal(freeLevel)}>New</kit.Action>}
      </>
    );
  }

  // ---- the board and its cards ------------------------------------------------------------------

  function Overlay({ snap }) {
    const task = api.useTask(), auto = useValue($auto), result = useValue($result);
    kit.useTick(auto ? 250 : 0);
    if (snap.status === 'won') {
      const next = task.busy ? taskLevel || levelForTask(task) : freeLevel;
      return (
        <kit.Card label="Board cleared">
          <kit.Eyebrow>Cleared</kit.Eyebrow>
          <kit.Headline big>+{fmt(result?.points || 0)}</kit.Headline>
          <kit.Line>{snap.total} arrows · {clock(snap.seconds)} · {snap.lives}/{snap.maxLives} lives</kit.Line>
          {result?.points > 0 && (
            <kit.Line faint>
              L{snap.level} ×{result.difficulty.toFixed(2)} · time ×{result.time.toFixed(2)} · lives ×{result.life.toFixed(1)}{result.streak > 1 ? ` · streak ${result.streak} ×${result.run.toFixed(1)}` : ''}{result.hints > 0 ? ` · ${result.hints} hint${result.hints === 1 ? '' : 's'} ×${result.hint.toFixed(2)}` : ''}{result.handicap ? ` · ${HANDICAP_NAMES[result.handicap].toLowerCase()} ×${result.odds.toFixed(2)}` : ''}
            </kit.Line>
          )}
          <kit.Rates you={result?.tps || 0} agent={result?.agentTps || 0} />
          {task.busy
            ? <><kit.Stepper value={next} max={MAX_LEVEL} label={levelLabel(next)} onChange={setLevel} /><Button onClick={() => deal()}>Next board · L{next}{auto ? ` (${Math.max(1, Math.ceil((auto - Date.now()) / 1000))})` : ''}</Button></>
            : <><kit.Stepper value={freeLevel} max={MAX_LEVEL} label={levelLabel(freeLevel)} onChange={setLevel} /><Button onClick={() => deal(freeLevel)}>Play again</Button></>}
          <kit.Line faint>{fmt(result?.total ?? stats.points)} points · {stats.boards} boards all-time{stats.bestTps ? ` · best ${rate(stats.bestTps)} t/s` : ''}</kit.Line>
        </kit.Card>
      );
    }
    if (snap.status === 'jam') {
      return (
        <kit.Card label="Out of lives" tone="red">
          <kit.Headline color="red">Jammed</kit.Headline>
          <kit.Line>{snap.left} of {snap.total} arrows left</kit.Line>
          {result?.lostStreak > 1 && <kit.Tag color="yellow">×{result.lostStreak} streak ended</kit.Tag>}
          <kit.Stepper value={snap.level} max={MAX_LEVEL} label={levelLabel(snap.level)} onChange={setLevel} />
          <kit.Row>
            <Button onClick={() => restart()}>Retry board</Button>
            <Button variant="outline" onClick={() => deal(snap.level)}>New board</Button>
          </kit.Row>
        </kit.Card>
      );
    }
    return null;
  }

  function Stage() {
    const canvas = useRef(null), snap = useValue($snap);
    useEffect(() => {
      colors = palette(canvas.current);
      game.attach(canvas.current);
      // Fit an unstarted board to this viewport; keep a board in progress.
      if (game.status === 'empty' || (game.status === 'play' && !game.touched)) deal();
      return () => { game.detach(); colors = () => ({}); };
    }, []);
    return (
      <>
        <canvas ref={canvas} style={CANVAS} aria-label={`Arrow puzzle, ${snap.left ?? 0} arrows left. Tap an arrow whose path to the edge is clear. Hold an arrow to preview its path. Double-click to zoom.`} />
        <Overlay snap={snap} />
      </>
    );
  }

  function Settings() {
    const hc = useValue($handicap);
    return (
      <>
        <kit.Setting label="Difficulty" value={HANDICAP_NAMES[hc]}>
          <kit.Range min="-2" max="2" step="1" value={hc} label="Difficulty handicap" onChange={e => setHandicap(e.target.value)} />
        </kit.Setting>
        <kit.SettingNote>{hc ? `Every level's boards are ${hc > 0 ? 'harder' : 'easier'}: ${hc > 0 ? 'fewer' : 'more'} arrows free to move, ${Math.abs(hc)} ${hc > 0 ? 'fewer' : 'more'} ${Math.abs(hc) === 1 ? 'life' : 'lives'}, points ×${handicapFactor(hc).toFixed(2)}.` : 'Shifts how hard each level is without changing its size.'}</kit.SettingNote>
      </>
    );
  }

  return {
    Bar, Note, Actions, Stage, Settings,
    onKey(k) {
      if (k === 'h') game.hint(); else if (k === 'r') restart(); else if (k === 'f' || k === '0') game.fit(); else if (k === 'n' && !api.task().busy) deal(freeLevel); else return false;
      return true;
    },
    // A new task replaces a board nobody has started; a board in progress is left alone.
    taskStarted() { taskLevel = 0; if (game.status !== 'play' || !game.touched) deal(); },
    invite(task) { const n = levelForTask(task); return { label: `L${n}`, tip: `play a level-${n} board while this runs` }; },
    dispose() { cancelAuto(); game.detach(); },
    // Test harness seam.
    debug: { game, deal, $result, $handicap, setHandicap, stats: () => stats, task: () => ({ ...api.task(), level: levelForTask(api.task()) }) }
  };
}

export default {
  contract: 1,
  id: 'arrow',
  name: 'Arrow',
  title: 'Hermes Arrow',
  glyph: '➤',
  version: __VERSION__,
  description: 'Tap the arrows out. Boards scale with how long and hard your agent is working.',
  create
};
