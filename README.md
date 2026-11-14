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
- Hints cost points and each costs more than the last: 5%, 10%, 15%… of the board's points (5, 15, 30, 50, 75% in total), never below 20% of the board. The Hint button shows the next price.
- A tap that lands on a blocked arrow within a quarter-cell or so of one that can leave goes to the one that can leave.

## Lives, time and points

- Lives grow with difficulty: 2 on levels 1–2, 3 on 3–4, 4 on 5–6, 5 on level 7.
- The clock starts on the first arrow you tap.
- A cleared board scores 10 per arrow, multiplied by difficulty (+25% per level), time (par is 2 s per arrow, from ×0.5 to ×2), lives kept (+10% each) and streak (+10% per consecutive win, up to +100%).
- The streak ends when a board jams, or after 36 hours without playing.
- Sounds for every part of the game, all replayed from six short clips in `assets/sfx` at different pitches and lengths: arrow leaves (climbs a scale while you keep clearing quickly), blocked, last-life warning, jam, win, streak milestone, new board, hint, preview clear / blocked, zoom, and a bell when the agent finishes. The clips are inlined into `plugin.js` as base64; a small synth stands in if they cannot decode. Re-voice the game in the `CUES` table in `src/sound.js`.

## Install

Copy `plugin.js` to `<hermes home>/desktop-plugins/hermes-arrow/plugin.js` on the machine that runs Hermes Desktop, then run **Reload desktop plugins** from ⌘K. It is a desktop-only plugin: no backend half, nothing to restart.

## Develop

```sh
npm install
npm test                 # board generator and difficulty model
npm run dev              # builds plugin.js and the browser harness in dev/
npm run test:browser     # plays the built plugin in Chromium, screenshots in test/out
```

`src/core.js` builds boards in reverse leaving order, so every board is solvable by construction. `src/difficulty.js` is the task-to-level model. `src/game.js` is rules, canvas and input with no host imports. `src/tracker.js` watches agent turns. `src/plugin.jsx` is the Hermes glue. `plugin.js` is the built file the app loads.
