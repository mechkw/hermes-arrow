# Writing a cartridge

Hermes Arrow is a console: it watches your agent, offers a game while it works, and frames the page, the over-the-chat modal, sound, settings and the Library. The games themselves are **cartridges**. A cartridge owns its rules, board, scoring, clock, pace and saved stats. It builds its bar and cards from the console's kit, so every game looks like part of the same machine.

This guide is the reference for writing one. The worked example is [`templates/hello-cartridge`](../templates/hello-cartridge/cartridge.js), about 110 lines with no build step. The full-size reference is Arrow itself, [`src/cartridges/arrow`](../../../src/cartridges/arrow/index.jsx). [`SKILL.md`](../SKILL.md) covers installing, forking and managing the catalog.

## A cartridge is a folder

```
<cartridges folder>/
  catalog.json
  my-game/
    cartridge.json
    cartridge.js
    cover.png
```

The cartridges folder is the plugin's data folder on the machine running Hermes Desktop: `plugin-files/data/hermes-arrow/` inside the app's data directory (`%APPDATA%\Hermes` on Windows, `~/Library/Application Support/Hermes` on macOS, `~/.config/Hermes` on Linux). The console reads it when it loads, when the game is opened, and every few seconds while the Library is open. A folder with a valid manifest and script becomes a game; anything else is listed in the Library with the reason it was not loaded. Saving the script reloads the game.

The **folder name is the game's id**. It is lowercase letters, digits and dashes, it names the game's saved stats, and it cannot be the id of a bundled game: to change a bundled game, fork it under a new name and switch the original off.

### cartridge.json

```json
{
  "contract": 2,
  "title": "My Game",
  "description": "One or two lines for the Library.",
  "version": "1.0.0",
  "glyph": "◆",
  "cover": "cover.png",
  "main": "cartridge.js"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `contract` | yes | The version of this guide the game was built against. Currently `2`. |
| `title` | yes | The name shown in the Library, the game picker and "Play My Game". Up to 40 characters. |
| `description` | no | Shown in the Library, clamped to two lines. Up to 240 characters. |
| `version` | no | Shown beside the folder name. |
| `glyph` | no | One character used on the status-bar invitation, and as the thumbnail when there is no cover. |
| `cover` | no | An image file in the folder (png, jpg, webp, gif, svg), shown at 72×54. Use 4:3, around 288×216. |
| `main` | no | The script, a `.js` file in the folder. Defaults to `cartridge.js`. |

### cartridge.js

An ES module whose default export is `create(api)`:

```js
import { createElement as h, Fragment } from 'react';

function create(api) {
  // game state lives here
  return { Stage, Bar /* , Actions, Note, Settings, onKey, taskStarted, invite, dispose */ };
}
export default create;
```

It may import `react` and `react/jsx-runtime` and nothing else; the console supplies both. The file is loaded as written, so it must be plain JavaScript: use `createElement`, or write JSX and bundle it with those two left external (`npm run cartridge -- build <name>` in the repository does exactly that for a game in `src/cartridges/`).

`create(api)` is called once, the first time the game is needed, and the game it returns lives until the folder is removed, switched off, or its script is saved again. Keep the board and its state in that closure, not in a component: the player closes the modal to read the chat and expects the board to be as they left it.

### catalog.json

```json
{ "disabled": ["my-game"] }
```

The Library's switches write this file, and editing it by hand or by agent has the same effect. A game that is switched off is not loaded at all and does not appear in the game picker. At least one game always stays on.

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
| `dispose()` | no | Stop timers and listeners. Called when the game is removed, switched off or reloaded. |

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

1. **Stay inside `api`.** Do not reach for the Desktop's SDK, its globals or its stores, and do not register anything with the host. The console already watches the agent, safely; a second listener on the host's send path can block the player's messages.
2. **Import only `react`** (and `react/jsx-runtime`). Everything else arrives through `api`.
3. **Plain JavaScript in the shipped file.** No JSX unless you bundle it.
4. **Do your setup in `create`.** A failure there is contained and shown as "did not start". Code at the top level of the script runs when the Library loads the game, so keep it to constants and functions.
5. **One folder name, kept forever.** It names your saved stats.
6. **Leave a board in progress alone** when a new task starts. Replace only a board nobody has touched.
7. **Do not modify the console or a bundled game.** Fork the game under a new name and switch the original off; send console changes upstream.

## Trying it

In the repository, `npm run dev` builds the browser harness in `dev/`. It has an in-memory cartridges folder: `window.files.put('my-game/cartridge.json', text)` and `window.files.put('my-game/cartridge.js', text)` in the page console drop a game in, and the buttons at the bottom fake an agent turn. `npm run test:browser` runs the whole thing headless, including a fork of Arrow, a game that fails to start, one built for an old contract and one with a bad import.

In the Desktop, copy your folder into the cartridges folder and open ⚙ → Library.

## Contract versions

This guide describes contract **2**. A game whose manifest states another number is listed in the Library as not loaded, with a message saying so. Additions that do not break existing games keep the number; anything that would break one raises it. (Contract 1 was a short-lived form in which each game was a Desktop plugin of its own.)
