// Blueprint: an agent's Mermaid flowchart drawn natively in a pane.
//
// Colour means status only (working = in progress, done = finished, the rest
// neutral), from theme() tokens. Yellow is the work in progress: its nodes,
// the edge that leads into it and the edges inside it. While this pane has
// focus a dot runs through that part, one per line of work; otherwise nothing
// moves (a running dot keeps the whole window repainting: ~11% -> ~28% CPU).
// Click a node: its upstream and downstream
// flow stays lit. Edit mode (e): click a node, say what should change, and it
// goes to the agent in this tab as "In Blueprint I pointed at ...", the same
// request the terminal Blueprint sends. Drag or scroll to move, Ctrl/Cmd+scroll
// to zoom. The layout turns top-to-bottom when that fits the pane better.
//
// It runs as a pane (pane.split {mod: "blueprint"}) or as a side panel next to
// Files and Changes (props {panel: true}, see scripts/add-button.sh). As a
// panel it serves the tab on screen, and its dot runs while the pointer is on it.
//
// What it shows are the diagrams of the project the tab's terminal is in (its
// git checkout, so each worktree has its own), kept in the app's data folder
// by store.js: each *.mmd file there is one tab, redrawn when the agent saves
// it. With none yet, it offers the agents in the tab; picking one connects it
// and asks it to draw.
//
// Commands (keys.json or `herdr-app do blueprint.<name>`):
//   fit, zoom-in, zoom-out, zoom-100, export, clear, tab-1..9, select-<node id>,
//   edit, compose-<node id>, note-<text, _ for spaces>, send, cancel, target-<terminal>,
//   connect-<terminal>, pin, pane, new

import { View, div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, settings, agents, panes, spaces, focused, props as given, knownAgents, exec, hc, run, home, notify, readTextFile, watchFolder, nextCommand } from "herdr";
import { parseFlowchart } from "./mermaid.js";
import { layout, at } from "./layout.js";
import { checkoutOf, projectDir, hasDir, readMeta, writeMeta, load, pruneAll, KEEP_DAYS } from "./store.js";
import { text, pickLang, KEY_ALIASES } from "./i18n.js";

const MOD = "blueprint";
const HEADER_H = 44, TABS_H = 38, FOOTER_H = 40;
const TITLE = 12.5, SUB = 10.5, LABEL = 11; // text px at 100%
const ZMIN = 0.2, ZMAX = 3, ZFIT_MAX = 1.4;
// The dot: built from still spots along its route, each showing "●" on its
// own tick of a shared native clock (.frames), so no timer redraws anything.
// Each spot carries the whole cycle as a list of strings, and those lists cost
// the render: about 20 spots x 37 ticks drew fine, 40 x 66 and 48 x 65 were
// dropped. So a flow gets a bounded number of spots, and spots that would sit
// under a node box are not built at all (their ticks still pass).
const FLOW_MS = 45; // per spot
const FLOW_SPOTS = 16; // at most, per run
const FLOW_GAP = 6; // px between spots, at least
const FLOW_REST = 360; // ms after each run
const APPS = { "claude-code": "Claude Code", codex: "Codex", pi: "Pi", gemini: "Gemini", opencode: "OpenCode", grok: "Grok", amp: "Amp" };
// Program keys of coding agents. A Claude Code that reports no status still
// shows as program "claude" with agent: false, so the key decides; knownAgents()
// adds whatever programs.json lists.
const AGENT_KEYS = ["claude", "codex", "gemini", "opencode", "pi", "grok", "amp", "cursor-agent", "aider", "goose", "qwen", "crush", "droid", "copilot"];

const alpha = (c, a) => c.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const distance = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
const clamp = (z) => Math.min(ZMAX, Math.max(ZMIN, z));
const wide = (ch) => ch.codePointAt(0) > 0x2e80;
const estimate = (s, px) => [...(s ?? "")].reduce((w, ch) => w + px * (wide(ch) ? 1 : 0.6), 0);

// In progress and finished must look different even when a theme gives
// `working` and `done` the same colour.
function palette(t) {
  const active = [t.working, t.accent, t.ansi5, t.ansi3].find((c) => c && distance(c, t.done) > 60) ?? t.working;
  return { active, done: t.done };
}

function nodeSize(n, m) {
  switch (n.shape) {
    case "diamond": return { w: Math.max(2 * m.w + 28, 110), h: Math.max(2 * m.h + 22, 70) };
    case "circle": { const d = Math.max(m.w, m.h) + 40; return { w: d, h: d }; }
    case "cylinder": return { w: Math.max(m.w + 44, 120), h: m.h + 42 };
    case "stadium": return { w: Math.max(m.w + 56, 120), h: Math.max(m.h + 26, 52) };
    default: return { w: Math.max(m.w + 40, 120), h: Math.max(m.h + 26, 52) };
  }
}

const minutesSince = (ts) => Math.floor((Date.now() - ts) / 60000);

const inProgress = (n) => n?.status === "active" || n?.status === "current";

// `text` in a code fence longer than any backtick run inside it.
function fenced(text, lang) {
  const n = Math.max(3, ...(text.match(/`+/g) ?? []).map((r) => r.length + 1));
  return `${"`".repeat(n)}${lang}\n${text.replace(/\n+$/, "")}\n${"`".repeat(n)}`;
}

function inline(text) {
  text = text.trim();
  if (!text.includes("`")) return `\`${text}\``;
  const f = "`".repeat(Math.max(...text.match(/`+/g).map((r) => r.length)) + 1);
  return `${f} ${text} ${f}`;
}

// What a request from edit mode says: the box, where it is in the source, the
// code it stands for, the person's note and what to do. Same wording as the
// terminal Blueprint's point_prompt, so the Blueprint skill knows it.
// The diagram lives in a file the agent saves (see drawPrompt), so the
// "send it back" step is: update that file.
function pointPrompt(G, n, note, path) {
  const label = [n.title, n.sub].filter(Boolean).join(" ");
  const where = n.line ? `, line ${n.line}: ${inline(n.lineText)}` : "";
  const stands = n.ref ? ` It stands for \`${n.ref}\`.` : "";
  const work = "Make this change in the code there and anything that depends on it, run the tests, then ";
  const todo = n.ref ? `${work}update the diagram in \`${path}\`.` : `Change it and anything it describes, then update the diagram in \`${path}\`.`;
  const text = `In Blueprint I pointed at the box "${label}" in the diagram you sent ('${G.g.title ?? G.tab}')${where}.${stands}\n${note}\n${todo}\n${fenced(G.src, "mermaid")}\n`;
  return clean(text);
}

const clean = (text) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
const LANG_NAMES = { en: "English", ko: "Korean", ja: "Japanese" };

// What a newly connected agent is asked: draw the code it is building into a
// file of this project's folder, keep it current, mark the work in progress.
// How a Blueprint diagram is written, for every request that asks for one.
function diagramRules(lang) {
  return `- Start the file with YAML frontmatter: \`title: ...\`. Write the labels in ${LANG_NAMES[lang] ?? "English"}; a box can carry a second line with \`<br/>\` (e.g. the class, route or columns).
- Blueprint draws Mermaid flowcharts only. For a database, draw one cylinder box per table (\`users[("users<br/>id · email")]\`) and label the edges with the relation (\`-->|1:N|\`).
- Every box is a piece of the code, not a step of your task. Tie each box to it: \`%% code: <node id> <path>:<line>\`.
- Mark progress: \`class <ids> done\` for finished parts, \`class <ids> active\` for work in progress, \`class <id> current\` for what you are on right now.
- After each unit of work, update that file in place (change only what changed). Skip it when the flow did not change. Diagrams nobody uses for ${KEEP_DAYS} days are deleted.`;
}

function drawPrompt(dir, lang) {
  return clean(`Blueprint (the Herdr app panel) is now connected to you for this project. Draw the code you are working on as a Mermaid flowchart and save it as a .mmd file in \`${dir}/\` (the folder exists; one file per diagram, a short kebab-case name such as \`auth-flow.mmd\`). Blueprint shows it as soon as it is saved.
- Also write the project's main topic, one short line in ${LANG_NAMES[lang] ?? "English"}, to \`${dir}/topic.txt\`: Blueprint's header shows it above the diagrams, whose titles name the part each one covers.
${diagramRules(lang)}
`);
}

// The + in the tab row: another diagram of this project, about what the
// person asked, as a new file next to the others.
function newPrompt(dir, request, lang, files) {
  const taken = files.length ? ` Don't overwrite ${files.map((f) => `\`${f}\``).join(", ")}.` : "";
  return clean(`In Blueprint I asked for a new diagram of this project: ${request}
Look at the code it is about, draw it as a Mermaid flowchart and save it as a new .mmd file in \`${dir}/\` (a short kebab-case name).${taken} Blueprint opens it as a new tab as soon as it is saved.
${diagramRules(lang)}
`);
}

const EMPTY = { nodes: new Map(), edges: [], title: null, dir: "LR" };
const ASK_WAIT = 10 * 60000; // how long an unanswered draw request holds the list back

export default class Blueprint extends View {
  init(props, cx) {
    // A layout block's props come through props(); init's argument did not
    // carry them for the panel, which then served the tab of a Blueprint pane.
    this.inPanel = !!(given()?.panel ?? props?.panel);
    // A pane's own tab. panes() doesn't say which Blueprint pane is this one,
    // and with two of them "the first" was the other's. So: the tab given when
    // it was opened from the panel, else the tab on screen when this pane is
    // laid out (a pane is only laid out while its tab shows; init is no good,
    // since a reload re-inits hidden copies too), and a click in the pane
    // checks it again (see ownPane). Until then it serves nothing.
    if (!this.inPanel) this.ownTab = given()?.tab ?? null;
    this.tab = 0;
    this.graphs = []; // the project's diagrams: { key (file), rev, tab, src, g, loaded, pinned }
    this.views = {}; // per diagram file: {z, x, y} once moved by hand; none means fit
    this.dirs = {}; // per diagram file: the direction last drawn
    this.measured = {}; // "n:<file@rev>:<id>" / "e:<file@rev>:<index>" -> {w, h} at 100%
    this.vers = {}; // per file@rev, bumped when its text is measured
    this.cache = new Map();
    this.project = null; // { path, dir, meta, name }
    this.useLang("en");
    // Follow Claude Code's language, and look again now and then.
    const follow = (cx) => cx.spawn(async (cx) => {
      if (this.langForced) return;
      try {
        const raw = await readTextFile(`${home()}/.claude/settings.json`);
        const lang = pickLang(raw ? JSON.parse(raw).language : null);
        if (lang !== this.lang) {
          this.useLang(lang);
          this.redraw(cx);
        }
      } catch (_) {}
    });
    follow(cx);
    cx.timer.every(60000, (cx) => follow(cx));
    this.size = null; // canvas, logical px
    this.width = 0; // whole view
    this.selected = null;
    this.hovered = null;
    this.drag = null;
    this.bounds = null; // this view in the window, from pointer events (PNG crop)
    this.exporting = false;
    this.editing = false; // edit mode: a click opens the composer
    this.compose = null; // { id }: the node a request is being written for
    this.target = null; // a terminal address chosen over the default agent
    this.typing = false;
    this.sending = false;
    // The placeholder is drawn by hand (an InputState's can't change), so it
    // follows the language.
    this.input = InputState.new();
    this.noteEmpty = true;
    this.input.on("change", (_e, cx) => { this.noteEmpty = !this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.send(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.focus = cx.focus_handle();
    this.agentKeys = new Set(AGENT_KEYS);
    cx.spawn(async (cx) => {
      try {
        for (const a of await knownAgents()) this.agentKeys.add(a.key);
        cx.notify();
      } catch (_) {}
    });
    cx.timer.every(30000, (cx) => cx.notify()); // "N min ago"
    // Which project: render notes the tab's terminal folder; this picks it up
    // (git and file reads are async, which a render can't wait for).
    cx.timer.every(700, (cx) => this.syncProject(cx));
    cx.spawn(async () => {
      try {
        await pruneAll();
      } catch (_) {}
    });
    cx.spawn(async (cx) => {
      for (;;) {
        this.command(await nextCommand(), cx);
        this.redraw(cx);
      }
    });
  }

  // The host sometimes drops a render ("interrupted"); the pane then keeps the
  // last good frame under an error bar until a later render goes through. It
  // happens most right after a reload, a resize or a new tab. A dropped render
  // leaves nothing behind, so a render marks itself done only at its end, and
  // until one does, keep asking (a few times, backing off).
  useLang(lang) {
    this.lang = lang;
    this.T = text(lang);
  }

  // --- project -------------------------------------------------------------

  syncProject(cx) {
    if (!this.ctxPending || this.syncing) return;
    this.ctxPending = false;
    this.syncing = true;
    cx.spawn(async (cx) => {
      try {
        await this.openProject(this.ctxCwd, cx);
      } catch (_) {}
      this.syncing = false;
    });
  }

  async openProject(cwd, cx) {
    const path = cwd ? await checkoutOf(cwd) : null;
    if (path === (this.project?.path ?? null)) {
      this.loading = false;
      return this.redraw(cx);
    }
    this.watchGen = (this.watchGen ?? 0) + 1; // stops the old folder's watch
    if (!path) {
      this.project = null;
      this.setDiagrams([]);
      this.loading = false;
      return this.redraw(cx);
    }
    // Only a project Blueprint has been used for has a folder: following tabs
    // (a hidden panel follows them too) must not leave one behind for every
    // tab it passes. Connecting or asking for a diagram makes it.
    const dir = projectDir(path);
    const known = await hasDir(dir);
    const meta = await readMeta(dir, path);
    if (known) {
      meta.opened = Date.now();
      await writeMeta(dir, meta);
    }
    this.project = { path, dir, meta, name: path.split("/").filter(Boolean).pop() ?? path };
    await this.reload(cx);
    this.loading = false;
    this.redraw(cx);
    if (known) this.watch(cx);
  }

  // Redraw when the project's folder changes (the agent saved a diagram). One
  // watch per project at a time; a newer project stops it.
  watch(cx) {
    const p = this.project, gen = this.watchGen;
    if (!p || this.watching === `${gen}:${p.dir}`) return;
    this.watching = `${gen}:${p.dir}`;
    cx.spawn(async (cx) => {
      for (;;) {
        let changed;
        try {
          changed = await watchFolder(p.dir);
        } catch (_) {
          return;
        }
        if (gen !== this.watchGen) return;
        // Blueprint's own bookkeeping (project.json) is not news.
        if (changed.every((f) => f.endsWith("project.json"))) continue;
        await this.reload(cx);
      }
    });
  }

  async reload(cx) {
    const p = this.project;
    if (!p) return;
    const items = await load(p.dir, p.meta);
    // The project's big topic, if the agent wrote one (first line of topic.txt).
    const topic = (await readTextFile(`${p.dir}/topic.txt`))?.split("\n")[0].trim();
    if (p !== this.project) return;
    p.topic = topic || null;
    this.setDiagrams(items);
    this.markSeen(cx);
    this.redraw(cx);
  }

  // Files in a stable order (by name); a changed file gets a new rev, which
  // re-measures it and starts its view from fit. The shown one stays shown,
  // else the most recently updated one is.
  setDiagrams(items) {
    const before = new Map(this.graphs.map((d) => [d.key, d]));
    const shown = this.graphs[this.tab]?.key;
    this.graphs = [...items].sort((a, b) => a.file.localeCompare(b.file)).map((f) => {
      const old = before.get(f.file);
      const rev = !old ? 0 : old.src === f.src ? old.rev : old.rev + 1;
      if (old && rev !== old.rev) delete this.views[f.file];
      const g = old && rev === old.rev ? old.g : parseFlowchart(f.src);
      return { key: f.file, rev, src: f.src, g, tab: g.title ?? f.file.replace(/\.mmd$/, ""), loaded: f.mtime, pinned: f.pinned };
    });
    const newest = items[0]?.file;
    const i = this.graphs.findIndex((d) => d.key === shown);
    this.tab = i >= 0 ? i : Math.max(0, this.graphs.findIndex((d) => d.key === newest));
    // The diagram asked for with + has arrived: show it.
    const ask = this.expectNew;
    if (ask && Date.now() - ask.since > ASK_WAIT) this.expectNew = null;
    const arrived = ask && this.graphs.findIndex((d) => !ask.known.has(d.key));
    if (ask && arrived >= 0) {
      this.tab = arrived;
      this.expectNew = null;
    }
    if (this.selected && !this.graph.nodes.has(this.selected)) this.selected = null;
    if (this.compose && !this.graph.nodes.has(this.compose.id)) this.compose = null;
  }

  // Looking at a diagram keeps it: its "seen" time pushes back the deletion.
  markSeen(cx) {
    const p = this.project, d = this.graphs[this.tab];
    if (!p || !d || Date.now() - (p.meta.seen[d.key] ?? 0) < 60000) return;
    p.meta.seen[d.key] = Date.now();
    cx.spawn(async () => {
      try {
        await writeMeta(p.dir, p.meta);
      } catch (_) {}
    });
  }

  togglePin(cx) {
    const p = this.project, d = this.graphs[this.tab];
    if (!p || !d) return;
    const pinned = new Set(p.meta.pinned);
    if (pinned.has(d.key)) pinned.delete(d.key);
    else pinned.add(d.key);
    p.meta.pinned = [...pinned];
    d.pinned = pinned.has(d.key);
    cx.spawn(async () => {
      try {
        await writeMeta(p.dir, p.meta);
      } catch (_) {}
    });
  }

  // Connect an agent to this project and ask it to draw.
  connect(target, cx) {
    const p = this.project;
    if (!p || !target) return;
    p.meta.agent = target.address;
    p.meta.asked = Date.now();
    this.target = null;
    cx.spawn(async (cx) => {
      try {
        await writeMeta(p.dir, p.meta);
        this.watch(cx);
        const r = await hc(["send", target.address, drawPrompt(p.dir, this.lang)]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `hc send ${r.code}`).trim());
        notify({ title: this.T.asked(target.name), body: p.path, level: "success", timeout: 4000 });
      } catch (err) {
        p.meta.asked = 0;
        notify({ title: this.T.sendFailed, body: String(err?.message ?? err), level: "error" });
      }
      this.redraw(cx);
    });
  }

  // Asked and not answered yet: kept in project.json, so leaving the tab or
  // reloading doesn't bring the agent list back while the agent is drawing
  // (a second pick would send the request twice). It counts while the
  // connected agent is working, or for ASK_WAIT after asking; then the list
  // offers to ask again.
  pending(list) {
    const p = this.project;
    const agent = list.find((x) => x.address === p?.meta.agent);
    if (!agent || !p.meta.asked) return null;
    const recent = Date.now() - p.meta.asked < ASK_WAIT;
    return agent.status === "working" || recent ? agent : null;
  }

  // From the panel: Blueprint moves into the tab as a pane beside its agent,
  // and the panel closes (the same diagram twice only costs room, and CPU
  // when both move). A Blueprint pane already in the tab gets the focus
  // instead of a second one.
  openPane() {
    const tab = this.servedTab(panes());
    const there = panes().find((p) => p.mod === MOD && p.tab === tab);
    if (there) run("pane.focus", { pane: there.pane });
    else run("pane.split", { direction: "right", pane: this.ctxPane ?? focused()?.pane ?? undefined, mod: MOD, props: { tab } });
    if (this.inPanel) run("layout.hide", { id: "panel" });
  }

  redraw(cx) {
    cx.notify();
    this.heal(cx);
  }

  heal(cx) {
    this.wanted = (this.wanted ?? 0) + 1;
    if (this.healing) return;
    this.healing = true;
    const check = (cx, tries) => {
      if (this.rendered >= this.wanted || tries > 4) {
        this.healing = false;
        return;
      }
      cx.notify();
      cx.timer.after(250 * (tries + 1), (cx) => check(cx, tries + 1));
    };
    cx.timer.after(250, (cx) => check(cx, 0));
  }

  // --- model -------------------------------------------------------------

  get graph() {
    return this.graphs[this.tab]?.g ?? EMPTY;
  }

  // Sizes and layouts belong to one version of one file.
  mkey(i) {
    const d = this.graphs[i];
    return `${d.key}@${d.rev}`;
  }

  get vkey() {
    return this.graphs[this.tab]?.key ?? "";
  }

  labelBox(i, n) {
    return this.measured[`n:${this.mkey(i)}:${n.id}`] ?? {
      w: Math.max(estimate(n.title, TITLE), estimate(n.sub, SUB)),
      h: TITLE * 1.3 + (n.sub ? SUB * 1.3 + 2 : 0),
    };
  }

  edgeLabelBox(i, e) {
    const k = this.graphs[i].g.edges.indexOf(e);
    return this.measured[`e:${this.mkey(i)}:${k}`] ?? { w: estimate(e.label, LABEL) + 10, h: LABEL * 1.4 + 4 };
  }

  layoutFor(i, dir) {
    const key = `${this.mkey(i)}:${dir}:${this.vers[this.mkey(i)] ?? 0}`;
    if (!this.cache.has(key)) {
      if (this.cache.size > 24) this.cache.clear();
      const g = this.graphs[i].g;
      this.cache.set(key, layout(g, dir, (n) => nodeSize(n, this.labelBox(i, n)), (e) => this.edgeLabelBox(i, e)));
    }
    return this.cache.get(key);
  }

  fitView(L) {
    const { width: W, height: H } = this.size, pad = 40;
    const b = L.bounds, gw = b.maxX - b.minX, gh = b.maxY - b.minY;
    const z = clamp(Math.min(ZFIT_MAX, (W - 2 * pad) / gw, (H - 2 * pad) / gh));
    return { z, x: (W - gw * z) / 2 - b.minX * z, y: (H - gh * z) / 2 - b.minY * z };
  }

  // The Mermaid direction, unless the other one fits the pane clearly bigger.
  direction(i) {
    const pref = this.graphs[i].g.dir, other = pref === "LR" ? "TB" : "LR";
    if (!this.size) return pref;
    const a = this.fitView(this.layoutFor(i, pref)).z, b = this.fitView(this.layoutFor(i, other)).z;
    return b > a * 1.2 ? other : pref;
  }

  current() {
    const dir = this.direction(this.tab);
    if (this.dirs[this.vkey] !== dir) {
      this.dirs[this.vkey] = dir;
      delete this.views[this.vkey]; // a new shape: start from fit
    }
    const L = this.layoutFor(this.tab, dir);
    return { L, dir, v: this.views[this.vkey] ?? this.fitView(L) };
  }

  // A node's whole flow: everything upstream and downstream of it.
  flow(id) {
    const nodes = new Set([id]), edges = new Set();
    for (const fwd of [true, false]) {
      const queue = [id], seen = new Set([id]);
      while (queue.length) {
        const v = queue.shift();
        for (const e of this.graph.edges) {
          const [a, b] = fwd ? [e.from, e.to] : [e.to, e.from];
          if (a !== v) continue;
          edges.add(e);
          nodes.add(b);
          if (!seen.has(b)) seen.add(b), queue.push(b);
        }
      }
    }
    return { nodes, edges };
  }

  // The work in progress, as edges and runs. Yellow edges: inside the work
  // (both ends in progress) and, for each place where work begins, one edge
  // leading in, from a finished node when there is one. A run follows yellow
  // edges from where work begins to where it ends; a fork makes a run per
  // branch. Each run is one dot. Back edges are not followed.
  scope(L) {
    const g = this.graph;
    const fwd = L.edges.filter((ed) => !ed.back);
    const busy = (id) => inProgress(g.nodes.get(id));
    const inner = fwd.filter((ed) => busy(ed.e.from) && busy(ed.e.to));
    const entries = [];
    for (const n of g.nodes.values()) {
      if (!inProgress(n) || inner.some((ed) => ed.e.to === n.id)) continue; // work begins here
      const ins = fwd.filter((ed) => ed.e.to === n.id);
      const lead = ins.find((ed) => g.nodes.get(ed.e.from)?.status === "done") ?? ins[0];
      entries.push({ id: n.id, lead });
    }
    const yellow = new Set([...inner, ...entries.map((x) => x.lead).filter(Boolean)].map((ed) => ed.e));
    const runs = [];
    const walk = (path, id, seen) => {
      const next = inner.filter((ed) => ed.e.from === id && !seen.has(ed.e.to));
      if (!next.length || runs.length >= 8) return path.length && runs.push(path);
      for (const ed of next) walk([...path, ed], ed.e.to, new Set([...seen, ed.e.to]));
    };
    for (const { id, lead } of entries) walk(lead ? [lead] : [], id, new Set([id]));
    return { yellow, runs };
  }

  // Who a request goes to: agents in this pane's tab, the most recent first,
  // then terminals there running an agent program that reports no status.
  // The tab Blueprint serves: a pane's own tab; for a panel, the tab on screen
  // (the active space's active tab, as the tab bar sees it).
  servedTab(all) {
    if (!this.inPanel) return this.ownTab ?? null;
    return this.shownTab();
  }

  shownTab() {
    return spaces().find((sp) => sp.active)?.tabs?.find((t) => t.active)?.id ?? focused()?.tab ?? null;
  }

  // Laid out: a pane only is while its tab shows, so the tab on screen is ours.
  laidOut() {
    if (this.inPanel || given()?.tab) return;
    const shown = this.shownTab();
    if (panes().some((p) => p.mod === MOD && p.tab === shown)) this.ownTab = shown;
  }

  // Clicked: this pane has the focus now, so the focused Blueprint pane is
  // this one, and its tab is ours.
  ownPane(cx) {
    if (this.inPanel) return;
    cx.timer.after(120, (cx) => {
      const me = panes().find((p) => p.mod === MOD && p.focused);
      if (me && me.tab !== this.ownTab) {
        this.ownTab = me.tab;
        this.redraw(cx);
      }
    });
  }

  targets(all = panes(), tab = this.servedTab(all)) {
    const list = agents().filter((a) => !tab || a.tab === tab).sort((a, b) => b.seq - a.seq)
      .map((a) => ({ address: a.address, name: APPS[a.app] ?? a.program?.name ?? a.app ?? a.address, status: a.status }));
    for (const p of all) {
      const agent = p.program && (p.program.agent || this.agentKeys.has(p.program.key));
      if (p.terminal && (!tab || p.tab === tab) && agent && !list.some((x) => x.address === p.terminal)) {
        list.push({ address: p.terminal, name: p.program.name, status: p.status });
      }
    }
    return list;
  }

  // An agent picked here wins, then the one connected to this project, then
  // the most recent one in the tab.
  pickTarget(list) {
    if (this.target) return list.find((x) => x.address === this.target) ?? { address: this.target, name: this.target, status: null };
    return list.find((x) => x.address === this.project?.meta.agent) ?? list[0] ?? null;
  }

  // --- actions -----------------------------------------------------------

  command(c, cx) {
    if (c === "fit") this.views[this.vkey] = null;
    else if (c === "zoom-in") this.zoomCenter(1.25);
    else if (c === "zoom-out") this.zoomCenter(0.8);
    else if (c === "zoom-100") this.graphs.length && this.zoomCenter(1 / this.current().v.z);
    else if (c === "clear") this.selected = null;
    else if (c === "export") this.exportPng(cx);
    else if (/^tab-\d$/.test(c)) this.setTab(Number(c.slice(4)) - 1, cx);
    else if (c.startsWith("select-")) this.selected = c.slice(7);
    else if (c === "edit") this.setEditing(!this.editing);
    else if (c.startsWith("compose-")) this.openCompose(c.slice(8));
    else if (c.startsWith("note-")) this.input.set_value(c.slice(5).replaceAll("_", " "));
    else if (c === "send") this.send(cx);
    else if (c === "cancel") this.closeCompose();
    else if (c.startsWith("target-")) this.target = c.slice(7) || null;
    else if (c.startsWith("connect-")) this.connect(this.targets().find((x) => x.address === c.slice(8)) ?? { address: c.slice(8), name: c.slice(8) }, cx);
    else if (c === "pin") this.togglePin(cx);
    else if (c === "new") this.openCreate();
    else if (c === "pane") this.openPane();
    else if (c === "reload") cx.spawn(async (cx) => this.reload(cx));
    else if (c === "lang-auto") this.langForced = false;
    else if (/^lang-(en|ko|ja)$/.test(c)) {
      this.langForced = true;
      this.useLang(c.slice(5));
    }
  }

  setEditing(on) {
    this.editing = on;
    if (!on) this.closeCompose();
  }

  openCompose(id) {
    if (!this.graph.nodes.has(id)) return;
    this.editing = true;
    this.selected = id;
    if (this.compose?.id !== id) {
      this.input.set_value("");
      this.noteEmpty = true;
    }
    this.compose = { id };
    this.input.focus();
  }

  // The + in the tab row: ask the agent for another diagram.
  openCreate() {
    if (!this.project) return;
    this.editing = false;
    this.selected = null;
    if (this.compose?.kind !== "new") {
      this.input.set_value("");
      this.noteEmpty = true;
    }
    this.compose = { kind: "new" };
    this.input.focus();
  }

  closeCompose() {
    this.compose = null;
    this.focus.focus();
  }

  // Sends the note about the composer's node to the agent, as the terminal
  // Blueprint does. The note stays in the box if sending fails.
  send(cx) {
    if (this.sending || !this.compose) return;
    const note = this.input.value().trim();
    const fresh = this.compose.kind === "new";
    const n = fresh ? null : this.graph.nodes.get(this.compose.id);
    if (!note || (!fresh && !n) || !this.project) return;
    const target = this.pickTarget(this.targets());
    if (!target) {
      notify({ title: this.T.noTarget, body: this.T.noAgentBody, level: "warning", timeout: 4000 });
      return;
    }
    const text = fresh
      ? newPrompt(this.project.dir, note, this.lang, this.graphs.map((d) => d.key))
      : pointPrompt(this.graphs[this.tab], n, note, `${this.project.dir}/${this.vkey}`);
    this.sending = true;
    this.redraw(cx);
    cx.spawn(async (cx) => {
      try {
        if (fresh) {
          // The agent is told the folder exists.
          await writeMeta(this.project.dir, this.project.meta);
          this.watch(cx);
        }
        const r = await hc(["send", target.address, text]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `hc send ${r.code}`).trim());
        notify({ title: this.T.sent(target.name), body: fresh ? note : `${n.title}: ${note}`, level: "success", timeout: 4000 });
        // A new diagram: wait for a file that isn't there yet, then show it.
        if (fresh) this.expectNew = { known: new Set(this.graphs.map((d) => d.key)), since: Date.now(), label: note };
        this.input.set_value("");
        this.noteEmpty = true;
        this.compose = null;
        this.editing = false;
        this.focus.focus();
      } catch (err) {
        notify({ title: this.T.sendFailed, body: String(err?.message ?? err), level: "error" });
      }
      this.sending = false;
      this.redraw(cx);
    });
  }

  setTab(i, cx) {
    if (i < 0 || i >= this.graphs.length) return;
    this.tab = i;
    this.selected = null;
    this.compose = null;
    if (cx) this.markSeen(cx);
  }

  zoomAt(f, px, py) {
    if (!this.graphs.length) return;
    const { v } = this.current();
    const z = clamp(v.z * f), k = z / v.z;
    this.views[this.vkey] = { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
  }

  zoomCenter(f) {
    if (this.size) this.zoomAt(f, this.size.width / 2, this.size.height / 2);
  }

  // Edit mode: a click opens the composer. Otherwise it picks the node (its
  // flow lights up) or, on the picked one, lets go.
  clickNode(n) {
    if (this.editing) this.openCompose(n.id);
    else this.selected = this.selected === n.id ? null : n.id;
  }

  // Fit, wait for that frame, take the window's frame and keep the canvas part.
  // Saved to ~/Downloads and put on the clipboard.
  exportPng(cx) {
    if (this.exporting || !this.size || !this.graphs.length) return;
    if (!this.bounds) {
      return notify({ title: "PNG", body: this.T.pngHover, level: "info", timeout: 4000 });
    }
    const saved = { view: this.views[this.vkey], selected: this.selected, hovered: this.hovered };
    Object.assign(this, { exporting: true, selected: null, hovered: null });
    this.views[this.vkey] = null;
    this.redraw(cx);
    const done = (cx) => {
      this.exporting = false;
      this.selected = saved.selected;
      this.views[this.vkey] = saved.view;
      this.redraw(cx);
    };
    cx.timer.after(250, (cx) => cx.spawn(async (cx) => {
      try {
        const dir = `${home()}/Downloads`, tmp = `${dir}/.blueprint-shot.png`;
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
        const out = `${dir}/blueprint-${stamp}.png`;
        await shot(tmp);
        const pw = Number((await exec("sips", ["-g", "pixelWidth", tmp])).stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
        const s = pw / window.viewport_size().width;
        const b = this.bounds, top = b.y + HEADER_H + (this.rowH ?? TABS_H);
        const crop = [this.size.height, this.size.width, top, b.x].map((v) => String(Math.round(v * s)));
        const r = await exec("sips", ["-c", crop[0], crop[1], "--cropOffset", crop[2], crop[3], tmp, "--out", out]);
        await exec("rm", ["-f", tmp]);
        if (r.code !== 0) throw new Error(r.stderr || r.stdout);
        await exec("osascript", ["-e", `set the clipboard to (read (POSIX file "${out}") as «class PNGf»)`]);
        notify({ title: this.T.pngSaved, body: out, level: "success", timeout: 5000 });
      } catch (err) {
        notify({ title: this.T.pngFailed, body: String(err?.message ?? err), level: "error" });
      }
      done(cx);
    }));
  }

  // --- drawing -----------------------------------------------------------

  render(cx) {
    const el = this.renderBody(cx);
    this.rendered = this.wanted ?? 0;
    return el;
  }

  renderBody(cx) {
    // Host data calls are the slow part of a render (ms each, far more when the
    // app is busy): one of each per render.
    const t = theme(), pal = palette(t);
    this.mono = settings().font_family;
    const all = panes();
    this.paneFocused = this.inPanel ? !!this.hovering : !!all.find((p) => p.mod === MOD && p.tab === this.ownTab && p.focused);
    const tabId = this.servedTab(all);
    this.targetList = this.targets(all, tabId);
    // Another tab: what was shown belonged to the old one, so it goes at once
    // and the new tab's project is looked up afresh.
    if (tabId !== this.ctxTab) {
      this.ctxTab = tabId;
      this.ctxCwd = undefined;
      this.project = null;
      this.watchGen = (this.watchGen ?? 0) + 1;
      this.graphs = [];
      this.selected = null;
      this.compose = null;
      this.loading = true;
    }
    // The project is the folder of the tab's agent: the connected one, else
    // the first. No agent there, no project. syncProject does the rest.
    const terms = all.filter((p) => p.terminal && p.tab === tabId && this.targetList.some((x) => x.address === p.terminal));
    const pick = terms.find((p) => p.terminal === this.project?.meta.agent) ?? terms[0];
    this.ctxPane = pick?.pane ?? null;
    this.ctxBranch = pick?.branch ?? null;
    if ((pick?.cwd ?? null) !== this.ctxCwd || this.ctxCwd === undefined) {
      this.ctxCwd = pick?.cwd ?? null;
      this.ctxPending = true;
    }
    const G = this.graphs[this.tab];
    const narrow = this.width > 0 && this.width < 420;
    return v_flex()
      .id("bp-root")
      .size_full()
      .bg(t.background)
      // As a side panel it is a card like Files and Changes beside it.
      .when(this.inPanel, (el) => el.min_h(0).rounded(10).overflow_hidden().border_1().border_color(t.border))
      .text_size(13)
      .track_focus(this.focus)
      .on_size_change((s, cx) => {
        // Only on a real change: a notify here re-renders, which reports again.
        if (Math.abs(s.width - this.width) < 0.5) return;
        this.width = s.width;
        this.laidOut();
        this.redraw(cx);
      })
      .on_mouse_move((e) => (this.bounds = e.bounds ?? this.bounds))
      .when(this.inPanel, (el) => el.on_hover((on, cx) => {
        this.hovering = on;
        this.redraw(cx);
      }))
      .on_mouse_down("left", (_e, cx) => {
        this.focus.focus();
        this.ownPane(cx);
      })
      .on_key_down((e, cx) => {
        // Shortcuts work with a Korean or Japanese input source on, too.
        const k = KEY_ALIASES[e.key_char] ?? KEY_ALIASES[e.key] ?? e.keystroke;
        if (k === "escape") {
          if (this.compose) this.closeCompose();
          else if (this.editing) this.setEditing(false);
          else this.selected = null;
        } else if (this.typing) return; // letters belong to the composer
        else if (k === "e") this.setEditing(!this.editing);
        else if (k === "f") this.command("fit", cx);
        else if (k === "0") this.command("zoom-100", cx);
        else if (k === "=" || k === "shift-=") this.command("zoom-in", cx);
        else if (k === "-") this.command("zoom-out", cx);
        else if (/^[1-9]$/.test(k)) this.setTab(Number(k) - 1, cx);
        else return;
        cx.stop_propagation();
        this.redraw(cx);
      })
      .child(this.header(t, pal, G, narrow))
      .child(this.tabs(t))
      .child(this.canvas(t, pal, cx))
      .child(this.footer(t, narrow))
      .children(this.measuring());
  }

  // Title, the agent, and three quiet icon buttons (pin, open as pane, edit)
  // drawn in the text colour, with a tooltip each.
  header(t, pal, G, narrow) {
    const T = this.T;
    const icon = (id, file, tip, on, onClick) => div().id(id).flex_none().size(28).flex().items_center().justify_center()
      .rounded(6).cursor_pointer().tooltip(tip).text_color(on ? t.accent : t.muted)
      .when(on, (el) => el.bg(alpha(t.accent, 0.16)))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => {
        onClick(cx);
        this.redraw(cx);
      })
      .child(svg(`mods/blueprint/${file}`).size(15));
    const a = this.pickTarget(this.targetList);
    const c = a ? { working: pal.active, blocked: t.blocked, done: pal.done }[a.status] ?? t.muted : t.dim;
    const said = a?.status ? T.status[a.status] : null;
    const label = !a ? T.noAgent : narrow ? said ?? a.name : said ? `${a.name} · ${said}` : a.name;
    const pill = h_flex().flex_none().gap(6).px(10).h(24).rounded_full().items_center().bg(alpha(c, 0.14))
      .child(div().w(7).h(7).rounded_full().bg(c))
      .child(div().text_size(12).text_color(c).child(label));
    return h_flex().h(HEADER_H).flex_none().pl(16).pr(10).gap(8).items_center().border_b(1).border_color(t.border)
      .child(h_flex().flex_1().min_w(0).gap(8).items_center()
        // While the tab's project is being looked up there is nothing to name yet.
        .child(div().min_w(0).truncate().font_semibold().text_color(t.foreground)
          .child(this.project ? this.project.topic ?? this.project.name : this.loading ? "" : T.noProject))
        .when(!!this.project && !!this.ctxBranch && !narrow, (el) => el.child(div().flex_none().text_size(11.5).font_family(this.mono).text_color(t.dim).child(this.ctxBranch))))
      .child(div().mr(4).child(pill))
      .when(!!G, (el) => el.child(icon("bp-pin", G.pinned ? "pin-on.svg" : "pin.svg", G.pinned ? T.unpinTip : T.pinTip, G.pinned, (cx) => this.togglePin(cx))))
      .when(this.inPanel, (el) => el.child(icon("bp-pane", "pane.svg", T.openPane, false, () => this.openPane())))
      .when(!!G, (el) => el.child(icon("bp-edit", "edit.svg", T.editTip, this.editing, () => this.setEditing(!this.editing))));
  }

  // The parts of the project: one tab per diagram (always, even one), + to
  // ask for another right after them, and the shown diagram's age at the far
  // end. The project itself is the header's title.
  tabs(t) {
    const p = this.project, G = this.graphs[this.tab];
    this.rowH = TABS_H;
    return h_flex().h(TABS_H).flex_none().px(10).gap(2).items_center().border_b(1).border_color(t.border).overflow_hidden()
      .children(this.graphs.map((d, i) => {
        const on = i === this.tab;
        return h_flex().id(`bp-tab-${i}`).flex_none().max_w(220).gap(5).px(10).py(4).items_center().rounded(6).text_size(12)
          .cursor_pointer().text_color(on ? t.foreground : t.muted)
          .when(on, (el) => el.bg(t.raised))
          .when(!on, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
          .on_click((_e, cx) => {
            this.setTab(i, cx);
            this.redraw(cx);
          })
          .when(d.pinned, (el) => el.child(svg("mods/blueprint/pin-on.svg").size(11).flex_none()))
          .child(div().min_w(0).truncate().child(d.tab));
      }))
      .when(!!this.expectNew, (el) => el.child(div().flex_none().px(10).py(4).rounded(6).text_size(12).text_color(t.dim)
        .border(1).border_color(t.border).child(this.T.drawingNew)))
      .when(!!p, (el) => el.child(div().id("bp-new").flex_none().size(26).ml(2).flex().items_center().justify_center().rounded(6)
        .cursor_pointer().tooltip(this.T.newTip).text_color(this.compose?.kind === "new" ? t.accent : t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          this.openCreate();
          this.redraw(cx);
        })
        .child(svg("mods/blueprint/plus.svg").size(14))))
      .child(div().flex_1())
      .when(!!G, (el) => el.child(div().flex_none().pl(8).pr(4).text_size(11.5).text_color(t.dim).child(this.T.ago(minutesSince(G.loaded)))));
  }

  canvas(t, pal, cx) {
    const el = div().id("bp-canvas").flex_1().min_h(0).relative().overflow_hidden().bg(t.canvas)
      .when(!!this.drag?.moved, (el) => el.cursor_grabbing())
      .when(!this.drag?.moved, (el) => el.cursor_grab())
      .on_size_change((s, cx) => {
        if (this.size && Math.abs(s.width - this.size.width) < 0.5 && Math.abs(s.height - this.size.height) < 0.5) return;
        this.size = { width: s.width, height: s.height };
        this.redraw(cx);
      })
      .on_scroll_wheel((e, cx) => {
        if (!this.graphs.length) return;
        const v = this.current().v;
        const p = e.local_position ?? (e.bounds ? { x: e.position.x - e.bounds.x, y: e.position.y - e.bounds.y } : { x: this.size.width / 2, y: this.size.height / 2 });
        if (e.modifiers.control || e.modifiers.platform) this.zoomAt(Math.exp(e.delta.y * 0.003), p.x, p.y);
        else this.views[this.vkey] = { ...v, x: v.x + e.delta.x, y: v.y + e.delta.y };
        this.redraw(cx);
      })
      .on_mouse_down("left", (e) => {
        if (!this.graphs.length) return;
        this.drag = { x: e.position.x, y: e.position.y, v: { ...this.current().v }, moved: false };
      })
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d) return;
        const dx = e.position.x - d.x, dy = e.position.y - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 3) return;
        d.moved = true;
        this.views[this.vkey] = { ...d.v, x: d.v.x + dx, y: d.v.y + dy };
        this.redraw(cx);
      })
      .on_mouse_up("left", (_e, cx) => {
        // A press and release on empty canvas clears the selection.
        if (this.drag && !this.drag.moved) this.selected = null;
        this.drag = null;
        this.redraw(cx);
      })
      .on_hover((h) => {
        if (!h) this.drag = null;
      });
    if (!this.size) return el;
    if (!this.graphs.length) {
      if (this.loading) return el;
      return el.child(this.emptyCard(t)).when(this.compose?.kind === "new", (el) => el.child(this.composer(t)));
    }
    return el.children(this.drawing(t, pal))
      .when(this.editing, (el) => el.child(h_flex().absolute().left(12).top(12).gap(6).px(10).h(26).items_center().rounded(6)
        .bg(alpha(t.accent, 0.16)).border(1).border_color(alpha(t.accent, 0.5)).text_size(12).text_color(t.accent)
        .child(div().font_semibold().child(this.T.editMode))
        .child(div().text_color(t.muted).child(this.compose ? this.T.enterSend : this.T.pickNode))))
      .when(!!this.compose, (el) => el.child(this.composer(t)));
  }

  // No diagram yet: the agents in the tab, to connect one and have it draw.
  emptyCard(t) {
    const T = this.T, p = this.project, list = this.targetList ?? [];
    const W = this.size.width, cw = Math.min(440, W - 32);
    const body = v_flex().w(cw).gap(10).p(18).rounded(12).bg(t.background).border(1).border_color(t.border)
      .child(div().text_size(14).font_semibold().text_color(t.foreground).child(p ? T.emptyTitle : T.noProject));
    if (!p) {
      return div().absolute().inset_0().flex().items_center().justify_center()
        .child(body.child(div().text_size(12.5).text_color(t.muted).child(T.noAgentHere)));
    }
    const where = [p.path, this.ctxBranch].filter(Boolean).join(" · ");
    let out = body.child(div().text_size(11).font_family(this.mono).text_color(t.dim).truncate().child(where));
    const asked = this.pending(list);
    if (asked) {
      out = out.child(div().pt(4).text_size(12.5).text_color(t.accent).child(T.asked(asked.name)))
        .child(div().text_size(12).text_color(t.muted).child(T.waitingBody));
    } else if (list.length) {
      out = out.child(div().pt(4).text_size(12.5).text_color(t.muted).child(T.pickAgent))
        .child(v_flex().gap(6).children(list.map((a, i) => h_flex().id(`bp-agent-${i}`).h(34).px(12).gap(8).items_center().rounded(8)
          .border(1).border_color(t.input).bg(t.raised).cursor_pointer().hover((s) => s.border_color(t.accent))
          .on_click((_e, cx) => {
            this.connect(a, cx);
            this.redraw(cx);
          })
          .child(div().flex_1().text_size(13).text_color(t.foreground).child(a.name))
          .child(div().text_size(11).font_family(this.mono).text_color(t.dim).child(a.address)))));
    } else {
      out = out.child(div().pt(4).text_size(12.5).text_color(t.muted).child(T.noAgentHere));
    }
    out = out.child(div().pt(6).text_size(11).text_color(t.dim).child(`${T.emptyHint} · ${T.keepHint}`));
    return div().absolute().inset_0().flex().items_center().justify_center().child(out);
  }

  // The request box: which node, who gets it, what to change.
  composer(t) {
    const fresh = this.compose.kind === "new";
    const n = fresh ? null : this.graph.nodes.get(this.compose.id);
    if (!fresh && !n) return div();
    const list = this.targetList ?? [], target = this.pickTarget(list);
    const W = this.size.width, cw = Math.min(560, W - 24);
    const button = (id, label, primary, enabled, onClick) =>
      div().id(id).h(28).px(12).flex().items_center().rounded(7).text_size(12).font_medium()
        .border(1).border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
        .text_color(primary ? t.solid_foreground : t.foreground)
        .when(!enabled, (el) => el.opacity(0.45))
        .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => {
          onClick(cx);
          this.redraw(cx);
        }))
        .child(label);
    const next = () => {
      // Several agents here: the chip cycles through them.
      if (list.length < 2) return;
      const i = list.findIndex((x) => x.address === target?.address);
      this.target = list[(i + 1) % list.length].address;
    };
    const ready = !!target && !this.sending;
    return v_flex().id("bp-compose").absolute().left((W - cw) / 2).bottom(12).w(cw).p(12).gap(8).rounded(10)
      .bg(t.popover).border(1).border_color(alpha(t.accent, 0.6)).shadow_lg().cursor_default()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(h_flex().gap(8).items_center()
        .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(fresh ? this.T.newDiagram : n.title))
        .when(!!n?.ref, (el) => el.child(div().min_w(0).truncate().text_size(11).font_family(this.mono).text_color(t.muted).child(n.ref)))
        .child(div().flex_1())
        .child(div().id("bp-target").flex_none().px(8).h(22).flex().items_center().rounded(6).text_size(11.5)
          .bg(alpha(target ? t.accent : t.blocked, 0.12)).text_color(target ? t.accent : t.blocked)
          .when(list.length > 1, (el) => el.cursor_pointer().on_click((_e, cx) => { next(); this.redraw(cx); }))
          .child(target ? `→ ${target.name}${list.length > 1 ? " ⇄" : ""}` : this.T.noTarget)))
      .child(div().relative()
        .child(Input.new(this.input).h(34).px(10).rounded(8).border(1).border_color(this.typing ? t.accent : t.input)
          .bg(t.background).text_size(13).text_color(t.foreground))
        .when(this.noteEmpty, (el) => el.child(div().absolute().left(11).top(0).h(34).flex().items_center()
          .text_size(13).text_color(t.dim).child(fresh ? this.T.newPlaceholder : this.T.placeholder))))
      // Starting points for a new diagram; a click fills the box.
      .when(fresh, (el) => el.child(h_flex().gap(6).flex_wrap().children(this.T.suggest.map((x, i) =>
        div().id(`bp-suggest-${i}`).px(8).h(24).flex().items_center().rounded(6).border(1).border_color(t.input)
          .text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.border_color(t.accent).text_color(t.foreground))
          .on_click((_e, cx) => {
            this.input.set_value(x);
            this.noteEmpty = false;
            this.input.focus();
            this.redraw(cx);
          })
          .child(x)))))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
          .child(!target ? this.T.openAgent : fresh ? this.T.newHint : this.T.sendsWith))
        .child(button("bp-cancel", this.T.cancel, false, true, () => this.closeCompose()))
        .child(button("bp-send", this.sending ? this.T.sending : this.T.send, true, ready, (cx) => this.send(cx))));
  }

  drawing(t, pal) {
    const { L, v } = this.current();
    const { z } = v, W = this.size.width, H = this.size.height;
    const X = (x) => x * z + v.x, Y = (y) => y * z + v.y;
    const sel = this.selected && this.graph.nodes.has(this.selected) ? this.flow(this.selected) : null;
    const layer = (path, color) => div().absolute().left(0).top(0).w(W).h(H).child(window.paint_path(path, color));
    const els = [];

    // Dot grid over the whole canvas, moving with the drawing.
    let s = 20 * z;
    while (s < 12) s *= 2;
    while (s > 40) s /= 2;
    const dot = 1.6, ox = ((v.x % s) + s) % s, oy = ((v.y % s) + s) % s;
    let grid = PathBuilder.stroke(dot).dash_array([dot, s - dot]);
    for (let y = oy; y < H; y += s) grid = grid.move_to(ox - dot / 2, y).line_to(W + s, y);
    els.push(layer(grid.build(), alpha(t.foreground, 0.11)));

    // Edges: one stroke path per look and one arrow path per colour, not per edge.
    const lines = new Map(), arrows = new Map();
    const lineGroup = (key, color, width, dash) => {
      if (!lines.has(key)) {
        let b = PathBuilder.stroke(width);
        if (dash) b = b.dash_array(dash.map((d) => d * Math.max(0.6, z)));
        lines.set(key, { b, color });
      }
      return lines.get(key);
    };
    const arrowGroup = (color) => {
      if (!arrows.has(color)) arrows.set(color, { b: PathBuilder.fill(), color });
      return arrows.get(color);
    };
    const head = Math.max(4, 7 * Math.sqrt(z));
    const tips = new Set();
    const work = this.scope(L);
    const into = work.yellow;
    // Dots only while this pane has focus: a running dot repaints the window
    // on every tick, so the default is colour alone.
    const runs = this.exporting || !this.paneFocused ? [] : work.runs.filter((path) => !sel || path.every((ed) => sel.edges.has(ed.e)));
    for (const ed of L.edges) {
      const lit = !sel || sel.edges.has(ed.e);
      const active = into.has(ed.e) && lit;
      const dashed = ed.e.style === "dashed" || active;
      const look = active ? "active" : !lit ? "dim" : sel ? "lit" : "plain";
      // A picked node's flow is drawn heavier, the yellow work edges included.
      const strong = !!sel && lit;
      const color = { active: alpha(pal.active, strong ? 0.95 : 0.45), dim: alpha(t.muted, 0.18), lit: t.foreground, plain: alpha(t.muted, 0.75) }[look];
      const width = strong ? 2 : active ? 1.6 : 1.25;
      const gr = lineGroup(`${look}:${dashed}:${width}`, color, width, dashed ? [4, 4] : null);
      const pts = ed.segs.map((sg) => sg.map((p) => ({ x: X(p.x), y: Y(p.y) })));
      const end = pts[pts.length - 1][3], d = ed.dir;
      const stop = ed.e.arrow ? { x: end.x - d.x * head * 0.8, y: end.y - d.y * head * 0.8 } : end;
      gr.b = gr.b.move_to(pts[0][0].x, pts[0][0].y);
      pts.forEach((p, k) => {
        const to = k === pts.length - 1 ? stop : p[3];
        gr.b = gr.b.cubic_bezier_to(to.x, to.y, p[1].x, p[1].y, p[2].x, p[2].y);
      });
      // Two identical arrow heads in one fill path cancel out (even-odd), so one per tip.
      const tip = `${Math.round(end.x)}:${Math.round(end.y)}`;
      if (ed.e.arrow && !tips.has(tip)) {
        tips.add(tip);
        const side = { x: -d.y, y: d.x }, w = head * 0.55;
        const a = arrowGroup(active ? pal.active : look === "plain" ? alpha(t.muted, 0.9) : color);
        a.b = a.b.add_polygon([[end.x, end.y], [end.x - d.x * head + side.x * w, end.y - d.y * head + side.y * w], [end.x - d.x * head - side.x * w, end.y - d.y * head - side.y * w]], true);
      }
    }
    for (const gr of lines.values()) els.push(layer(gr.b.build(), gr.color));
    for (const gr of arrows.values()) els.push(layer(gr.b.build(), gr.color));

    // A dot per run, all leaving together on one cycle, so runs that share a
    // start overlap there (built once) and part at the fork. Across a node a
    // dot goes straight from where it came in to where it leaves, under the box.
    const tracks = runs.map((path) => {
      const pts = [];
      path.forEach((ed, i) => {
        const segs = ed.segs.map((sg) => sg.map((p) => ({ x: X(p.x), y: Y(p.y) })));
        if (i > 0) pts.push({ ...segs[0][0], cross: true }); // under the node
        for (const sg of segs) for (let k = i > 0 ? 1 : 0; k <= 16; k++) pts.push(at(sg, k / 16));
      });
      let len = 0;
      return { pts: pts.map((p, k) => ({ ...p, d: k ? (len += Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y)) : 0 })), len };
    });
    if (tracks.length) {
      const longest = Math.max(...tracks.map((l) => l.len));
      const step = Math.max(FLOW_GAP, longest / FLOW_SPOTS);
      const cycle = Math.ceil(longest / step) + Math.round(FLOW_REST / FLOW_MS);
      const built = new Set();
      for (const l of tracks) {
        for (let d = step / 2, k = 0, tick = 0; d < l.len - head * 1.2; d += step, tick++) {
          while (k < l.pts.length - 1 && l.pts[k + 1].d < d) k++;
          const p = l.pts[k], key = `${Math.round(p.x)}:${Math.round(p.y)}:${tick}`;
          if (l.pts[k + 1]?.cross || built.has(key)) continue;
          built.add(key);
          const frames = Array.from({ length: cycle }, (_, i) => (i === tick ? "●" : ""));
          els.push(div().absolute().left(p.x - 6).top(p.y - 7).w(12).h(14).flex().items_center().justify_center()
            .text_size(10).text_color(pal.active).frames(frames, FLOW_MS));
        }
      }
    }

    // Edge labels, on a patch of canvas so the line stops behind them.
    L.edges.forEach((ed) => {
      if (!ed.label) return;
      const m = this.edgeLabelBox(this.tab, ed.e);
      const lit = !sel || sel.edges.has(ed.e);
      els.push(div().absolute().left(X(ed.label.x) - (m.w * z) / 2).top(Y(ed.label.y) - (m.h * z) / 2).w(m.w * z).h(m.h * z)
        .flex().items_center().justify_center().rounded(4 * z).bg(t.canvas)
        .text_size(LABEL * z).text_color(lit ? t.muted : alpha(t.muted, 0.3)).child(ed.e.label));
    });

    for (const item of L.nodes) els.push(...this.node(item, t, pal, sel, X, Y, z));

    return els;
  }

  // Text measured at 100%, invisible, so node sizes follow the real text: the
  // shown tab first, then one other tab per render until all are done, so a
  // switch finds its sizes ready without one heavy first render (a dropped
  // render measures nothing, and retrying the same heavy one stalled the app).
  measuring() {
    const els = [], mono = this.mono;
    if (this.measuredFont !== mono) {
      // Another font: every size is stale.
      this.measuredFont = mono;
      this.measured = {};
      for (const k of Object.keys(this.vers)) this.vers[k]++;
    }
    const missing = (i) => [...this.graphs[i].g.nodes.keys()].some((id) => !this.measured[`n:${this.mkey(i)}:${id}`])
      || this.graphs[i].g.edges.some((e, k) => e.label && !this.measured[`e:${this.mkey(i)}:${k}`]);
    if (!this.graphs.length) return els;
    const order = [this.tab, ...this.graphs.keys()].filter((i, k, a) => a.indexOf(i) === k);
    const next = order.find(missing);
    if (next === undefined) return els;
    [next].forEach((i) => {
      const { g } = this.graphs[i], mk = this.mkey(i);
      for (const n of g.nodes.values()) {
        const key = `n:${mk}:${n.id}`;
        if (this.measured[key]) continue;
        els.push(v_flex().id(`bp-m-${key}`).absolute().left(0).top(0).opacity(0).items_center().gap(2)
          .child(div().whitespace_nowrap().text_size(TITLE).font_semibold().child(n.title))
          .when(!!n.sub, (el) => el.child(div().whitespace_nowrap().text_size(SUB).font_family(mono).child(n.sub)))
          .on_size_change((s, cx) => this.measure(key, mk, s, cx)));
      }
      g.edges.forEach((e, k) => {
        const key = `e:${mk}:${k}`;
        if (!e.label || this.measured[key]) return;
        els.push(div().id(`bp-m-${key}`).absolute().left(0).top(0).opacity(0).px(5).py(1).whitespace_nowrap().text_size(LABEL)
          .child(e.label).on_size_change((s, cx) => this.measure(key, mk, s, cx)));
      });
    });
    return els;
  }

  // Sizes arrive one callback per element in the same frame; draw once for all.
  measure(key, mk, s, cx) {
    const old = this.measured[key];
    if (old && Math.abs(old.w - s.width) < 0.5 && Math.abs(old.h - s.height) < 0.5) return;
    this.measured[key] = { w: s.width, h: s.height };
    this.vers[mk] = (this.vers[mk] ?? 0) + 1;
    if (this.measurePending) return;
    this.measurePending = true;
    cx.timer.after(16, (cx) => {
      this.measurePending = false;
      this.redraw(cx);
    });
  }

  node(item, t, pal, sel, X, Y, z) {
    const n = item.node, w = item.w * z, h = item.h * z;
    const left = X(item.x) - w / 2, top = Y(item.y) - h / 2;
    const lit = !sel || sel.nodes.has(n.id);
    const picked = this.selected === n.id && !this.exporting;
    const hover = this.hovered === n.id && !this.exporting;
    const status = inProgress(n) ? "active" : n.status === "done" ? "done" : null;
    const aiming = (this.editing && hover) || this.compose?.id === n.id;
    const stroke = picked || aiming ? t.accent : status === "active" ? pal.active : status === "done" ? alpha(pal.done, 0.8) : hover ? alpha(t.foreground, 0.55) : t.input;
    const bw = picked || aiming || status === "active" ? 2 : 1;
    const mono = this.mono;
    const label = v_flex().items_center().gap(2 * z)
      .child(div().whitespace_nowrap().text_size(TITLE * z).font_semibold().text_color(t.foreground).child(n.title))
      .when(!!n.sub, (el) => el.child(div().whitespace_nowrap().text_size(SUB * z).font_family(mono).text_color(t.muted).child(n.sub)));
    const bg = hover ? t.raised : t.background;

    let box = div().id(`bp-n-${this.tab}-${n.id}`).absolute().left(left).top(top).w(w).h(h)
      .flex().items_center().justify_center().cursor_pointer()
      .opacity(lit ? 1 : 0.28).transition("opacity", 160)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_hover((on, cx) => {
        this.hovered = on ? n.id : this.hovered === n.id ? null : this.hovered;
        this.redraw(cx);
      })
      .on_click((_e, cx) => {
        this.clickNode(n);
        this.redraw(cx);
      });
    const full = (path, color) => div().absolute().left(0).top(0).w(w).h(h).child(window.paint_path(path, color));
    const i = bw / 2;
    if (n.shape === "diamond") {
      const poly = [[w / 2, i], [w - i, h / 2], [w / 2, h - i], [i, h / 2]];
      box = box.child(full(PathBuilder.fill().add_polygon(poly, true).build(), bg))
        .child(full(PathBuilder.stroke(bw).add_polygon(poly, true).build(), stroke));
    } else if (n.shape === "cylinder") {
      const rx = w / 2 - i, ry = 7 * z;
      const body = (b) => b.move_to(i, ry).arc_to(rx, ry - i, 0, false, true, w - i, ry).line_to(w - i, h - ry)
        .arc_to(rx, ry - i, 0, false, true, i, h - ry).close();
      const outline = body(PathBuilder.stroke(bw)).move_to(i, ry).arc_to(rx, ry - i, 0, false, false, w - i, ry);
      box = box.child(full(body(PathBuilder.fill()).build(), bg)).child(full(outline.build(), stroke)).pt(ry);
    } else {
      const r = n.shape === "stadium" ? h / 2 : n.shape === "circle" ? w / 2 : n.shape === "round" ? 14 * z : 8 * z;
      box = box.bg(bg).border(bw).border_color(stroke).rounded(r);
      if (picked) box = box.shadow_md();
    }
    box = box.child(label);

    const out = [box];
    if (picked) {
      // A soft ring outside the selected node.
      const g = 4;
      if (n.shape !== "diamond" && n.shape !== "cylinder") {
        const r = n.shape === "stadium" ? h / 2 + g : n.shape === "circle" ? w / 2 + g : 8 * z + g;
        out.unshift(div().absolute().left(left - g).top(top - g).w(w + 2 * g).h(h + 2 * g).rounded(r).border(3).border_color(alpha(t.accent, 0.25)));
      }
    }
    if (status) {
      // Badge on the top-right edge of the shape.
      const cx = X(item.x), cy = Y(item.y);
      const [bx, by] =
        n.shape === "diamond" ? [cx + w / 4, cy - h / 4]
        : n.shape === "circle" ? [cx + w * 0.354, cy - h * 0.354]
        : n.shape === "stadium" ? [cx + w / 2 - h * 0.146, cy - h / 2 + h * 0.146]
        : n.shape === "cylinder" ? [cx + w / 2 - 2, cy - h / 2 + 7 * z]
        : [cx + w / 2 - 3, cy - h / 2 + 3];
      const op = lit ? 1 : 0.28;
      if (status === "done") {
        const d = Math.max(12, 16 * z);
        out.push(div().absolute().left(bx - d / 2).top(by - d / 2).w(d).h(d).rounded_full().bg(pal.done).opacity(op)
          .flex().items_center().justify_center().text_size(d * 0.62).font_semibold().text_color(t.background).child("✓"));
      } else {
        // Still, on purpose: the only thing that moves is the flowing dot.
        const d = Math.max(8, 11 * z), ring = d + 6;
        if (n.status === "current") {
          out.push(div().absolute().left(bx - ring / 2).top(by - ring / 2).w(ring).h(ring).rounded_full().bg(alpha(pal.active, 0.28)).opacity(op));
        }
        out.push(div().absolute().left(bx - d / 2).top(by - d / 2).w(d).h(d).rounded_full().bg(pal.active).opacity(op));
      }
    }
    return out;
  }

  footer(t, narrow) {
    const n = this.selected ? this.graph.nodes.get(this.selected) : null;
    const has = this.graphs.length > 0;
    const { v } = this.size && has ? this.current() : { v: { z: 1 } };
    const fitted = !this.views[this.vkey];
    const button = (id, label, onClick, extra = (el) => el) =>
      extra(div().id(id).h(26).px(10).flex().items_center().rounded(6).border(1).border_color(t.border).text_size(12)
        .text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          onClick(cx);
          this.redraw(cx);
        })
        .child(label));
    const zoom = h_flex().h(26).items_center().rounded(6).border(1).border_color(t.border).text_size(12).text_color(t.foreground)
      .child(div().id("bp-zoom-out").w(24).h_full().flex().items_center().justify_center().cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.command("zoom-out", cx); this.redraw(cx); }).child("−"))
      .child(div().id("bp-zoom-100").min_w(48).h_full().px(4).flex().items_center().justify_center().cursor_pointer().hover((s) => s.bg(t.hover))
        .border_l(1).border_r(1).border_color(t.border)
        .on_click((_e, cx) => { this.command("zoom-100", cx); this.redraw(cx); }).child(`${Math.round(v.z * 100)}%`))
      .child(div().id("bp-zoom-in").w(24).h_full().flex().items_center().justify_center().cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.command("zoom-in", cx); this.redraw(cx); }).child("+"));
    const mono = this.mono;
    const info = n
      ? h_flex().flex_1().min_w(0).gap(8).items_center().overflow_hidden()
        .child(div().flex_none().text_size(12).font_semibold().text_color(t.foreground).child(n.title))
        .when(!!n.ref, (el) => el.child(div().min_w(0).truncate().text_size(11).font_family(mono).text_color(t.accent).child(n.ref)))
        .when(!narrow && !this.editing, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(this.T.hintEdit)))
      : div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted)
        .child(this.editing ? this.T.hintEditing : narrow ? this.T.hintNarrow : this.T.hint);
    return h_flex().h(FOOTER_H).flex_none().px(12).gap(6).items_center().border_t(1).border_color(t.border)
      .child(info)
      .when(has, (el) => el
        .child(button("bp-fit", this.T.fit, (cx) => this.command("fit", cx), (e) => e.when(fitted, (e) => e.text_color(t.muted))))
        .child(zoom)
        .child(button("bp-png", this.exporting ? this.T.saving : "PNG", (cx) => this.exportPng(cx))));
  }
}

// `herdr-app shot`, wherever this machine keeps it.
async function shot(file) {
  for (const bin of ["herdr-app", `${home()}/.local/bin/herdr-app`, "/Applications/Herdr.app/Contents/MacOS/Herdr"]) {
    try {
      const r = await exec(bin, ["shot", file]);
      if (r.code === 0) return;
    } catch (_) {}
  }
  throw new Error("herdr-app shot failed");
}
