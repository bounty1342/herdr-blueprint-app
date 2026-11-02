<h1 align="center">Blueprint for Herdr</h1>

<p align="center"><b>See what your coding agent is building, as a diagram, right next to it.</b></p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license">
  <img src="https://img.shields.io/badge/herdr-app%20mod-1f6feb" alt="Herdr app mod">
  <img src="https://img.shields.io/badge/agents-Claude%20Code%20%7C%20Codex%20%7C%20Gemini%20%7C%20Grok%20%7C%20OpenCode-6e40c9" alt="Claude Code, Codex, Gemini, Grok, OpenCode">
</p>

<p align="center">Using the Herdr TUI in a terminal? You want <a href="https://github.com/chappse6/herdr-blueprint">herdr-blueprint</a>, the plugin for it.</p>

<p align="center">
  <img src="docs/media/point-and-ask.gif" alt="Blueprint above Claude Code shows POST /login. The box 'argon2 verify' is picked, E opens a request box, 'lock the account for 15 minutes after 5 wrong passwords' is sent, the new boxes 'locked?', '429 locked' and 'Redis login_fail' appear in yellow while Claude Code builds them, then turn into checked boxes.">
  <br>
  <sub>Pick a box, press E, ask. Claude Code builds the change; the new boxes are yellow while it works and get a check when they do. Recorded live, the agent's minute squeezed into two seconds. (<a href="docs/media/point-and-ask.mp4">MP4</a>)</sub>
</p>

[한국어 README](README.ko.md)

Blueprint is a mod for the [Herdr](https://herdr.dev) desktop app. Your agent draws the code it is building as a Mermaid flowchart, and Blueprint shows it beside the chat while the work goes on.

- **The code at a glance.** Boxes are pieces of your code, tied to their file and line. Finished parts get a check and the part being built is yellow, so you see where the agent is without reading the chat.
- **Ask where you look.** Pick a box, press `E` and write what should change. The agent gets the box, its place in the code and your note.
- **Kept out of your repo.** Diagrams live in Herdr's app folder, one set per project and worktree, and the ones nobody looks at go away after 7 days unless you pin them.

**Requires the [Herdr desktop app](https://herdr.dev) 0.1.10 or newer · tested on macOS** (written for Windows and Linux too, not tried there yet).

## Install

Run an agent inside Herdr and ask it:

```
Add the Herdr mod from https://github.com/chappse6/herdr-blueprint-app, then open it and add its tab bar button
```

Herdr's `AGENTS.md` tells the agent what to do: copy `mods/blueprint` into your Herdr app folder and check it. By hand, copy `mods/blueprint` into the `mods` folder there (`~/.config/herdr-app/mods/` on macOS) and run `herdr-app check ~/.config/herdr-app/mods/blueprint`.

Then, from any terminal in Herdr, open it once and add the Blueprint button next to Files and Changes (recommended; from then on the button opens it):

```
herdr-app do pane.split --direction right --mod blueprint
herdr-app do blueprint.add-button
```

`herdr-app do blueprint.remove-button` takes the button away again.

## A tour

### 1. Connect your agent

The first time, Blueprint lists the agents in the tab. Pick one and Blueprint asks it to draw the code it is working on, in a folder of Blueprint's own. The diagram shows up as soon as the file is saved.

<p align="center"><img src="docs/media/connect.gif" width="560" alt="An empty Blueprint lists Claude Code; after a click it says 'Asked Claude Code to draw', and a diagram of Postgres tables and Redis keys appears."></p>

### 2. Follow a flow

Click a box and everything upstream and downstream of it stays lit; the rest fades. Drag to move, ⌘ or Ctrl + scroll to zoom, `F` to fit.

<p align="center"><img src="docs/media/flow.png" width="560" alt="The POST /token diagram with the refresh_token branch lit and the authorization_code branch faded."></p>

### 3. Point at a box and ask

With a box picked, press `E` and write the change. Blueprint types it into the agent's terminal with the box, its line in the source, the code path it stands for and the whole diagram, and asks the agent to update the drawing when it is done.

<p align="center"><img src="docs/media/ask.png" width="720" alt="A request box under the picked box rotate(refresh_token), src/tokens.ts:27, addressed to Claude Code, reading 'reject refresh tokens issued to another client'."></p>

### 4. Watch the work move

The agent marks what it is building `active` and what it is on right now `current`. Those boxes turn yellow, and while the pane has focus a dot runs along the yellow edges. When the agent starts a new diagram for a feature, Blueprint switches to it.

<p align="center">
  <img src="docs/media/progress.gif" width="420" alt="Blueprint switches to a new POST /logout diagram; its boxes are yellow and turn into checked boxes one by one as Claude Code builds the endpoint.">
  <img src="docs/media/dot.gif" width="420" alt="Close-up: yellow boxes of a planned change, the current one with a ring, and a dot running along the dashed yellow edges.">
</p>

### 5. Ask for another diagram

`+` next to the tabs asks the agent for a new diagram: the data model, one endpoint in detail, the whole project. It opens as a tab when it arrives.

<p align="center"><img src="docs/media/new-diagram.gif" width="560" alt="The + box with suggestions; 'The POST /token flow in detail' is typed and sent, a 'Drawing…' chip appears, and a new 'POST /token in detail' tab opens."></p>

### 6. Only what the code has

Agents are told to draw only what exists. Here Claude Code drew the two real Postgres tables as cylinders and the Redis keys as plain boxes, with the relations on the edges. In a project with no database it says so and draws what plays that part under its real name.

<p align="center"><img src="docs/media/data-model.png" width="720" alt="Cylinders for the users and clients tables and plain boxes for the Redis session, family, code and refresh keys, joined by 1:N edges."></p>

### 7. In the tab bar

The Blueprint button (see Install) opens Blueprint as a side panel that follows the tab you are on, and its pane icon moves it into the tab as a pane. Pin a diagram to keep it past 7 days.

<p align="center"><img src="docs/media/panel.png" width="720" alt="Herdr with Claude Code on the left and Blueprint as a side panel on the right, opened from the Blueprint button next to Files and Changes; the POST /logout tab is pinned."></p>

## Good to know

- **Agents.** Claude Code, Codex, Grok, Gemini, OpenCode and other agents Herdr knows. Requests are typed into their terminal with `hc send`.
- **Language.** English, Korean or Japanese. It follows Claude Code's `language` setting and is English otherwise (Codex, Grok and others have no such setting it reads). Pick one for good with `herdr-app do blueprint.lang-ko` (or `lang-en`, `lang-ja`; `lang-auto` to follow Claude Code again).
- **Where diagrams live.** `data/blueprint/projects/<name>-<hash>/` in Herdr's app folder: one `.mmd` file per diagram and a `project.json` for pins and the connected agent. A project is the git top level of the terminal's folder, so every worktree is its own.
- **What it runs.** `git rev-parse` to find the project, `hc send` to reach the agent, and `sips` and `osascript` for PNG export on macOS. It reads `~/.claude/settings.json` for the language. No network.
- **Platforms.** Written for macOS, Linux and Windows with no shell, Python or Node. It has been run on macOS (Herdr 0.1.10); Windows and Linux are not tested yet. PNG export is macOS only.

## FAQ

**How many more tokens does it cost?** Blueprint itself uses none; the agent does when it writes a diagram. Measured in one Claude Code session (Opus 5.5) on a 230-line project:

| What | Output tokens | Time |
|---|---|---|
| First drawing after connecting | about 3k | 30 s |
| A new diagram with `+` | about 2k | 20 s |
| A change asked with `E` (code, tests, and the diagram updated about 3 times) | 2.4k of the turn's 6.5k | 17 s of 89 s |
| A feature where you ask it to move `current` at every step | 35 to 55% of the turn | about half of it |

Updates reread the conversation, which prompt caching makes cheap but which still counts toward usage limits. Numbers change with the model, the language and the size of the diagram.

**Does it slow the agent down?** A little: each diagram update is one more step, 5 to 10 seconds in the session above. By default the agent updates after each unit of work, and only when the flow changed. If you ask it to show every step, expect the work to take about twice as long.

**Why not just ask the agent for a Mermaid diagram?** You can, and you get a map to read after the work is done. Blueprint keeps the map alive while the agent works, shows which part is being built, and lets you point at a box to have it changed.

## Contributing

Issues and pull requests are welcome. For Herdr itself, there is the [Herdr Discord](https://discord.gg/PsgRfzmUDg).

## Develop

Tests run in Node 24 or newer, with Herdr's modules stubbed: `node --import ./tests/stubs.mjs --test 'tests/*.test.mjs'`. They also run on every pull request.

`scripts/sync.sh` copies `mods/blueprint` into the Herdr app folder (Herdr doesn't reload a symlinked mod), and `--watch` copies on every change. `scripts/demo/` rebuilds the pictures on this page from a real session in a Herdr window of its own: `start.sh`, then `record.py` while you drive it, then `make.py clips.json`. `RECIPE.md` describes the mod for an agent that wants to build it from scratch.

## License

MIT
