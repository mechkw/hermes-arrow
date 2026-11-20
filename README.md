# Hermes Arrow

An arrow-escape puzzle for Hermes Desktop, for the time your agent spends working.

Every arrow is a snake on a grid. Tap one and it slides out head-first, as long as nothing sits between its head and the edge of the board. Tap one that is blocked and you lose a life (two on the smallest boards, five on the largest). Clear the board.

The board you are dealt scales with the task you gave the agent.

## How difficulty follows the task

| Signal | When | Effect |
| --- | --- | --- |
| The prompt | As you send it | Length, attachments and words like "refactor", "audit", "every" raise the estimate; "thanks" or a short question lowers it. |
| Your history | As you send it | The estimate is anchored on the median length of your last 40 turns, kept in plugin storage. |
| The work itself | While it runs | Elapsed time, tool calls and subagents. When the task outgrows the estimate, the next board is bigger. |

The larger of estimate and live work picks one of seven levels, from a 6×6 "Blink" (about 15 seconds) to a 40×40 "Odyssey" (about six minutes). Clear a board while the agent is still going and the next one is dealt at whatever level the task has reached. When the agent finishes, a banner says so and takes you back to the chat; the board stays if you want to finish it.

With no task running it is free play at a level you pick.

The prompt is read on your machine by a pass-through composer hook, used for that estimate, and not stored or sent anywhere. Only turn durations are kept.

## Where it shows up

- A **Play Arrow** pill above the composer while that chat's turn is running (`composer.microActions`; on a Desktop without the pill strip, a link in `composer.underside`). Nothing opens until you click it.
- The pill, the **Play · L4** status-bar chip (after a few busy seconds) and **⌘K → Hermes Arrow: Play** open the game as a modal over the chat, so the agent stays in view. Closing it keeps the board.
- **Sidebar → Arrow** is the full-page version.
- ⚙ in the game's header: volume, modal transparency (0–80%), and a switch for the composer offer.

## Controls

- **Tap** an arrow to send it off. **Hold** one to preview its path: green to the edge if it is clear, red up to whatever blocks it. A preview costs nothing.
- **Double-click** the board to step through three zoom levels (fit, 1.75×, 3×). **Drag** to move a zoomed board. Scroll and pinch also zoom.
- Keys: `H` hint, `R` restart, `F` fit, `M` mute, `[` / `]` volume, `N` new board (free play).
- Mute (♪) stays in the header; the volume slider is under ⚙. The level is remembered, and moving it un-mutes.
- `−` / `+` around the level in the top bar (and on the cleared and jammed cards) deal a board at another level at any time. During a task that overrides the level chosen for it until the next task starts.
- Difficulty handicap under ⚙, from Much easier to Much harder. It keeps the level and board size and changes how the board is built: harder steps leave fewer arrows free at any moment and add more long arrows. Each step is also one life fewer or more and points ×1.15 or ×0.85.
- In the see-through modal the top bar is always halfway between the board's opacity and solid.
- Hints cost points and each costs more than the last: 5%, 10%, 15%… of the board's points (5, 15, 30, 50, 75% in total), never below 20% of the board. The Hint button shows the next price.
- A tap that lands on a blocked arrow within a quarter-cell or so of one that can leave goes to the one that can leave.

## Pace

The top bar shows your speed in your agent's unit. Every grid dot you uncover counts as ten tokens, so `84 t/s` means 8.4 dots a second. Beside it is the agent's own rolling tokens per second for the chat in view, when the Desktop reports it: a brain icon in the accent colour for you, a robot in the normal text colour for the agent. The cleared card repeats both and the all-time line keeps your best t/s.

## Games are cartridges

The plugin is a console with games plugged into it. Arrow is bundled. Any other game is a cartridge: a small Desktop plugin of its own, in its own folder beside this one, that hands itself to the console when the Desktop loads it. The console never loads code itself, which keeps it inside the Desktop plugin SDK and the plugin catalog's rules.

⚙ → **Library** lists every game with its cover, title, id, description, a Bundled or Custom chip and an on/off switch, and says why anything could not be loaded. Games that are switched off stay out of the way; the settings panel only offers the ones that are on. The switches are kept in a `catalog.json` that a person or an agent can edit.

A cartridge owns its rules, scoring, clock, pace and stats, and builds its bar from the console's parts so every game looks the same. To change a bundled game, fork it (`npm run cartridge -- fork arrow my-arrow`, then `build`) and switch the original off rather than editing it.

The package bundles an agent skill, [`hermes-arrow:hermes-arrow-games`](skills/hermes-arrow-games/SKILL.md), for all of this: writing a game, forking one, managing the catalog, and the rules for what an agent should leave alone. It contains the [cartridge guide](skills/hermes-arrow-games/references/cartridge-guide.md) and a [complete example game](skills/hermes-arrow-games/templates/hello-cartridge/plugin.js).

## What it reads and stores

- **Your outgoing prompt, locally.** A composer middleware reads the text of each message you send to estimate how long the agent will work. The draft passes through unchanged; the text is not stored and nothing leaves your machine.
- **The agent's busy state and token rate**, from the Desktop's own state, to time turns and show the pace readout.
- **Stored in the plugin's own storage:** the last 40 turn durations, your game stats and settings.
- **One file:** `catalog.json` (and a `README.txt`) in the plugin's data folder, through the Desktop's `ctx.files` door.
- **No network calls, no telemetry, no shell commands, no credentials.** It imports only the plugin SDK and React, loads no other code and never updates itself.

## Boards

Every board is generated at random and is always solvable; there are no stored puzzles. The generator packs the silhouette, lays a few arrows one to two board lengths long, and builds bottlenecks: stretches where only one or two arrows can leave, usually because a long arrow is held by a small nest of short ones. Higher levels and harder handicaps make those stretches longer.

## Lives, time and points

- Lives grow with difficulty: 2 on levels 1–2, 3 on 3–4, 4 on 5–6, 5 on level 7.
- The clock starts on the first arrow you tap.
- A cleared board scores 10 per arrow, multiplied by difficulty (+25% per level), time (par is 2 s per arrow, from ×0.5 to ×2), lives kept (+10% each) and streak (+10% per consecutive win, up to +100%).
- The streak ends when a board jams, or after 36 hours without playing.
- Sounds for every part of the game, all replayed from six short clips in `assets/sfx` at different pitches and lengths: arrow leaves (climbs a scale while you keep clearing quickly), blocked, last-life warning, jam, win, streak milestone, new board, hint, preview clear / blocked, zoom, and a bell when the agent finishes. The clips are inlined into `plugin.js` as base64; a small synth stands in if they cannot decode. Re-voice the game in `src/cartridges/arrow/voice.js`.

## Install

The repository is a Hermes plugin package (`plugin.yaml`, `desktop/plugin.js`, and an `__init__.py` whose only job is to register the bundled skill), so `hermes plugins install mechkw/hermes-arrow` installs both halves; enable it, then switch on its Desktop half under Capabilities → Plugins.

For the game alone, copy `desktop/plugin.js` to `<hermes home>/desktop-plugins/hermes-arrow/plugin.js` on the machine that runs Hermes Desktop and run **Reload desktop plugins** from ⌘K. Nothing to restart.

`hermes plugins validate .` is the check the plugin catalog's CI runs; it passes, and `npm test` repeats its Desktop rules on every run.

## Develop

```sh
npm install
npm test                 # board generator and difficulty model
npm run dev              # builds desktop/plugin.js and the browser harness in dev/
npm run test:browser     # plays the built plugin in Chromium, screenshots in test/out
```

The source is in two halves:

- `src/console/` is everything a game does not own: `tracker.js` watches agent turns, `effort.js` turns a turn into seconds of work, `audio.js` is the sound engine, `kit.jsx` is the bar, card and settings parts, `catalog.js` is the slot games arrive through and the catalog file, and `console.jsx` frames the page, modal, settings and Library.
- `src/cartridges/arrow/` is the game: `core.js` builds boards in reverse leaving order, so every board is solvable by construction; `difficulty.js` maps work to a level; `game.js` is rules, canvas and input; `score.js` is points and pace; `voice.js` is its sounds; `index.jsx` puts them together as a cartridge.

`src/plugin.jsx` plugs the console into the Desktop, and `desktop/plugin.js` is the built file the app loads.
