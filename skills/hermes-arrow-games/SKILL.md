---
name: hermes-arrow-games
description: Add, write, fork and manage games for the Hermes Arrow plugin in Hermes Desktop. Use when the user wants a new game to play while their agent works, wants to change how a bundled game plays (fork it), or asks to enable, disable, install, update or remove games in the Hermes Arrow Library. Covers game plugins, the cartridge API, catalog.json, the plugin catalog's rules, and what an agent must leave alone.
version: 1.2.0
metadata:
  hermes:
    tags: [hermes-desktop, games, plugins, hermes-arrow, cartridges]
    category: gaming
---

# Hermes Arrow games

Hermes Arrow is a Hermes Desktop plugin: a small game console the user plays while their agent works. The console is fixed. Each game outside it is a **cartridge**: a small Desktop plugin of its own, in its own folder, that hands itself to the console when the Desktop loads it. Your work as an agent happens in those game folders and in one catalog file.

Games are separate plugins on purpose. The Desktop's plugin loader is the only door plugin code may come through, and the plugin catalog refuses any plugin that imports, evaluates or fetches further code (rule 8). So the console never loads a script; the Desktop does, one reviewed plugin at a time.

## Boundaries

These keep the user's chat safe, keep their games intact across updates, and keep everything inside the Desktop plugin SDK and the plugin catalog's rules. Hold to them even when a shortcut looks easier.

- **Do not edit the console plugin.** `hermes-arrow/plugin.js` (or `desktop/plugin.js` in the package) is a built file that the next update replaces. It also holds the code that watches the agent's turns from inside the Desktop's send path, where a mistake can stop the user's messages from sending.
- **Do not edit the console's source.** In a clone of the repository, `src/console/` and `src/plugin.jsx` are the console. Changes there belong in an issue or pull request to the project, not in a local patch.
- **Do not edit a bundled game.** Bundled games (the Library marks them "Bundled") live inside the console's file. To change one, **fork it** under a new id, then switch the original off in the catalog. The original stays available and the user's stats for it are untouched.
- **Work only in your own game folders and `catalog.json`.** Leave other plugins and other people's games alone unless the user names them.
- **Never delete a game without being asked.** To take a game out of play, switch it off in `catalog.json`. Removing its folder also orphans its saved stats.
- **Install only games the user asked for.** A game is a Desktop plugin and runs with the app's full authority. Do not fetch one from a source the user has not named, and read a script you did not write before installing it.
- **Stay inside the plugin SDK.** A game imports only `react` (and `react/jsx-runtime`, or `@hermes/plugin-sdk` if it truly needs it). No `eval` or `new Function`, no `import()` of anything else, no script tags, no code fetched at runtime, no reaching into the app's markup or stores, no raw `window.hermesDesktop` calls, no self-updating.
- **A game does not listen to the Desktop itself.** No host stores, no composer middleware, no network calls the user did not ask for. Everything a game needs comes through the `api` it is handed; the console already watches the agent, safely.

If the user asks for something these rule out (for example "just patch plugin.js"), say what it would cost them and offer the fork or the upstream route. If they still want it after that, it is their call on their own machine; it cannot be listed in the plugin catalog that way.

## Where things are

Everything is on **the machine that runs Hermes Desktop**. If you run somewhere else (a remote backend), you cannot reach it directly: say so, and either use whatever route the user has set up to that machine or hand them the finished folder to copy.

**Games** sit beside the console in the Desktop's plugins folder, `<HERMES_HOME>/desktop-plugins/` (usually `~/.hermes/desktop-plugins/`; on Windows often `%LOCALAPPDATA%\hermes\desktop-plugins\`):

```
desktop-plugins/
  hermes-arrow/plugin.js        the console (do not edit)
  my-game/plugin.js             one folder per game; the folder name is the game's id
```

The Desktop watches that folder: a game loads within a few seconds of its file landing and reloads on every save. No restart.

**The catalog** is one file in the console's data folder, inside the Desktop's app-data directory:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\Hermes\plugin-files\data\hermes-arrow\catalog.json` |
| macOS | `~/Library/Application Support/Hermes/plugin-files/data/hermes-arrow/catalog.json` |
| Linux | `~/.config/Hermes/plugin-files/data/hermes-arrow/catalog.json` |

The console creates that folder the first time it runs and leaves a `README.txt` in it. If the paths above do not exist, search the app-data area for a `plugin-files` folder rather than guessing.

The user sees all of this in the game under ⚙ → **Library**: every game with its cover, title, id, description, a Bundled or Custom chip and an on/off switch. Anything that could not be loaded is listed there with the reason. That screen is how you and the user confirm your work.

## Managing the catalog

`catalog.json` holds one list:

```json
{ "disabled": ["hello-cartridge", "arrow"] }
```

- **Switch a game off:** add its id to `disabled`. Bundled games are switched off the same way (their id is shown under the title in the Library, e.g. `arrow`).
- **Switch it on:** remove the id.
- **List what is installed:** list the folders in `desktop-plugins/` and look for the cartridge object in each `plugin.js` (it has `contract`, `id`, `title`). Bundled games are not on disk; read the Library or ask the user.
- Read the file before writing it and keep every id you were not asked to change. Create it if it is missing. Keep it valid JSON: if it is not, the console treats every game as on and says so in the Library.
- The console always keeps at least one game on.

A game that is switched off stays out of the game picker and is never started. Changes are picked up when the user next opens the game or the Library, or within a few seconds if the Library is open.

The Desktop's own switch (Capabilities → Plugins) is the stronger off: it unloads the game's plugin entirely. Use `catalog.json` for "don't offer this game"; tell the user about the Desktop's switch if they want the code not loaded at all.

## Installing or updating a game

1. Check the id: lowercase letters, digits and dashes. The folder name, the plugin's `id` and the cartridge's `id` must all be the same, and must not match a bundled game's id.
2. Put the game's folder in `desktop-plugins/`. To update, replace `plugin.js` in place; saving it reloads the game.
3. Validate before you report success: `node --check plugin.js` passes if Node is available; the file imports nothing but `react`; the cartridge object has `contract: 3`, `id`, `title` and `create`.
4. Tell the user to open ⚙ → Library and confirm the game is listed without a "Not loaded" line.

Keep the id for the life of the game: it names the game's saved stats.

## Writing a new game

Start from `templates/hello-cartridge/plugin.js` in this skill: a complete game in about 140 lines of plain JavaScript with no build step.

1. Copy the template folder into `desktop-plugins/` under the new game's id, and set `id` in the cartridge object to match.
2. Edit the cartridge object: `title` (what the user sees), a one or two line `description`, `version`, `glyph`.
3. Write the game in `create(api)`. It returns the game: a `Stage` component (the play area), a `Bar` component (the top bar, assembled from the console's kit parts), and optional `Actions`, `Note`, `Settings`, `onKey`, `taskStarted`, `invite`, `dispose`.
4. Replace the `cover` data URL with the game's own 4:3 image (about 288×216), or remove the line. Make one with `base64 -w0 cover.png` and the prefix `data:image/png;base64,`. A cover must be inline: the console ignores web addresses and file paths.
5. Leave the `register(ctx)` block at the bottom exactly as it is.

Read `references/cartridge-guide.md` before writing: it lists every `api` member and every kit part with its props, the sound format, and the rules. The essentials:

- No JSX in the shipped file unless you bundle it; the Desktop does not compile plugins.
- Build the bar, cards and settings from `api.kit`. Do not restyle them: that is what makes every game look like part of one console. Use theme variables (`var(--ui-*)`) for anything you draw; never hardcode colours.
- Scoring, clock, pace and saved stats belong to the game. Save through `api.storage`.
- Size the board from `api.task().seconds`, the console's measure of how much work the agent's turn amounts to.
- Keep game state in the `create` closure, not in components. The player closes the game to read the chat and expects the board as they left it.
- Leave a board in progress alone when a new task starts.
- Keep the chat visible behind the game. The player has a Transparency setting so they can watch their agent while they play; paint no full-stage background, and give filled areas `kit.surface(color)` so they thin with it. This is encouraged, not enforced: if a game truly needs a solid field, set `opaque: true` on the cartridge rather than ignoring the setting. Tell the user which you chose. Details in the guide under "Seeing the chat through the game".
- Timers and listeners a component sets up are removed in its effect's cleanup; anything longer-lived is stopped in `dispose()`.

## Forking a bundled game

Use this whenever the user wants a bundled game to behave differently.

1. Get the source: `git clone https://github.com/mechkw/hermes-arrow && cd hermes-arrow && npm install`.
2. `npm run cartridge -- fork arrow my-arrow` copies `src/cartridges/arrow` to `src/cartridges/my-arrow` and gives it its own title.
3. Make the changes in `src/cartridges/my-arrow/` only. `difficulty.js` holds the levels, `score.js` the points and pace, `voice.js` the sounds, `game.js` the rules and drawing, `core.js` the board generator, `index.jsx` the bar and cards, `cartridge.json` the title and description, `cover.png` the cover.
4. `npm test`, then `npm run cartridge -- build my-arrow` writes `dist/cartridges/my-arrow/plugin.js`, a complete Desktop plugin.
5. Copy the `my-arrow` folder into `desktop-plugins/`.
6. If the fork is meant to replace the original, add the original's id to `disabled` in `catalog.json`. Tell the user that the fork starts with fresh stats.

Do not commit a fork into `src/cartridges/` of the upstream project unless the user is contributing it as a new bundled game.

## Publishing a game to the plugin catalog

A game can be listed in the Hermes plugin catalog like any other Desktop plugin, and the same rules apply to it as to the console. Package it as `plugin.yaml` plus `desktop/plugin.js`, then run the check catalog CI runs:

```sh
hermes plugins validate /path/to/my-game
```

It must pass, including the `desktop surface` check. Two catalog rules matter especially for games: a fork is listed only when it is materially different from the original and names its origin (rule 16), and nothing may update or load code by itself (rules 3 and 8). The full rules are in the Hermes repository's `plugin-catalog/README.md`.

## When something does not load

The Library's "Not loaded" line is the diagnosis for a game the Desktop loaded but the console refused:

| Message | Fix |
| --- | --- |
| `built for contract N` | Set `contract: 3` only after checking the game against the current guide. |
| `"x" is a bundled game` | Give the fork an id of its own (folder, plugin id and cartridge id). |
| `the id must be lowercase letters, digits and dashes` | Rename it. |
| `the cartridge needs a "title"` / `create(api) is missing` | Complete the cartridge object. |
| `<Game> did not start` (shown on the board) | `create(api)` threw; the message is on the card. |

A game that is missing from the Library altogether never reached the console. Check that its folder name matches its plugin `id`, look for a Desktop toast naming a load error (`unsupported import` means it imports something other than React or the SDK), check Capabilities → Plugins, and run ⌘K / Ctrl+K → **Reload desktop plugins**.

A game that fails is contained: the other games and the user's chat keep working.

## Reporting back

Say which folders you created or changed, what you set in `catalog.json`, and what the user should see in the Library. If you could not reach the Desktop's machine, or could not verify that the game loaded, say that plainly.
