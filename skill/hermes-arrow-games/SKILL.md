---
name: hermes-arrow-games
description: Add, write, fork and manage games for the Hermes Arrow plugin in Hermes Desktop. Use when the user wants a new game to play while their agent works, wants to change how a bundled game plays (fork it), or asks to enable, disable, install, update or remove games in the Hermes Arrow Library. Covers the cartridges folder, cartridge.json, catalog.json, the cartridge API, and what an agent must leave alone.
version: 1.0.0
metadata:
  hermes:
    tags: [hermes-desktop, games, plugins, hermes-arrow, cartridges]
    category: gaming
---

# Hermes Arrow games

Hermes Arrow is a Hermes Desktop plugin: a small game console the user plays while their agent works. The console is fixed. The games are **cartridges**: folders of files that the console finds and loads by itself. Your work as an agent happens entirely in those folders.

## Boundaries

These keep the user's chat safe and their games intact across updates. Hold to them even when a shortcut looks easier.

- **Do not edit the plugin.** `desktop-plugins/hermes-arrow/plugin.js` is a built file that the next update replaces. It also holds the code that watches the agent's turns from inside the Desktop's send path, where a mistake can stop the user's messages from sending.
- **Do not edit the console.** If you are working in a clone of the repository, `src/console/` and `src/plugin.jsx` are the console. Changes there belong in an issue or pull request to the project, not in a local patch.
- **Do not edit a bundled game.** Bundled games (the Library marks them "Bundled") live inside `plugin.js`. To change one, **fork it** under a new folder name, then switch the original off in the catalog. The original stays available and the user's stats for it are untouched.
- **Work only inside the cartridges folder.** Create and change files in your own game folders and in `catalog.json`. Leave other people's game folders alone unless the user names them.
- **Never delete a game without being asked.** To take a game out of play, switch it off in `catalog.json`. Removing a folder also orphans its saved stats.
- **Install only games the user asked for.** A game's script runs inside Hermes Desktop with the same access as the plugin. Do not fetch a game from a source the user has not named, and read a script you did not write before installing it.
- **A cartridge never listens to the Desktop itself.** No host stores, no composer middleware, no network calls the user did not ask for. Everything a game needs comes through the `api` it is handed.

If the user asks for something these rule out (for example "just patch plugin.js"), say what it would cost them and offer the fork or the upstream route. If they still want it after that, it is their call.

## Where things are

The cartridges folder is the plugin's data folder on **the machine that runs Hermes Desktop**:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\Hermes\plugin-files\data\hermes-arrow\` |
| macOS | `~/Library/Application Support/Hermes/plugin-files/data/hermes-arrow/` |
| Linux | `~/.config/Hermes/plugin-files/data/hermes-arrow/` |

The console creates it the first time it runs and leaves a `README.txt` there; if the folder is missing, the user has not opened Hermes Arrow since installing a version with the Library (0.9.0 or later). If the paths above do not exist, search the app-data area for a `plugin-files` folder rather than guessing.

If you run on a different machine from the Desktop (a remote backend), you cannot reach this folder directly. Say so, and either use whatever route the user has set up to that machine or hand them the finished game folder to copy.

```
hermes-arrow/
  README.txt
  catalog.json                 which games are switched off
  my-game/                     one folder per custom game; the folder name is the game's id
    cartridge.json             title, description, version, cover, script name
    cartridge.js               the game
    cover.png                  optional thumbnail, 4:3
```

The user sees all of this in the game under ⚙ → **Library**: every game with its cover, title, folder name, description, a Bundled or Custom chip and an on/off switch. A folder that could not be loaded is listed there with the reason. That screen is how you and the user confirm your work.

## Managing the catalog

`catalog.json` holds one list:

```json
{ "disabled": ["hello-cartridge", "arrow"] }
```

- **Switch a game off:** add its folder name to `disabled`. Bundled games are switched off the same way, by their id (shown under the title in the Library, e.g. `arrow`).
- **Switch it on:** remove the name.
- **List what is installed:** list the folders and read each `cartridge.json`; bundled games are not on disk, so ask the user or read the Library for those.
- Read the file before writing it and keep every name you were not asked to change. Create it if it is missing. Keep it valid JSON: if it is not, the console treats every game as on and says so in the Library.
- The console always keeps at least one game on. If the list would switch everything off, the first bundled game stays on.

Changes are picked up when the user next opens the game or the Library, or within a few seconds if the Library is open. Nothing needs restarting.

## Installing or updating a game

1. Check the folder name: lowercase letters, digits and dashes, starting with a letter or digit. It must not match a bundled game's id.
2. Copy the game folder into the cartridges folder. To update, replace `cartridge.js` (and `cartridge.json` if it changed) in place; saving the file reloads the game.
3. Validate before you report success: `cartridge.json` parses and has `"contract": 2` and a `"title"`; the script it names exists; `node --check cartridge.js` passes if Node is available.
4. Tell the user to open ⚙ → Library and confirm the game is listed without a "Not loaded" line.

Keep the folder name for the life of the game: it names the game's saved stats.

## Writing a new game

Start from `templates/hello-cartridge/` in this skill: a complete game in about 110 lines of plain JavaScript with no build step.

1. Copy the template folder into the cartridges folder under the new game's name.
2. Edit `cartridge.json`: title (what the user sees), a one or two line description, version.
3. Write the game in `cartridge.js`. It default-exports `create(api)`, which returns the game: a `Stage` component (the play area), a `Bar` component (the top bar, assembled from the console's kit parts), and optional `Actions`, `Note`, `Settings`, `onKey`, `taskStarted`, `invite`, `dispose`.
4. Add a `cover.png` (4:3, around 288×216) or remove the `"cover"` line.

Read `references/cartridge-guide.md` before writing: it lists every `api` member and every kit part with its props, the sound format, and the rules. The essentials:

- The script may import **only** `react` (and `react/jsx-runtime`). No JSX in the shipped file unless you bundle it. Everything else comes from `api`.
- Build the bar, cards and settings from `api.kit`. Do not restyle them: that is what makes every game look like part of one console.
- Scoring, clock, pace and saved stats belong to the game. Save through `api.storage`.
- Size the board from `api.task().seconds`, the console's measure of how much work the agent's turn amounts to.
- Keep game state in the `create` closure, not in components. The player closes the game to read the chat and expects the board as they left it.
- Leave a board in progress alone when a new task starts.

## Forking a bundled game

Use this whenever the user wants a bundled game to behave differently.

1. Get the source: `git clone https://github.com/mechkw/hermes-arrow && cd hermes-arrow && npm install`.
2. `npm run cartridge -- fork arrow my-arrow` copies `src/cartridges/arrow` to `src/cartridges/my-arrow` and gives it its own title.
3. Make the changes in `src/cartridges/my-arrow/` only. `difficulty.js` holds the levels, `score.js` the points and pace, `voice.js` the sounds, `game.js` the rules and drawing, `core.js` the board generator, `index.jsx` the bar and cards.
4. `npm test` still passes for the parts you did not touch; then `npm run cartridge -- build my-arrow` writes `dist/cartridges/my-arrow/`.
5. Copy that folder into the cartridges folder.
6. If the fork is meant to replace the original, add the original's id to `disabled` in `catalog.json`. Tell the user that the fork starts with fresh stats.

Do not commit a fork into `src/cartridges/` of the upstream project unless the user is contributing it as a new bundled game.

## When something does not load

The Library's "Not loaded" line is the diagnosis. Common ones:

| Message | Fix |
| --- | --- |
| `no cartridge.json in this folder` | The folder is not a game, or the manifest is misnamed. |
| `cartridge.json is not valid JSON` | Fix the syntax; no comments or trailing commas. |
| `built for contract N` | Set `"contract": 2` only after checking the game against the current guide. |
| `"x" is a bundled game` | Rename the folder; a fork needs its own name. |
| `cartridge.js is missing` | The `"main"` file is not in the folder. |
| `the script imports something other than react` | Remove the import or bundle the dependency into the script. |
| `the script must default-export create(api)` | Add `export default create`. |
| `<Game> did not start` (shown on the board) | `create(api)` threw; the message is on the card. |

A game that fails is contained: the other games and the user's chat keep working. Fix the file and save; the console tries again on the next save.

## Reporting back

Say which folders you created or changed, what you set in `catalog.json`, and what the user should see in the Library. If you could not reach the Desktop's machine, or could not verify that the game loaded, say that plainly.
