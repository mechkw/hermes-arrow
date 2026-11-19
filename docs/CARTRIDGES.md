# Writing a cartridge

Hermes Arrow is a console: it watches your agent, offers a game while it works, and frames the page, the over-the-chat modal, sound and settings. The games themselves are **cartridges**. A cartridge owns its rules, board, scoring, clock, pace and saved stats. It builds its bar and cards from the console's kit, so every game looks like part of the same machine.

This guide is everything you need to write one that drops in. The worked example is [`examples/hello-cartridge/plugin.js`](../examples/hello-cartridge/plugin.js), about 120 lines, no build step. The full-size reference is Arrow itself, [`src/cartridges/arrow/index.jsx`](../src/cartridges/arrow/index.jsx).

## How drop-in works

A cartridge is an ordinary Hermes Desktop plugin in its own folder:

```
<HERMES_HOME>/desktop-plugins/
  hermes-arrow/plugin.js        the console
  my-game/plugin.js             your cartridge
```

The Desktop watches that directory, so a cartridge loads within a few seconds of the file landing and reloads on every save. The player then finds it under ⚙ → Games, where each game can be switched on or off and chosen to play. Removing the folder, or switching the plugin off in Capabilities → Plugins, takes it out again.

Your plugin's `register` does one thing: it puts a cartridge object in the slot, a plain object on `globalThis` that the console reads.

```js
export default {
  id: 'my-game',
  name: 'My Game',
  register(ctx) {
    const slot = (globalThis.__hermesCartridges ||= {});
    const tell = () => (slot.listeners || []).forEach(fn => { try { fn(); } catch {} });
    slot.list = (slot.list || []).filter(c => c.id !== cartridge.id).concat(cartridge);
    tell();
    ctx.onDispose(() => { slot.list = (slot.list || []).filter(c => c !== cartridge); tell(); });
  }
};
```

Copy those lines as they are. The console and the cartridges may load in either order and either may be reloaded at any time; this snippet is correct in every case.

A dropped-in cartridge with the same `id` as a built-in one replaces it, so `id: 'arrow'` is how you would ship an updated Arrow without touching the console.

## The cartridge object

```js
const cartridge = {
  contract: 1,              // the version of this document you built against
  id: 'my-game',            // lowercase letters, digits, dashes; also names your storage
  name: 'My Game',          // shown in the menu and in "Play My Game"
  glyph: '◆',               // optional: one character beside the name and on the status-bar invitation
  title: 'My Game',         // optional: the modal's title, when it should differ from name
  version: '1.0.0',         // optional: shown in the menu
  description: '…',         // optional
  create(api) { return game; }
};
```

`create(api)` is called once, the first time the game is needed, and the game it returns lives until the cartridge is removed or reloaded. Keep the board and its state in that closure, not in a component: the player closes the modal to read the chat and expects the board to be as they left it.

## What `create` returns

| Member | Required | What it is |
| --- | --- | --- |
| `Stage` | yes | React component. The play area. It fills the stage; draw anything. Receives `{ modal }`. |
| `Bar` | yes | React component returning the parts on the left of the bar (a fragment of kit parts). |
| `Actions` | no | React component returning this game's buttons, on the right of the bar before sound, settings and close. |
| `Note` | no | React component shown beside "Working 1:24" while the agent is busy, e.g. "next L5". |
| `Settings` | no | React component returning rows for the settings panel (`kit.Setting`). |
| `onKey(key, event)` | no | A key was pressed over the game (`key` is lowercase). Return `true` if you used it. `m`, `[`, `]`, `-`, `=`, `+` belong to the console. |
| `taskStarted(task)` | no | The agent began a new turn. Usual response: deal a board sized to it, unless one is being played. |
| `invite(task)` | no | Returns `{ label, tip }` for the status-bar invitation: "Play · `label`". |
| `dispose()` | no | Stop timers and listeners. Called when the cartridge is removed or reloaded. |

Components may mount and unmount at any time (the page, the modal, a switch of game). Anything they set up, they tear down in their effect's cleanup.

## The `api`

| Member | What it gives you |
| --- | --- |
| `api.kit` | The parts and styles below. |
| `api.atom(value)`, `api.useValue(atom)` | A small reactive store and the hook that reads it. Keep game state in atoms so the bar and stage re-render together. |
| `api.task()` | The agent's current turn: `{ busy, seconds, elapsed, estimate, tools, subagents, count }`. `seconds` is the console's measure of how much work the turn amounts to; turn it into a level of your own. |
| `api.useTask()` | The same, as a hook. |
| `api.voice({ clips, cues, synth, combo })` | Registers your sounds and returns `{ play(name, k) }`. Volume and mute are the console's. See Sound. |
| `api.storage.get(key, fallback)`, `.set(key, value)` | Persistence, kept apart per cartridge. Your stats, level and settings go here. |
| `api.setTimeout(fn, ms)` | A timer that dies with the plugin. Returns its cancel function. |
| `api.haptic(kind)` | A tap of haptic feedback where the device has it. |
| `api.visible()` | True while your game is the one on screen. |
| `api.report(where, error)` | Record a failure. The player is told once; the chat is never affected. |
| `api.contract`, `api.version` | The contract number and the console's version. |

## The kit

Everything in the bar and on the cards comes from `api.kit`, which is how games stay visually identical. Do not restyle these; compose them.

**Bar parts**

| Part | Props | Looks like |
| --- | --- | --- |
| `Stepper` | `value, min=1, max, label, tip, compact, noun='level', onChange(n)` | `− L3 · Task +`. `compact` for the bar, without it for cards. |
| `Count` | `value, label, tip` | **28** left |
| `Pips` | `value, max, noun='lives', tip` | ■ ■ □, the last one red |
| `Clock` | `seconds: () => number, running, started, label` | 0:42. It ticks itself while `running`; dim until `started`. |
| `Pace` | `value: () => number, running, tip` | Your rate behind the brain icon, the agent's behind the robot. Polls `value` itself. |
| `Rate` | `who: 'you' \| 'agent', value, unit='t/s'` | One side of `Pace`, for use elsewhere. |
| `Streak` | `run, tip` | ×4 streak, from 2 up |
| `Tag` | `tip, color` | A small chip. `color`: `accent`, `yellow`, `red`, `green`, `muted`. |
| `Action` | `tip, label, cost, variant, disabled, onClick` | A bar button; `cost` adds a yellow note such as −5%. |

**Cards over the stage**

| Part | Props | Use |
| --- | --- | --- |
| `Card` | `label, tone` | The centred card for a win, a loss or a message. `tone="red"` for a loss. |
| `Eyebrow`, `Headline`, `Line` | `Headline: big, color` · `Line: faint` | The small capitals line, the headline (`big` for points), and text lines. |
| `Rates` | `you, agent` | Both rates side by side, as on Arrow's cleared card. |
| `Row` | | Buttons side by side. |
| `Button`, `Tip` | | The Desktop's own button and tooltip. |

**Settings rows:** `Setting({ label, value })` wrapping a `Range({ label, min, max, step, value, onChange })`, and `SettingNote` for the small print under it.

**Helpers:** `fmt(n)` (1,420), `clock(seconds)` (1:05), `rate(v)` (8.4, 62), `live(v)` (is this rate worth showing), `agentRate()` (the agent's tokens a second, 0 when unknown), `useTick(ms)` (re-render on a timer), and `S`, the shared styles (`S.fill`, `S.muted`, `S.faint`, `S.num`, `S.chip`, `S.row`).

Colours come from the Desktop theme as CSS variables: `--ui-accent`, `--ui-yellow`, `--ui-red`, `--ui-green`, `--ui-text-primary`, `--ui-text-tertiary`, `--ui-text-quaternary`, `--ui-bg-quaternary`, `--ui-bg-elevated`, `--ui-stroke-secondary`. Use them for anything you draw, and re-read them if you paint to a canvas, since the theme can change while you are open.

## Scoring, clock and pace are yours

The console keeps no score. Each cartridge decides what a point is, when its clock runs, what counts as a "token" for its pace, and what it remembers, and saves all of it through `api.storage`. Two conventions keep games comparable:

- **Pace reads as tokens a second.** Pick a conversion that puts a good player in the range an agent streams at (tens to low hundreds). Arrow counts ten tokens per grid dot uncovered; the example counts twenty per hit.
- **Report nothing for the first two seconds**, when one quick tap would read as a huge rate.

## Sound

```js
const sound = api.voice({
  clips: { ding: '<base64 audio>' },                       // optional recorded clips
  cues: {
    hit:  o => ({ clip: 'ding', rate: 1 + o.k, dur: 0.3, gain: 0.4, synth: 'hit' }),
    miss: () => ({ synth: 'miss' })                        // no clip: synthesised only
  },
  synth: { hit: (note, o) => note({ freq: 500 + 500 * o.k, dur: 0.08 }),
           miss: note => note({ freq: 140, to: 90, dur: 0.16, type: 'square' }) },
  combo: { hit: 1400 }                                     // quick repeats count up in o.step
});
sound.play('hit', progress);                               // progress 0..1 arrives as o.k
```

A cue returns which clip to play and how (`rate` is playback speed, `dur` seconds heard, `gain` 0..1). `synth` names a stand-in used until the clip has decoded, or always when there is no clip. Stay quiet when you are not on screen: a board dealt in the background for a new task should make no sound (`api.visible()`).

## Rules

1. **Stay inside `api`.** A cartridge is a real plugin and could reach the Desktop SDK directly, but do not subscribe to host stores or register composer middleware. The console already watches the agent, safely; a second listener on the host's send path can block the player's messages.
2. **Never throw at load.** `register` should do nothing but the slot snippet. Do your setup in `create`, where a failure is contained and shown as "did not start".
3. **Plain JavaScript in the shipped file.** The Desktop does not compile plugins, so no JSX in `plugin.js`: use `createElement`, or write JSX and bundle it with `react` and `react/jsx-runtime` left external.
4. **Import only `react`** (and `react/jsx-runtime`). Everything else arrives through `api`.
5. **One id, kept forever.** The id names your saved stats.
6. **Leave a board in progress alone** when a new task starts. Replace only a board nobody has touched.

## Trying it

In this repo, `npm run dev` builds the browser harness. Serve `dev/` and open `index.html?cart` to load the console with the example cartridge dropped in; the buttons at the bottom fake an agent turn. `npm run test:browser` runs the same thing headless, including a cartridge that fails to start and one built for the wrong contract.

In the Desktop, copy your folder into `desktop-plugins/` and open ⚙ → Games.

## Contract versions

This document describes contract **1**. A cartridge that states another number is refused with a message saying so. Additions that do not break existing cartridges keep the number; anything that would break one raises it.

Because the slot relies on plugins sharing a window, a future Desktop that isolates plugins from each other would need the slot moved to whatever channel it provides. The cartridge object and `api` would not change.
