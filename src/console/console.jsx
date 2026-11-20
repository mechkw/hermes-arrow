// The console: everything a game does not own. It watches the agent, offers a game while it works,
// frames the page and the over-the-chat modal, keeps sound and settings, and keeps the library of
// games. The game in play is a cartridge: bundled (src/cartridges) or a Desktop plugin of its own
// that hands itself over through the slot (catalog.js). The console draws a game's bar, stage and
// settings inside its own frame and never looks inside it, and it never loads code itself.

import { Component, useEffect, useRef, useState } from 'react';
import {
  atom, Button, Dialog, DialogContent, DialogTitle, haptic, host, Popover, PopoverContent, PopoverTrigger, Switch, Tip, useValue
} from '@hermes/plugin-sdk';
import ding from '../../assets/sfx/ding.mp3';
import tick from '../../assets/sfx/tick.mp3';
import { createAudio } from './audio.js';
import { clock, kit, S } from './kit.jsx';
import { admit, CATALOG, CONTRACT, GUIDE, GUIDE_TEXT, readCatalog, slot, watch, writeCatalog } from './catalog.js';
import { createTracker } from './tracker.js';

export const ID = 'hermes-arrow', ROUTE = '/hermes-arrow', VERSION = __VERSION__;
// Most see-through the modal goes, and its size.
const MAX_FADE = 0.8, MODAL_W = 'min(94vw, 1100px)', MODAL_H = 'min(86vh, 860px)';
const hashPath = () => (window.location.hash || '').replace(/^#/, '') || '/';
const onGame = () => hashPath().split('?')[0] === ROUTE;
// The console's own two sounds: the agent finishing, and the note that confirms a volume change.
const CHIME = {
  clips: { ding, tick },
  cues: { agentDone: () => ({ clip: 'ding', rate: 1, dur: 1, gain: 0.6 }), blip: () => ({ clip: 'tick', rate: 2 ** (-1.5 / 12), dur: 0.34, gain: 0.5 }) }
};

/**
 * `builtin` is the list of games shipped inside this bundle: [{ dir, module, cover, prefix }]. `dir` is
 * the game's id, `module` its manifest fields plus create(api), `cover` an image URL, and `prefix`
 * goes before its storage keys ('' keeps Arrow's keys where they have always been).
 */
export function createConsole(ctx, builtin) {
  const $sound = atom(true), $volume = atom(0.7), $modal = atom(false), $fade = atom(0), $offer = atom(true);
  // $carts: games ready to play. $rows: every game the Library lists, loaded or not. $off: ids
  // switched off. $active: the one in play. $shelf: whether the catalog file could be read.
  const $carts = atom([]), $rows = atom([]), $off = atom({}), $active = atom(''), $library = atom(false), $shelf = atom({ file: false, read: false });
  const stored = (key, fallback) => { try { const v = ctx.storage.get(key, fallback); return v == null ? fallback : v; } catch { return fallback; } };
  const store = (key, value) => { try { ctx.storage.set(key, value); } catch { /* storage is best-effort */ } };
  let returnTo = '/';
  $sound.set(stored('sound', true) !== false);
  $volume.set(Math.max(0, Math.min(1, Number(stored('volume', 0.7)) || 0)));
  $fade.set(Math.max(0, Math.min(MAX_FADE, Number(stored('fade', 0)) || 0)));
  $offer.set(stored('offer', true) !== false);
  const audio = createAudio(() => $sound.get(), () => $volume.get());
  const chime = audio.voice(CHIME);

  // Something failed while reacting to the host or running a game. Say so once, keep the details, carry on.
  let reported = false;
  const report = (where, error) => {
    const detail = { where, message: String(error?.message || error), stack: String(error?.stack || '').slice(0, 1500), version: VERSION, at: Date.now() };
    try { console.error('[hermes-arrow]', where, error); } catch { /* no console */ }
    store('lastError', detail);
    if (reported) return;
    reported = true;
    try { host.notify?.({ kind: 'warning', title: 'Hermes Arrow', message: `The game hit an error (${where}): ${detail.message}. Your chat is not affected.` }); } catch { /* optional */ }
  };

  // ---- games --------------------------------------------------------------------------------

  const files = ctx.files?.readText && ctx.files?.writeText ? ctx.files : null;
  const bundled = builtin.map(b => ({ id: b.dir, bundled: true, title: b.module.title, description: b.module.description || '', version: b.module.version || '', glyph: b.module.glyph || '', cover: b.cover || '', create: b.module.create }));
  const taken = new Set(bundled.map(c => c.id)), prefixes = new Map(builtin.map(b => [b.dir, b.prefix]));
  const instances = new Map(); // id -> { cart, game }
  const admitted = new Map();  // what a game handed over -> the checked cartridge, so one object is one game
  const find = id => $carts.get().find(c => c.id === id);
  const playable = () => $carts.get().filter(c => !$off.get()[c.id]);
  if (!files) $off.set({ ...(stored('gamesOff', {}) || {}) });

  /** What a cartridge is handed. The cartridge guide is the reference for every member. */
  const apiFor = cart => {
    const prefix = prefixes.has(cart.id) ? prefixes.get(cart.id) : `cart.${cart.id}.`;
    return {
      contract: CONTRACT, version: VERSION, kit, atom, useValue,
      task: () => tracker.$task.get(),
      useTask: () => useValue(tracker.$task),
      voice: sounds => audio.voice(sounds),
      storage: { get: (key, fallback) => stored(prefix + key, fallback), set: (key, value) => store(prefix + key, value) },
      setTimeout: (fn, ms) => ctx.setTimeout(() => { try { fn(); } catch (error) { report(`${cart.id}.timer`, error); } }, ms),
      haptic: kind => { try { haptic(kind); } catch { /* optional */ } },
      /** True while this game is the one on screen. */
      visible: () => $active.get() === cart.id && (onGame() || $modal.get()),
      report: (where, error) => report(`${cart.id}.${where}`, error)
    };
  };
  // A game that will not start still gets its place, so the player can see why and leave it.
  const broken = (cart, error) => ({
    Bar: () => null,
    Stage: () => <kit.Card label="Game failed to start" tone="red"><kit.Headline color="red">{cart.title} did not start</kit.Headline><kit.Line>{String(error?.message || error)}</kit.Line></kit.Card>
  });
  /** The running game for a cartridge id, started on first use. */
  const use = id => {
    const cart = find(id);
    if (!cart) return null;
    const held = instances.get(id);
    if (held?.cart === cart) return held.game;
    let game;
    try { game = cart.create(apiFor(cart)); if (!game || typeof game.Stage !== 'function' || typeof game.Bar !== 'function') throw new Error('create(api) must return an object with Stage and Bar components'); }
    catch (error) { report(`${id}.create`, error); game = broken(cart, error); }
    instances.set(id, { cart, game });
    return game;
  };
  const current = () => use($active.get());
  /** Call an optional method on the game in play; its failure is reported, never thrown. */
  const ask = (name, ...args) => {
    try { const game = current(); return typeof game?.[name] === 'function' ? game[name](...args) : undefined; }
    catch (error) { report(`${$active.get()}.${name}`, error); return undefined; }
  };
  const retire = id => { const held = instances.get(id); instances.delete(id); try { held?.game.dispose?.(); } catch (error) { report(`${id}.dispose`, error); } };

  // Which game is in play: the player's pick this session, else the one remembered, else the first that is on.
  let picked = false;
  const settle = () => {
    const ok = playable(), now = $active.get(), want = picked ? now : stored('game', '') || now;
    $active.set((ok.find(c => c.id === want) || ok.find(c => c.id === now) || ok[0] || $carts.get()[0])?.id || '');
  };
  /** Publish the games on hand: the rows the Library lists and the games ready to play. */
  const shelve = (off = { ...$off.get() }) => {
    const carts = [...bundled], refused = [];
    for (const raw of slot().list) {
      let held = admitted.get(raw);
      if (!held) { held = admit(raw, taken); admitted.set(raw, held); if (held.error) report('catalog', new Error(`A game was not loaded (${held.id}): ${held.error}`)); }
      if (held.cart) carts.push(held.cart); else refused.push(held);
    }
    for (const raw of [...admitted.keys()]) if (!slot().list.includes(raw)) admitted.delete(raw);
    // At least one game stays on, whatever the catalog file says.
    if (carts.every(c => off[c.id])) off = { ...off, [bundled[0].id]: false };
    for (const id of Object.keys(off)) if (!off[id]) delete off[id];
    // Games first, then what could not be loaded.
    const rows = [...carts.map(c => ({ id: c.id, bundled: !!c.bundled, title: c.title, description: c.description, version: c.version, glyph: c.glyph, cover: c.cover })),
      ...refused.map(r => ({ id: r.id, bundled: false, title: r.title || r.id, description: '', version: '', glyph: '', cover: '', error: r.error }))];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!same($off.get(), off)) $off.set(off);
    if (!same($rows.get(), rows)) $rows.set(rows);
    for (const [id, held] of [...instances]) if (carts.find(c => c.id === id) !== held.cart) retire(id);
    const before = $carts.get();
    if (before.length !== carts.length || before.some((c, i) => c !== carts[i])) $carts.set(carts);
    settle();
  };

  /** Read catalog.json (someone may have edited it) and publish the result. */
  async function reread() {
    if (!files) return shelve();
    const file = await files.readText('data', CATALOG);
    if (!file?.ok && file?.error !== 'not-found') { $shelf.set({ file: false, read: true }); return shelve(); }
    const { disabled, error } = file.ok ? readCatalog(file.text) : { disabled: [] };
    $shelf.set({ file: true, read: true, catalogError: error || '' });
    shelve(Object.fromEntries(disabled.map(id => [id, true])));
  }
  // One read or write at a time, in order; a failure is reported and the next still runs.
  let chain = Promise.resolve();
  const queue = work => (chain = chain.then(work).catch(error => report('catalog', error)));
  const rescan = () => queue(reread);

  const select = id => {
    if (!find(id) || $off.get()[id]) return;
    picked = true; $active.set(id); store('game', id);
  };
  // Switching a game off takes it out of play and off the first menu. At least one game stays on.
  const setEnabled = (id, on) => {
    const off = { ...$off.get() };
    if (on) delete off[id]; else off[id] = true;
    if (!$carts.get().some(c => !off[c.id])) return;
    shelve(off);
    if ($shelf.get().file) queue(() => files.writeText('data', CATALOG, writeCatalog(Object.keys(off)))); else store('gamesOff', off);
  };
  const openLibrary = () => { $library.set(true); rescan(); };

  const tracker = createTracker({
    onError: report,
    atom, storage: { get: stored, set: store },
    busyBySession: host.state.busyBySession,
    onEvent: (type, fn) => ctx.onEvent(type, fn),
    setInterval: (fn, ms) => ctx.setInterval(fn, ms),
    onStart: task => ask('taskStarted', task)
  });
  shelve();
  // A game arriving or leaving calls back from another plugin's stack: defer, and never throw into it.
  const stopSlot = watch(() => { try { queueMicrotask(() => { try { shelve(); } catch (error) { report('catalog', error); } }); } catch { /* could not defer */ } });
  // The catalog folder explains itself to whoever opens it.
  if (files) queue(async () => { const note = await files.stat?.('data', GUIDE); if (note?.ok && !note.exists) await files.writeText('data', GUIDE, GUIDE_TEXT); });
  rescan();

  // Hear the agent finish while your eyes are on the board.
  let doneAt = 0;
  const stopDone = tracker.$done.subscribe(done => {
    try {
      if (!done || done.at === doneAt) return;
      doneAt = done.at;
      if (done.duration >= 2 && (onGame() || $modal.get())) chime.play('agentDone');
    } catch (error) { report('done', error); }
  });

  // The game opens over the chat, so the agent stays in view. The sidebar entry is the full-page version.
  const open = () => { if (!onGame()) $modal.set(true); };
  const close = () => $modal.set(false);
  const setFade = v => { const next = Math.max(0, Math.min(MAX_FADE, Math.round(v * 20) / 20)); $fade.set(next); store('fade', next); };
  const setOffer = on => { $offer.set(!!on); store('offer', !!on); };
  const toggleSound = () => { const on = !$sound.get(); $sound.set(on); store('sound', on); if (on) chime.play('blip'); };
  // Moving the volume always un-mutes, and plays a note so you can hear the new level.
  let lastBlip = 0;
  const setVolume = v => {
    const next = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
    $volume.set(next); store('volume', next);
    if (!$sound.get()) { $sound.set(true); store('sound', true); }
    if (Date.now() - lastBlip > 110) { lastBlip = Date.now(); chime.play('blip'); }
  };
  const back = () => {
    tracker.dismiss();
    if ($modal.get()) return close();
    host.navigate(returnTo && returnTo.split('?')[0] !== ROUTE ? returnTo : '/');
  };
  const title = cart => (cart?.title ? `Hermes ${cart.title}` : 'Hermes Arrow');

  // ---- UI ----------------------------------------------------------------------------------

  // A game's part that throws while drawing is replaced by `fallback`; the rest of the page stays up.
  class Guard extends Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error) { report(`${this.props.id}.${this.props.part}`, error); }
    render() {
      if (!this.state.error) return this.props.children;
      return this.props.part === 'stage'
        ? <kit.Card label="Game error" tone="red"><kit.Headline color="red">This game hit an error</kit.Headline><kit.Line>{String(this.state.error?.message || this.state.error)}</kit.Line><kit.Line faint>Pick another under ⚙, or reload desktop plugins.</kit.Line></kit.Card>
        : null;
    }
  }

  // What the agent is doing. The one fact that matters while playing, so it stays in the bar.
  function AgentStatus({ note }) {
    const task = useValue(tracker.$task);
    if (!task.busy) return <span style={S.muted}>Agent idle</span>;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: 7, background: 'var(--ui-accent)', flex: 'none' }} />
        <span style={{ fontWeight: 600, ...S.num }}>Working {clock(task.elapsed)}</span>
        {task.tools > 0 && <span style={{ ...S.muted, ...S.num }}>{task.tools} tool{task.tools === 1 ? '' : 's'}</span>}
        {task.count > 1 && <span style={S.muted}>+{task.count - 1} more</span>}
        {note}
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

  // The first layer: which of the games that are on is in play, and the way into the Library.
  function GameRow({ onLibrary }) {
    const carts = useValue($carts), off = useValue($off), active = useValue($active);
    const on = carts.filter(c => !off[c.id]);
    return (
      <div style={{ ...S.setting, paddingTop: 10, borderTop: '1px solid var(--ui-stroke-tertiary)' }}>
        <span>Game</span>
        {on.length > 1
          ? <select aria-label="Game" value={active} onChange={e => select(e.target.value)}
              style={{ minWidth: 0, height: 26, padding: '0 6px', borderRadius: 4, font: 'inherit', color: 'inherit', background: 'var(--ui-bg-quaternary)', border: '1px solid var(--ui-stroke-secondary)' }}>
              {on.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          : <span style={{ fontWeight: 600 }}>{on[0]?.title}</span>}
        <Button size="sm" variant="outline" onClick={onLibrary}>Library</Button>
      </div>
    );
  }

  const THUMB = { width: 72, height: 54, borderRadius: 4, flex: 'none', objectFit: 'cover', background: 'var(--ui-bg-quaternary)', border: '1px solid var(--ui-stroke-tertiary)', boxSizing: 'border-box' };
  const CLAMP = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
  // Every game on hand, bundled or custom, each with its switch. Folders that could not be loaded say why.
  function Library() {
    const rows = useValue($rows), off = useValue($off), active = useValue($active), shelf = useValue($shelf);
    // An agent or a person may edit catalog.json while this is open.
    useEffect(() => { const id = window.setInterval(rescan, 5000); return () => window.clearInterval(id); }, []);
    const good = rows.filter(row => !row.error), on = good.filter(row => !off[row.id]).length;
    return (
      <div style={{ ...S.fill, zIndex: 2, display: 'flex', flexDirection: 'column', background: 'var(--ui-bg-elevated)', userSelect: 'text', WebkitUserSelect: 'text' }} role="region" aria-label="Library" data-library="">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--ui-stroke-tertiary)' }}>
          <span style={S.title}>Library</span>
          <span style={{ ...S.muted, ...S.num, fontSize: '0.8125rem' }}>{good.length} game{good.length === 1 ? '' : 's'} · {on} on</span>
          <span style={S.grow} />
          <Button size="sm" onClick={() => $library.set(false)}>Done</Button>
        </div>
        <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', padding: '4px 16px 16px' }}>
          {rows.map(row => {
            const enabled = !off[row.id], cover = row.error ? '' : row.cover;
            return (
              <div key={`${row.error ? 'refused' : 'game'}:${row.id}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--ui-stroke-tertiary)' }} data-cartridge={row.id} data-kind={row.bundled ? 'bundled' : 'custom'}>
                {cover ? <img src={cover} alt="" style={{ ...THUMB, opacity: enabled && !row.error ? 1 : 0.45 }} />
                  : <span style={{ ...THUMB, display: 'grid', placeItems: 'center', fontSize: '1.25rem', color: 'var(--ui-text-tertiary)', opacity: enabled && !row.error ? 1 : 0.45 }} aria-hidden="true">{row.glyph || '◇'}</span>}
                <div style={{ flex: '1 1 0', minWidth: 0, display: 'grid', gap: 3, fontSize: '0.8125rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <span style={{ fontSize: '0.9375rem', fontWeight: 650, opacity: enabled && !row.error ? 1 : 0.6 }}>{row.title}</span>
                    <span style={{ ...S.chip, color: row.bundled ? 'var(--ui-text-tertiary)' : 'var(--ui-accent)' }}>{row.bundled ? 'Bundled' : 'Custom'}</span>
                    {row.id === active && !row.error && <span style={{ ...S.chip, color: 'var(--ui-green)' }}>Playing</span>}
                  </div>
                  <div style={{ ...S.faint, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>{row.id}{row.version ? ` · ${row.version}` : ''}</div>
                  {row.error
                    ? <div style={{ color: 'var(--ui-red)' }} role="alert">Not loaded: {row.error}.</div>
                    : row.description && <div style={{ ...S.muted, ...CLAMP }}>{row.description}</div>}
                </div>
                {!row.error && <Switch checked={enabled} onCheckedChange={next => setEnabled(row.id, next)} aria-label={`${row.title} on`} />}
              </div>
            );
          })}
          <div style={{ ...S.faint, paddingTop: 12, display: 'grid', gap: 4 }}>
            {shelf.catalogError && <span style={{ color: 'var(--ui-red)' }}>{shelf.catalogError}. Every game is treated as on until it is fixed.</span>}
            <span>Each custom game is a Desktop plugin of its own, beside this one in the plugins folder. Your agent can write, fork and manage them with the hermes-arrow-games skill.</span>
          </div>
        </div>
      </div>
    );
  }

  // Volume, the game's own settings, how see-through the modal is, whether the composer offers a game, and the game in play.
  function Settings({ modal, id, game }) {
    const volume = useValue($volume), fade = useValue($fade), offer = useValue($offer);
    const [open, setOpen] = useState(false);
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label="Settings">⚙</Button></PopoverTrigger>
        <PopoverContent align="end" style={S.settings} onKeyDown={e => e.stopPropagation()}>
          <kit.Setting label="Volume" value={`${Math.round(volume * 100)}%`}>
            <kit.Range min="0" max="100" step="5" value={Math.round(volume * 100)} label="Volume" onChange={e => setVolume(e.target.value / 100)} />
          </kit.Setting>
          {game?.Settings && <Guard key={id} id={id} part="settings"><game.Settings modal={modal} /></Guard>}
          {modal && (
            <kit.Setting label="Transparency" value={`${Math.round(fade * 100)}%`}>
              <kit.Range min="0" max={MAX_FADE * 100} step="5" value={Math.round(fade * 100)} label="Transparency" onChange={e => setFade(e.target.value / 100)} />
            </kit.Setting>
          )}
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>Offer a game when I send a prompt</span>
            <Switch checked={offer} onCheckedChange={setOffer} aria-label="Offer a game when I send a prompt" />
          </label>
          <GameRow onLibrary={() => { setOpen(false); openLibrary(); }} />
        </PopoverContent>
      </Popover>
    );
  }

  function Page({ modal = false }) {
    const root = useRef(null);
    const id = useValue($active), carts = useValue($carts), task = useValue(tracker.$task), soundOn = useValue($sound), volume = useValue($volume), fade = useValue($fade), library = useValue($library);
    const game = use(id);
    // In the see-through modal the bar sits halfway between the board's opacity and solid, so it always reads.
    const barStyle = modal && fade > 0 ? { ...S.bar, background: 'color-mix(in srgb, var(--ui-chat-bubble-background, var(--ui-bg-elevated)) 50%, transparent)' } : S.bar;
    useEffect(() => { root.current?.focus({ preventScroll: true }); }, [id]);
    // A game switched on or off in catalog.json by an agent shows up when the page is next opened.
    useEffect(() => { rescan(); }, []);
    const key = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (library) { if (k !== 'escape') return; $library.set(false); }
      else if (k === 'm') toggleSound(); else if (k === '[' || k === '-') setVolume(volume - 0.1); else if (k === ']' || k === '=' || k === '+') setVolume(volume + 0.1);
      else if (!ask('onKey', k, e)) return;
      e.preventDefault();
    };
    if (!game) return <div ref={root} style={S.page} tabIndex={-1} data-hermes-arrow={VERSION} />;
    return (
      <div ref={root} style={S.page} tabIndex={-1} onKeyDown={key} data-hermes-arrow={VERSION} data-game={id}>
        <DoneBanner />
        <div style={barStyle} data-bar="">
          <Guard key={`bar.${id}`} id={id} part="bar"><game.Bar modal={modal} /></Guard>
          <span style={{ ...S.grow, display: 'flex', justifyContent: 'center' }}>
            <AgentStatus note={task.busy && game.Note ? <Guard key={`note.${id}`} id={id} part="note"><game.Note /></Guard> : null} />
          </span>
          <span style={S.row}>
            {game.Actions && <Guard key={`actions.${id}`} id={id} part="actions"><game.Actions modal={modal} /></Guard>}
            <Tip label={soundOn ? 'Sound on (M)' : 'Sound off (M)'}><Button size="sm" variant="ghost" aria-label={soundOn ? 'Mute sound' : 'Unmute sound'} aria-pressed={soundOn} onClick={toggleSound} style={{ opacity: soundOn ? 1 : 0.5 }}>{soundOn ? '♪' : '♪̸'}</Button></Tip>
            <Settings modal={modal} id={id} game={game} />
            {modal && <Button size="sm" variant="ghost" aria-label="Close game" onClick={close}>✕</Button>}
          </span>
        </div>
        <div style={S.stage}>
          <Guard key={`stage.${id}`} id={id} part="stage"><game.Stage modal={modal} /></Guard>
          {library && <Library />}
        </div>
      </div>
    );
  }

  // The game over the chat. Lives in the status bar's tree because that is always mounted.
  function Modal() {
    const isOpen = useValue($modal), fade = useValue($fade), name = title(find(useValue($active)));
    useEffect(() => { const fn = () => { if (onGame()) close(); }; window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); }, []);
    if (!isOpen) return null;
    const solid = Math.round((1 - fade) * 100);
    return (
      <Dialog open onOpenChange={next => { if (!next) close(); }}>
        <DialogContent showCloseButton={false} blurBackdrop={fade === 0} overlayClassName={fade > 0 ? 'bg-transparent' : undefined}
          aria-describedby={undefined} aria-label={name} data-hermes-arrow-modal="" onOpenAutoFocus={e => e.preventDefault()}
          style={{ width: MODAL_W, maxWidth: 'none', height: MODAL_H, maxHeight: 'none', background: `color-mix(in srgb, var(--ui-chat-bubble-background, var(--ui-bg-elevated)) ${solid}%, transparent)` }}>
          <DialogTitle style={S.hidden}>{name}</DialogTitle>
          {/* The dialog body pads by 1rem; the game runs edge to edge. */}
          <div style={{ margin: '-1rem', height: `calc(${MODAL_H} - 2px)`, minHeight: 0, borderRadius: 'inherit', overflow: 'hidden' }}><Page modal /></div>
        </DialogContent>
      </Dialog>
    );
  }

  // Status bar: an invitation that only exists while the agent has been busy for a moment.
  function Chip() {
    const task = useValue(tracker.$task), isOpen = useValue($modal), active = useValue($active), cart = useValue($carts).find(c => c.id === active);
    const [here, setHere] = useState(onGame());
    useEffect(() => { const fn = () => setHere(onGame()); window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); }, []);
    const show = task.busy && task.elapsed >= 4 && !here && !isOpen && cart;
    const invite = show ? ask('invite', task) || {} : {};
    return (
      <>
        <Modal />
        {show && (
          <Tip label={`${title(cart)}: ${invite.tip || 'play while this runs'}`}>
            <button type="button" onClick={open}
              className="inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] tabular-nums transition-colors text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: '100%', fontVariantNumeric: 'tabular-nums' }}>
              <span aria-hidden="true">{cart.glyph || '▶'}</span><span>Play{invite.label ? ` · ${invite.label}` : ''}</span>
            </button>
          </Tip>
        )}
      </>
    );
  }

  // The offer beside the composer: a pill that exists only while that chat's turn is running.
  const offers = ({ busy } = {}) => {
    try {
      const cart = find($active.get());
      return busy && cart && $offer.get() && !onGame() ? [{ id: `${ID}.play`, label: `Play ${cart.title}`, icon: 'game', run: () => { try { open(); } catch (error) { report('offer', error); } } }] : [];
    } catch (error) { report('offers', error); return []; }
  };
  // Older Desktops have no pill strip: the same offer as a quiet link under the composer.
  function OfferLink() {
    const task = useValue(tracker.$task), offer = useValue($offer), isOpen = useValue($modal), cart = find(useValue($active));
    if (!task.busy || !offer || isOpen || onGame() || !cart) return null;
    return <Button size="sm" variant="ghost" onClick={open}>{cart.glyph || '▶'} Play {cart.title}</Button>;
  }

  const dispose = () => {
    try { stopSlot(); stopDone?.(); tracker.dispose(); } catch { /* already gone */ }
    for (const id of [...instances.keys()]) retire(id);
    try { audio.dispose(); } catch { /* already gone */ }
  };

  // The game in play is started now, so a turn already running when the plugin loads finds it ready.
  const first = current();
  return { report, Page, Chip, offers, OfferLink, open, close, dispose, $modal, $fade, $offer, $carts, $rows, $active, $off, $library, $shelf, select, setEnabled, rescan, use, tracker, sound: audio,
    // Test harness seam: the game in play at load, flattened in.
    ...(first?.debug || {}) };
}
