# Blueprint

A pane (or tab-bar side panel) that draws what the tab's coding agent is building. The agent writes Mermaid flowcharts into Blueprint's data folder; Blueprint lays them out on a dotted canvas, marks finished boxes with a check and work in progress in yellow, and turns a click on a box into a change request typed into that agent's terminal.

![Blueprint](preview.png)

## What you see

Top to bottom, filling the pane:

1. **Header, 44px.** Left: the project's topic (first line of `topic.txt`, else the checkout's folder name), semibold, truncated; then the branch in the mono font, 11.5px, `dim`. Right: the agent pill, 24px high, fully rounded, `raised` background, holding the agent's status mark and its name (12px, `muted`, max 160px); then 28px icon buttons with 15px monochrome SVGs in `muted` (hover: `hover` background, `foreground` text; on: `accent` at 16% behind, `accent` icon): pin (`pin.svg` / `pin-on.svg`), open as pane (`pane.svg`, panel only), edit (`edit.svg`). Each has a tooltip. 1px `border` under it.
2. **Tabs row, 38px.** One tab per diagram, all the same width as in Chrome: the row's room divided by the number of tabs, at most 200px and at least 72px (12px text, 26px high, radius 6, 1px `border`; the shown one on `raised` with an `input` border and `foreground` text, others `muted`; a long title ends in "…" and the tooltip has all of it), an 11px pin icon in front of pinned ones, a bordered "Drawing…" chip while a requested diagram hasn't arrived, a 26px `+` (`plus.svg`) right after the tabs, and at the far right the shown diagram's age ("3 min ago"), 11.5px `dim`. 1px `border` under it.
3. **Canvas, the rest.** `canvas` background with a dot grid over all of it: 1.6px dots every 20px × zoom (kept between 12 and 40px), `foreground` at 11%, moving with the drawing. Boxes: rect radius 8, `( )` radius 14, `([ ])` stadium, `(( ))` circle, `[( )]` cylinder, `{ }` diamond; at least 120×52; title 12.5px semibold `foreground`, optional second line 10.5px mono `muted`; `background` fill, 1px `input` stroke. Edges are cubic béziers, 1.25px `muted` at 75% with filled arrow heads; `-.->` is dashed 4/4; labels sit on a patch of `canvas`.
4. **Footer, 40px.** Left: a hint ("Click a node to light its flow · E to edit · drag to move · ⌘/Ctrl scroll to zoom"), or the picked box's title and code path (`accent`, mono) plus "E to ask for a change here". Right: Fit, −, zoom %, +, and PNG (macOS only).

As a side panel it is a card: radius 10, 1px `border`, like Files and Changes beside it.

Status colours: done is the theme's `done`; in progress is the first of `working`, `accent`, `ansi5`, `ansi3` that is more than 60 RGB units away from `done` (so they never look alike).

With no diagram yet, a centred 440px card says "No diagram for this project yet", the project path and branch, and lists the tab's agents as 34px rows (name, terminal address in mono). With no agent in the tab: "Run an agent in this tab (Claude Code, Codex, Grok…) to connect it".

## How it behaves

- **Which project.** The tab's agents are found from `agents()` and from terminals whose program key is a known coding agent. The project is the git top level (`git rev-parse --show-toplevel`) of one agent terminal's folder: the one already followed while it stays, else the connected one, else the first. Each worktree is its own project. A pane serves the tab it was opened in (`props.tab`, else the tab shown when it is first laid out, corrected on click); the side panel serves the tab on screen. Switching tabs clears the view at once and looks the project up again.
- **Connecting.** Clicking an agent in the empty card types a draw request into it (`hc send`): the folder to save `.mmd` files in, the rules below, and a request to write the project's topic to `topic.txt`. Until a file arrives (or 10 minutes pass with the agent not working) the card says "Asked Claude Code to draw" instead of listing agents again.
- **Rules given to agents.** YAML frontmatter `title:`; labels in the person's language; `<br/>` for a second line; cylinders only for real database tables, one per table, edges labelled with the relation; draw only what the code has (no database: say so and draw what plays that part, under its real name); `%% code: <id> <path>:<line>` for each box; `class <ids> done`, `class <ids> active`, `class <id> current`; update the file in place after each unit of work.
- **Agent status** (pill in the header, same marks as Herdr's Agents list): working is `spinner.svg`, 12px, `working` colour, spinning once per 900 ms; done is a 7px `done` dot; idle is a 7px ring (`idle`); blocked is a 14px "!" on `blocked` at 15%. The status word is the tooltip.
- **Box status.** Done: stroke `done` at 80% and a check badge (16px circle × zoom, at least 12px) on the shape's top-right edge. Active or current: 2px stroke in the in-progress colour and an 11px dot badge; current adds a 28%-alpha ring around the dot. Nothing pulses.
- **Work in progress.** Edges between two in-progress boxes, plus one edge leading into each place where work begins (from a done box when there is one), are dashed and in-progress coloured (45%). While the pane has focus (the panel: while hovered) one dot per branch of that work runs along those edges, going straight under boxes, then rests 360 ms. At most 8 runs and about 40 dot positions in all. Without focus there is colour only.
- **Clicks.** A box: its whole upstream and downstream flow stays lit, the rest drops to 28% (fading 160 ms), lit edges go to 2px `foreground`. Again on it, or empty canvas: back. Drag pans; ⌘/Ctrl + scroll zooms around the pointer (20% to 300%); the view starts fitted (at most 140%) and refits when the file changes. If the other direction (LR vs TB) fits the pane at least 20% larger, it is drawn that way.
- **Keys** (also with a Korean or Japanese input source on): `E` with a box picked opens its request box, without one toggles edit mode (a click then opens the request box); `Esc` closes the request, then edit mode, then the selection; `F` fit; `0` 100%; `=`/`-` zoom; `1` to `9` tabs.
- **Request box.** 560px max, 12px above the canvas bottom, `popover` with an `accent` border at 60%: the box title and code path, a chip "→ Claude Code ⇄" that cycles the tab's agents, and an input ("What should change? e.g. add rate limiting here"). Enter sends "In Blueprint I pointed at the box …" with the box's line in the source, its `%% code` path, the note, what to do (change the code, run the tests, update the diagram file, don't use herdr-blueprint send, mark the boxes it adds or changes `active`/`current` while it works and `done` once they work) and the whole Mermaid source. The note stays if sending fails; once sent, the pick is cleared so the boxes the agent adds aren't dimmed. Opening the box in a low pane moves the drawing up until the picked box shows above it (the box is 136px tall, 12px above the canvas bottom).
- **New files.** A diagram file Blueprint hasn't seen before (the agent started one for the feature it is building) becomes the shown tab, unless a box is picked or a request is being written.
- **`+`.** The same box with "New diagram", suggestion chips (The data model, The API request flow, The whole project's structure, This feature in detail:) and a prompt naming the files not to overwrite. The new file opens as a tab when it arrives.
- **Keeping.** A file's time is when Blueprint first saw its current text, or when it was last shown, whichever is later. Unpinned files go after 7 days; past a day old, a project keeps 10. A project folder with no diagram, not opened or asked for 7 days, is removed when Blueprint starts. Folders are made only when an agent is connected or a diagram is asked for.
- **Language.** A pick made with `lang-en`, `lang-ko` or `lang-ja` (kept in shared state `blueprint.lang`, for every copy and across restarts); else Korean or Japanese when `~/.claude/settings.json` has `language` set to one of them; else English. Checked every 60 s. `lang-auto` drops the pick.
- **Open as pane** (panel only): focuses a Blueprint pane already in the tab, else splits the agent's pane to the right with `props: { tab }`, and hides the panel.
- **Tab bar button.** `herdr-app do blueprint.add-button` / `remove-button` (see Built from).

## Built from

- `mods/blueprint/`: `main.js` (the view), `mermaid.js` (flowchart subset parser: HTML and Mermaid entities in labels (`&lt;`, `&#60;`, `#lt;`) decoded; shapes above, `-->`, `-.->`, `==>`, `---`, `-.-`, `|label|`, `-- label -->`, `class`, `click id "path:line"`, `%% code:`; frontmatter title; direction LR/RL/TB/TD/BT, none means TB), `layout.js` (layered layout: dummy nodes for long edges, barycenter ordering, then each layer placed where its edges are shortest (weighted least squares, long edges' pieces weighted more) while keeping order and spacing (isotonic regression), one-to-one links straightened, ports spread per side, back edges as side arcs, cubic segments, edge labels moved along their path off other labels and boxes), `store.js` (project folders, `project.json`, retention), `setup.js` (the button), `i18n.js` (en/ko/ja text, IME key aliases ㄷ/ㄹ/い/は for E/F), SVG icons (`icon.svg`, `pin.svg`, `pin-on.svg`, `pane.svg`, `edit.svg`, `plus.svg`, `spinner.svg`), `mod.json` `{ "place": "none", "title": "Blueprint" }`.
- `herdr`: `theme`, `settings`, `agents`, `knownAgents`, `panes`, `spaces`, `focused`, `props`, `window` (platform), `shared("layout")`, `run` (`pane.split`, `pane.focus`, `layout.hide`, `mod.clone`, `layout.switch`), `hc(["send", address, text])`, `exec` (`git`; `sips`, `osascript`, `herdr-app shot` for PNG on macOS), `readTextFile`, `writeTextFile` (compare-and-swap for `project.json`), `watchFolder`, `notify`, `nextCommand`, `appHome`, `home`. `fs/promises` for `readdir`, `exists`, `mkdir`, `unlink`, `rmdir`, `readFile`, `writeFile`.
- gpui-kit: `div`, `svg`, `PathBuilder` + `window.paint_path` (grid, edges, arrows, diamond and cylinder shapes), `.frames()` (the running dot), `.spin()`, `.tooltip()`; gpui-base `v_flex`, `h_flex`, `InputState`, `Input`.
- Data: `<app home>/data/blueprint/projects/<last two path parts>-<fnv1a of path>/` with `*.mmd`, `topic.txt`, `project.json` `{ path, agent, asked, pinned, seen, files: { file: { sum, at } }, opened }`.
- The button: `mod.clone tabs → tabs-blueprint`, then in its `main.js` the panels list gets `"blueprint"`, a `panelButton("blueprint", "Blueprint", "mods/blueprint/icon.svg")` after Changes, and `syncPanel` keyed by `space.id/tab id` so the panel is per tab; `layouts/main-blueprint.json` is written from `layouts/main.json` with the `tabs` block on `tabs-blueprint` and a `panel-body` child `{ id: "blueprint", type: "block", content: { mod: "blueprint", props: { panel: true } } }`; then `layout.switch`. The layout in use before is kept in `data/blueprint/previous-layout.txt` for remove-button.

## Watch out

- Renders can be dropped ("interrupted"), most right after a reload. One host call of each kind per render; `on_size_change` redraws only on a real change; a render marks itself done at its end and a timer re-asks up to 5 times.
- `.frames()` repaints the whole window on every tick while shown (one dot at 45 ms took Herdr from ~11% to ~28% CPU), and each spot carries the whole cycle as strings: 20 spots × 37 ticks drew, 40 × 66 was dropped. Hence dots only with focus and the 40-spot budget.
- `panes()` doesn't say which Blueprint pane is this one; "the first Blueprint pane" is wrong with two. Init is no help either (a reload re-inits hidden copies).
- A Claude Code that reports no status shows as program key `claude` with `agent: false`, and `agents()` is empty then; find agents by program key too.
- Two Blueprints (panel and pane) can have one project open: write `project.json` by applying a change to what is on disk with `writeTextFile(path, text, expected)` and retry on a stale snapshot, and re-read it when the folder watch reports it. Writing your own copy back undoes the other's pin.
- There is no `stat` in `fs/promises` and no shell on Windows, so file times are recorded by content hash; normalise `\` to `/` in paths.
- `run()` only queues a command: wait for its result on disk. Don't use `layout.clone` mid-task: it switches layouts at once.
- Two identical arrow heads in one fill path cancel out (even-odd); dedupe tips.
- Placing a layer by pushing nodes apart left to right and then re-centring it diverges when a long edge crosses a branch (each pass wider; a 20-box diagram grew to 2300px at 24% zoom). Project onto order and spacing by least squares instead: it can only shorten edges.
- A symlinked mod folder doesn't hot-reload; copy files in.
- Text sizes are measured with invisible elements (one tab per render) before layout; until then they are estimated (CJK characters count as wide).
- `fs/promises` reads only inside the home folder (and writes only under the app folder): an app folder outside home (`HERDR_APP_HOME=/Users/Shared/...`) shows no diagrams. `readTextFile` reads anywhere.
- A covered or locked window isn't redrawn, and `herdr-app shot` keeps returning its last frame: record demos with the window in front.
- Not tested on Windows or Linux yet. PNG export is macOS only.

## Done when

- `herdr-app check` passes for `mods/blueprint`.
- In a tab with Claude Code in a git repo, `herdr-app do pane.split --direction right --mod blueprint` opens Blueprint listing that agent; picking it types the draw request into its terminal, and a saved `.mmd` in the project folder shows up as a tab within a second or two.
- A box marked `class x done` has a check; `class y active` has a yellow 2px stroke and the edge into it is dashed yellow; with the pane focused a dot runs along it, and without focus nothing moves.
- Clicking a box dims everything outside its flow; `E` then opens the request box, and Enter types a prompt starting "In Blueprint I pointed at the box" into the agent.
- A second Blueprint pane in another tab shows that tab's project, not the first one's.
- Pinning in one Blueprint and reloading the project in another keeps the pin in `project.json`.
- Visiting tabs without connecting creates no folder under `data/blueprint/projects/`.
- A new `.mmd` saved by the agent while nothing is picked becomes the shown tab.
- `herdr-app do blueprint.add-button` adds a Blueprint button after Changes and switches to `main-blueprint`; `remove-button` returns to the previous layout and deletes `main-blueprint.json` and `mods/tabs-blueprint`.
