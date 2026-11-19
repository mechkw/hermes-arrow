// The console: everything a game does not own. It watches the agent, offers a game while it works,
// frames the page and the over-the-chat modal, keeps sound and settings, and holds the cartridge
// slot. The game in play is a cartridge (src/cartridges, or another plugin's via slot.js); the
// console draws its bar, stage and settings inside its own frame and never looks inside it.

import { Component, useEffect, useRef, useState } from 'react';
import {
  atom, Button, Dialog, DialogContent, DialogTitle, haptic, host, Popover, PopoverContent, PopoverTrigger, Switch, Tip, useValue
} from '@hermes/plugin-sdk';
import ding from '../../assets/sfx/ding.mp3';
import tick from '../../assets/sfx/tick.mp3';
import { createAudio } from './audio.js';
import { clock, kit, S } from './kit.jsx';
import { CONTRACT, refusal, slot, watch } from './slot.js';
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
 * `builtin` is the list of cartridges shipped inside this bundle: [{ cart, prefix }]. `prefix` is put
 * before the cartridge's storage keys ('' keeps Arrow's keys where they have always been).
 */
export function createConsole(ctx, builtin) {
  const $sound = atom(true), $volume = atom(0.7), $modal = atom(false), $fade = atom(0), $offer = atom(true);
  // $carts: every cartridge on hand. $off: ids switched off in the menu. $active: the one in play.
  const $carts = atom([]), $off = atom({}), $active = atom('');
  const stored = (key, fallback) => { try { const v = ctx.storage.get(key, fallback); return v == null ? fallback : v; } catch { return fallback; } };
  const store = (key, value) => { try { ctx.storage.set(key, value); } catch { /* storage is best-effort */ } };
  let returnTo = '/';
  $sound.set(stored('sound', true) !== false);
  $volume.set(Math.max(0, Math.min(1, Number(stored('volume', 0.7)) || 0)));
  $fade.set(Math.max(0, Math.min(MAX_FADE, Number(stored('fade', 0)) || 0)));
  $offer.set(stored('offer', true) !== false);
  $off.set({ ...(stored('gamesOff', {}) || {}) });
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

  // ---- cartridges ---------------------------------------------------------------------------

  const instances = new Map(); // id -> { cart, game }
  const prefixes = new Map(builtin.map(b => [b.cart, b.prefix]));
  const find = id => $carts.get().find(c => c.id === id);
  const playable = () => $carts.get().filter(c => !$off.get()[c.id]);

  /** What a cartridge is handed. docs/CARTRIDGES.md is the reference for every member. */
  const apiFor = cart => {
    const prefix = prefixes.has(cart) ? prefixes.get(cart) : `cart.${cart.id}.`;
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
  // A cartridge that will not start still gets a slot, so the menu can show it and the player can leave it.
  const broken = (cart, error) => ({
    Bar: () => null,
    Stage: () => <kit.Card label="Game failed to start" tone="red"><kit.Headline color="red">{cart.name} did not start</kit.Headline><kit.Line>{String(error?.message || error)}</kit.Line></kit.Card>
  });
  /** The running game for a cartridge id, started on first use. */
  const use = id => {
    const cart = find(id);
    if (!cart) return null;
    const held = instances.get(id);
    if (held?.cart === cart) return held.game;
    let game;
    try { game = cart.create(apiFor(cart)); if (!game || typeof game.Stage !== 'function') throw new Error('create(api) must return an object with a Stage component'); }
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

  /** Re-read the slot: built-in cartridges, then dropped-in ones (which replace a built-in of the same id). */
  const refresh = () => {
    const byId = new Map(builtin.map(b => [b.cart.id, b.cart]));
    for (const cart of slot().list) {
      const why = refusal(cart);
      if (why) { report('slot', new Error(`A cartridge was refused (${cart?.id || 'no id'}): ${why}`)); continue; }
      byId.set(cart.id, cart);
    }
    const list = [...byId.values()];
    for (const [id, held] of [...instances]) if (byId.get(id) !== held.cart) retire(id);
    $carts.set(list);
    const want = $active.get() || stored('game', '');
    const ok = playable();
    $active.set((ok.find(c => c.id === want) || ok[0] || list[0])?.id || '');
  };
  const select = id => {
    if (!find(id) || $off.get()[id]) return;
    $active.set(id); store('game', id);
  };
  // At least one game stays on. Switching off the one in play moves to the next.
  const setEnabled = (id, on) => {
    const off = { ...$off.get() };
    if (on) delete off[id]; else off[id] = true;
    if (!$carts.get().some(c => !off[c.id])) return;
    $off.set(off); store('gamesOff', off);
    if (off[$active.get()]) select(playable()[0].id);
  };

  const tracker = createTracker({
    onError: report,
    atom, storage: { get: stored, set: store },
    busyBySession: host.state.busyBySession,
    onEvent: (type, fn) => ctx.onEvent(type, fn),
    setInterval: (fn, ms) => ctx.setInterval(fn, ms),
    onStart: task => ask('taskStarted', task)
  });
  refresh();
  // The slot calls back from another plugin's stack: defer, and never throw into it.
  const stopSlot = watch(() => { try { queueMicrotask(() => { try { refresh(); } catch (error) { report('slot', error); } }); } catch { /* could not defer */ } });

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
  const title = cart => cart?.title || cart?.name || 'Hermes Arrow';

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

  // Which games are switched on, and which one is in play. Shown once there is more than one.
  function Games() {
    const carts = useValue($carts), off = useValue($off), active = useValue($active);
    if (carts.length < 2) return null;
    return (
      <div style={{ display: 'grid', gap: 6, paddingTop: 10, borderTop: '1px solid var(--ui-stroke-tertiary)' }} role="group" aria-label="Games">
        <div style={{ ...S.faint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Games</div>
        {carts.map(cart => {
          const on = !off[cart.id], playing = cart.id === active;
          return (
            <div key={cart.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 8 }} data-cartridge={cart.id}>
              <span style={{ minWidth: 0, opacity: on ? 1 : 0.5 }}>
                <span style={{ fontWeight: 600 }}>{cart.glyph ? `${cart.glyph} ` : ''}{cart.name}</span>
                {cart.version && <span style={{ ...S.faint, ...S.num }}> {cart.version}</span>}
              </span>
              {playing ? <span style={{ ...S.chip, color: 'var(--ui-accent)' }}>Playing</span>
                : <Button size="sm" variant="outline" disabled={!on} aria-label={`Play ${cart.name}`} onClick={() => select(cart.id)}>Play</Button>}
              <Switch checked={on} onCheckedChange={next => setEnabled(cart.id, next)} aria-label={`${cart.name} on`} />
            </div>
          );
        })}
      </div>
    );
  }

  // Volume, the game's own settings, how see-through the modal is, whether the composer offers a game, and the games on hand.
  function Settings({ modal, id, game }) {
    const volume = useValue($volume), fade = useValue($fade), offer = useValue($offer);
    return (
      <Popover>
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
          <Games />
        </PopoverContent>
      </Popover>
    );
  }

  function Page({ modal = false }) {
    const root = useRef(null);
    const id = useValue($active), carts = useValue($carts), task = useValue(tracker.$task), soundOn = useValue($sound), volume = useValue($volume), fade = useValue($fade);
    const game = use(id), cart = carts.find(c => c.id === id);
    // In the see-through modal the bar sits halfway between the board's opacity and solid, so it always reads.
    const barStyle = modal && fade > 0 ? { ...S.bar, background: 'color-mix(in srgb, var(--ui-chat-bubble-background, var(--ui-bg-elevated)) 50%, transparent)' } : S.bar;
    useEffect(() => { root.current?.focus({ preventScroll: true }); }, [id]);
    const key = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'm') toggleSound(); else if (k === '[' || k === '-') setVolume(volume - 0.1); else if (k === ']' || k === '=' || k === '+') setVolume(volume + 0.1);
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
        <div style={S.stage}><Guard key={`stage.${id}.${cart?.version || ''}`} id={id} part="stage"><game.Stage modal={modal} /></Guard></div>
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
    const task = useValue(tracker.$task), isOpen = useValue($modal), cart = find(useValue($active));
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
      return busy && cart && $offer.get() && !onGame() ? [{ id: `${ID}.play`, label: `Play ${cart.name}`, icon: 'game', run: () => { try { open(); } catch (error) { report('offer', error); } } }] : [];
    } catch (error) { report('offers', error); return []; }
  };
  // Older Desktops have no pill strip: the same offer as a quiet link under the composer.
  function OfferLink() {
    const task = useValue(tracker.$task), offer = useValue($offer), isOpen = useValue($modal), cart = find(useValue($active));
    if (!task.busy || !offer || isOpen || onGame() || !cart) return null;
    return <Button size="sm" variant="ghost" onClick={open}>{cart.glyph || '▶'} Play {cart.name}</Button>;
  }

  const dispose = () => {
    try { stopSlot(); stopDone?.(); tracker.dispose(); } catch { /* already gone */ }
    for (const id of [...instances.keys()]) retire(id);
    try { audio.dispose(); } catch { /* already gone */ }
  };

  // The game in play is started now, so a turn already running when the plugin loads finds it ready.
  const first = current();
  return { report, Page, Chip, offers, OfferLink, open, close, dispose, $modal, $fade, $offer, $carts, $active, $off, select, setEnabled, use, tracker, sound: audio,
    // Test harness seam: the game in play at load, flattened in.
    ...(first?.debug || {}) };
}
