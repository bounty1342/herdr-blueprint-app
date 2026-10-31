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
// Commands (keys.json or `herdr-app do blueprint.<name>`):
//   fit, zoom-in, zoom-out, zoom-100, export, clear, tab-1..9, select-<node id>,
//   edit, compose-<node id>, note-<text, _ for spaces>, send, cancel, target-<terminal>

import { View, div, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, settings, agents, panes, knownAgents, exec, hc, home, notify, nextCommand } from "herdr";
import { parseFlowchart } from "./mermaid.js";
import { layout, at } from "./layout.js";
import { DIAGRAMS } from "./diagrams.js";

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
const STATUS = { working: "작업 중", blocked: "확인 필요", done: "완료", idle: "대기" };
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

function ago(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  return m < 1 ? "방금" : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`;
}

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
function pointPrompt(G, n, note) {
  const label = [n.title, n.sub].filter(Boolean).join(" ");
  const where = n.line ? `, line ${n.line}: ${inline(n.lineText)}` : "";
  const stands = n.ref ? ` It stands for \`${n.ref}\`.` : "";
  const work = "Make this change in the code there and anything that depends on it, run the tests, then ";
  const todo = n.ref ? `${work}send the updated diagram to Blueprint.` : "Change it and anything it describes, then send the new version to Blueprint.";
  const text = `In Blueprint I pointed at the box "${label}" in the diagram you sent ('${G.g.title ?? G.tab}')${where}.${stands}\n${note}\n${todo}\n${fenced(G.src, "mermaid")}\n`;
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

export default class Blueprint extends View {
  init(_props, cx) {
    this.graphs = DIAGRAMS.map((d) => ({ ...d, g: parseFlowchart(d.src), loaded: Date.now() }));
    this.tab = 0;
    this.views = []; // per tab: {z, x, y} once moved by hand; empty means fit
    this.dirs = []; // per tab: the direction last drawn
    this.measured = {}; // "n:<tab>:<id>" / "e:<tab>:<index>" -> {w, h} at 100%
    this.vers = this.graphs.map(() => 0); // per tab, bumped when its text is measured
    this.cache = new Map();
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
    this.input = InputState.new({ placeholder: "무엇을 바꿀까요? 예: 여기에 rate limit 추가" });
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
    cx.timer.every(30000, (cx) => cx.notify()); // "N분 전"
    cx.spawn(async (cx) => {
      for (;;) {
        this.command(await nextCommand(), cx);
        this.redraw(cx);
      }
    });
    // The first runs of the layout code are far slower than later ones; run
    // them here, where no frame is waiting.
    for (let i = 0; i < this.graphs.length; i++) for (const dir of ["LR", "TB"]) this.layoutFor(i, dir);
  }

  // The host sometimes drops a render ("interrupted"); the pane then keeps the
  // last good frame under an error bar until a later render goes through. It
  // happens most right after a reload, a resize or a new tab. A dropped render
  // leaves nothing behind, so a render marks itself done only at its end, and
  // until one does, keep asking (a few times, backing off).
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
    return this.graphs[this.tab].g;
  }

  labelBox(i, n) {
    return this.measured[`n:${i}:${n.id}`] ?? {
      w: Math.max(estimate(n.title, TITLE), estimate(n.sub, SUB)),
      h: TITLE * 1.3 + (n.sub ? SUB * 1.3 + 2 : 0),
    };
  }

  edgeLabelBox(i, e) {
    const k = this.graphs[i].g.edges.indexOf(e);
    return this.measured[`e:${i}:${k}`] ?? { w: estimate(e.label, LABEL) + 10, h: LABEL * 1.4 + 4 };
  }

  layoutFor(i, dir) {
    const key = `${i}:${dir}:${this.vers[i]}`;
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
    if (this.dirs[this.tab] !== dir) {
      this.dirs[this.tab] = dir;
      this.views[this.tab] = null; // a new shape: start from fit
    }
    const L = this.layoutFor(this.tab, dir);
    return { L, dir, v: this.views[this.tab] ?? this.fitView(L) };
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
  targets(all = panes()) {
    const me = all.find((p) => p.mod === MOD);
    const list = agents().filter((a) => !me || a.tab === me.tab).sort((a, b) => b.seq - a.seq)
      .map((a) => ({ address: a.address, name: APPS[a.app] ?? a.program?.name ?? a.app ?? a.address, status: a.status }));
    for (const p of all) {
      const agent = p.program && (p.program.agent || this.agentKeys.has(p.program.key));
      if (p.terminal && (!me || p.tab === me.tab) && agent && !list.some((x) => x.address === p.terminal)) {
        list.push({ address: p.terminal, name: p.program.name, status: p.status });
      }
    }
    return list;
  }

  pickTarget(list) {
    if (this.target) return list.find((x) => x.address === this.target) ?? { address: this.target, name: this.target, status: null };
    return list[0] ?? null;
  }

  // --- actions -----------------------------------------------------------

  command(c, cx) {
    if (c === "fit") this.views[this.tab] = null;
    else if (c === "zoom-in") this.zoomCenter(1.25);
    else if (c === "zoom-out") this.zoomCenter(0.8);
    else if (c === "zoom-100") this.zoomCenter(1 / this.current().v.z);
    else if (c === "clear") this.selected = null;
    else if (c === "export") this.exportPng(cx);
    else if (/^tab-\d$/.test(c)) this.setTab(Number(c.slice(4)) - 1);
    else if (c.startsWith("select-")) this.selected = c.slice(7);
    else if (c === "edit") this.setEditing(!this.editing);
    else if (c.startsWith("compose-")) this.openCompose(c.slice(8));
    else if (c.startsWith("note-")) this.input.set_value(c.slice(5).replaceAll("_", " "));
    else if (c === "send") this.send(cx);
    else if (c === "cancel") this.closeCompose();
    else if (c.startsWith("target-")) this.target = c.slice(7) || null;
  }

  setEditing(on) {
    this.editing = on;
    if (!on) this.closeCompose();
  }

  openCompose(id) {
    if (!this.graph.nodes.has(id)) return;
    this.editing = true;
    this.selected = id;
    if (this.compose?.id !== id) this.input.set_value("");
    this.compose = { id };
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
    const n = this.graph.nodes.get(this.compose.id);
    if (!note || !n) return;
    const target = this.pickTarget(this.targets());
    if (!target) {
      notify({ title: "보낼 에이전트가 없어요", body: "이 탭에 에이전트를 열고 다시 보내 주세요", level: "warning", timeout: 4000 });
      return;
    }
    const text = pointPrompt(this.graphs[this.tab], n, note);
    this.sending = true;
    this.redraw(cx);
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["send", target.address, text]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `hc send ${r.code}`).trim());
        notify({ title: `${target.name}에게 보냈어요`, body: `${n.title}: ${note}`, level: "success", timeout: 4000 });
        this.input.set_value("");
        this.compose = null;
        this.editing = false;
        this.focus.focus();
      } catch (err) {
        notify({ title: "보내지 못했어요", body: String(err?.message ?? err), level: "error" });
      }
      this.sending = false;
      this.redraw(cx);
    });
  }

  setTab(i) {
    if (i < 0 || i >= this.graphs.length) return;
    this.tab = i;
    this.selected = null;
  }

  zoomAt(f, px, py) {
    const { v } = this.current();
    const z = clamp(v.z * f), k = z / v.z;
    this.views[this.tab] = { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
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
    if (this.exporting || !this.size) return;
    if (!this.bounds) {
      return notify({ title: "PNG", body: "포인터를 다이어그램 위에 한 번 올린 뒤 다시 눌러 주세요", level: "info", timeout: 4000 });
    }
    const saved = { view: this.views[this.tab], selected: this.selected, hovered: this.hovered };
    Object.assign(this, { exporting: true, selected: null, hovered: null });
    this.views[this.tab] = null;
    this.redraw(cx);
    const done = (cx) => {
      this.exporting = false;
      this.selected = saved.selected;
      this.views[this.tab] = saved.view;
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
        const b = this.bounds, top = b.y + HEADER_H + TABS_H;
        const crop = [this.size.height, this.size.width, top, b.x].map((v) => String(Math.round(v * s)));
        const r = await exec("sips", ["-c", crop[0], crop[1], "--cropOffset", crop[2], crop[3], tmp, "--out", out]);
        await exec("rm", ["-f", tmp]);
        if (r.code !== 0) throw new Error(r.stderr || r.stdout);
        await exec("osascript", ["-e", `set the clipboard to (read (POSIX file "${out}") as «class PNGf»)`]);
        notify({ title: "PNG 저장, 클립보드에 복사", body: out, level: "success", timeout: 5000 });
      } catch (err) {
        notify({ title: "PNG를 만들지 못했어요", body: String(err?.message ?? err), level: "error" });
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
    this.paneFocused = !!all.find((p) => p.mod === MOD)?.focused;
    this.targetList = this.targets(all);
    const G = this.graphs[this.tab];
    const narrow = this.width > 0 && this.width < 420;
    return v_flex()
      .id("bp-root")
      .size_full()
      .bg(t.background)
      .text_size(13)
      .track_focus(this.focus)
      .on_size_change((s, cx) => {
        // Only on a real change: a notify here re-renders, which reports again.
        if (Math.abs(s.width - this.width) < 0.5) return;
        this.width = s.width;
        this.redraw(cx);
      })
      .on_mouse_move((e) => (this.bounds = e.bounds ?? this.bounds))
      .on_mouse_down("left", () => this.focus.focus())
      .on_key_down((e, cx) => {
        const k = e.keystroke;
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
        else if (/^[1-9]$/.test(k)) this.setTab(Number(k) - 1);
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

  header(t, pal, G, narrow) {
    const a = this.pickTarget(this.targetList);
    const c = a ? { working: pal.active, blocked: t.blocked, done: pal.done }[a.status] ?? t.muted : t.dim;
    const said = a?.status ? STATUS[a.status] : null;
    const text = !a ? "에이전트 없음" : narrow ? said ?? a.name : said ? `${a.name} · ${said}` : a.name;
    const pill = h_flex().flex_none().gap(6).px(10).h(24).rounded_full().items_center().bg(alpha(c, 0.14))
      .child(div().w(7).h(7).rounded_full().bg(c))
      .child(div().text_size(12).text_color(c).child(text));
    return h_flex().h(HEADER_H).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
      .when(!narrow, (el) => el.child(div().flex_none().text_color(t.muted).child("Blueprint")))
      .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(G.g.title ?? G.tab))
      .child(pill)
      .child(div().flex_none().text_size(12).text_color(t.muted).child(ago(G.loaded)))
      .child(div().id("bp-edit").flex_none().h(26).px(10).flex().items_center().rounded(6).border(1).text_size(12)
        .cursor_pointer().border_color(this.editing ? alpha(t.accent, 0.6) : t.border)
        .text_color(this.editing ? t.accent : t.foreground)
        .when(this.editing, (el) => el.bg(alpha(t.accent, 0.16)))
        .when(!this.editing, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => {
          this.setEditing(!this.editing);
          this.redraw(cx);
        })
        .child(this.editing ? "수정 중" : "수정"));
  }

  tabs(t) {
    return h_flex().h(TABS_H).flex_none().px(10).gap(2).items_center().border_b(1).border_color(t.border)
      .children(this.graphs.map((d, i) => {
        const on = i === this.tab;
        return div().id(`bp-tab-${i}`).px(10).py(4).rounded(6).text_size(12).cursor_pointer()
          .text_color(on ? t.foreground : t.muted)
          .when(on, (el) => el.bg(t.raised))
          .when(!on, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
          .on_click((_e, cx) => {
            this.setTab(i);
            this.redraw(cx);
          })
          .child(d.tab);
      }));
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
        const v = this.current().v;
        const p = e.local_position ?? (e.bounds ? { x: e.position.x - e.bounds.x, y: e.position.y - e.bounds.y } : { x: this.size.width / 2, y: this.size.height / 2 });
        if (e.modifiers.control || e.modifiers.platform) this.zoomAt(Math.exp(e.delta.y * 0.003), p.x, p.y);
        else this.views[this.tab] = { ...v, x: v.x + e.delta.x, y: v.y + e.delta.y };
        this.redraw(cx);
      })
      .on_mouse_down("left", (e) => {
        this.drag = { x: e.position.x, y: e.position.y, v: { ...this.current().v }, moved: false };
      })
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d) return;
        const dx = e.position.x - d.x, dy = e.position.y - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 3) return;
        d.moved = true;
        this.views[this.tab] = { ...d.v, x: d.v.x + dx, y: d.v.y + dy };
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
    return el.children(this.drawing(t, pal))
      .when(this.editing, (el) => el.child(h_flex().absolute().left(12).top(12).gap(6).px(10).h(26).items_center().rounded(6)
        .bg(alpha(t.accent, 0.16)).border(1).border_color(alpha(t.accent, 0.5)).text_size(12).text_color(t.accent)
        .child(div().font_semibold().child("수정 모드"))
        .child(div().text_color(t.muted).child(this.compose ? "Enter 보내기 · Esc 취소" : "바꿀 노드를 누르세요 · Esc 끝내기"))))
      .when(!!this.compose, (el) => el.child(this.composer(t)));
  }

  // The request box: which node, who gets it, what to change.
  composer(t) {
    const n = this.graph.nodes.get(this.compose.id);
    if (!n) return div();
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
        .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(n.title))
        .when(!!n.ref, (el) => el.child(div().min_w(0).truncate().text_size(11).font_family(this.mono).text_color(t.muted).child(n.ref)))
        .child(div().flex_1())
        .child(div().id("bp-target").flex_none().px(8).h(22).flex().items_center().rounded(6).text_size(11.5)
          .bg(alpha(target ? t.accent : t.blocked, 0.12)).text_color(target ? t.accent : t.blocked)
          .when(list.length > 1, (el) => el.cursor_pointer().on_click((_e, cx) => { next(); this.redraw(cx); }))
          .child(target ? `→ ${target.name}${list.length > 1 ? " ⇄" : ""}` : "보낼 에이전트 없음")))
      .child(Input.new(this.input).h(34).px(10).rounded(8).border(1).border_color(this.typing ? t.accent : t.input)
        .bg(t.background).text_size(13).text_color(t.foreground))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
          .child(target ? "박스, 소스 위치, 연결된 코드와 함께 보냅니다" : "이 탭에 에이전트를 열면 보낼 수 있어요"))
        .child(button("bp-cancel", "취소", false, true, () => this.closeCompose()))
        .child(button("bp-send", this.sending ? "보내는 중…" : "보내기", true, ready, (cx) => this.send(cx))));
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
      const color = { active: alpha(pal.active, 0.45), dim: alpha(t.muted, 0.18), lit: t.foreground, plain: alpha(t.muted, 0.75) }[look];
      const gr = lineGroup(`${look}:${dashed}`, color, look === "lit" || active ? 1.6 : 1.25, dashed ? [4, 4] : null);
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
      this.vers = this.vers.map((v) => v + 1);
    }
    const missing = (i) => [...this.graphs[i].g.nodes.keys()].some((id) => !this.measured[`n:${i}:${id}`])
      || this.graphs[i].g.edges.some((e, k) => e.label && !this.measured[`e:${i}:${k}`]);
    const order = [this.tab, ...this.graphs.keys()].filter((i, k, a) => a.indexOf(i) === k);
    const next = order.find(missing);
    if (next === undefined) return els;
    [next].forEach((i) => {
      const { g } = this.graphs[i];
      for (const n of g.nodes.values()) {
        const key = `n:${i}:${n.id}`;
        if (this.measured[key]) continue;
        els.push(v_flex().id(`bp-m-${key}`).absolute().left(0).top(0).opacity(0).items_center().gap(2)
          .child(div().whitespace_nowrap().text_size(TITLE).font_semibold().child(n.title))
          .when(!!n.sub, (el) => el.child(div().whitespace_nowrap().text_size(SUB).font_family(mono).child(n.sub)))
          .on_size_change((s, cx) => this.measure(key, s, cx)));
      }
      g.edges.forEach((e, k) => {
        const key = `e:${i}:${k}`;
        if (!e.label || this.measured[key]) return;
        els.push(div().id(`bp-m-${key}`).absolute().left(0).top(0).opacity(0).px(5).py(1).whitespace_nowrap().text_size(LABEL)
          .child(e.label).on_size_change((s, cx) => this.measure(key, s, cx)));
      });
    });
    return els;
  }

  // Sizes arrive one callback per element in the same frame; draw once for all.
  measure(key, s, cx) {
    const old = this.measured[key];
    if (old && Math.abs(old.w - s.width) < 0.5 && Math.abs(old.h - s.height) < 0.5) return;
    this.measured[key] = { w: s.width, h: s.height };
    this.vers[Number(key.split(":")[1])]++;
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
    const { v } = this.size ? this.current() : { v: { z: 1 } };
    const fitted = !this.views[this.tab];
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
        .when(!narrow && !this.editing, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("수정하려면 E")))
      : div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted)
        .child(this.editing ? "바꿀 노드를 누르면 담당 에이전트에게 요청해요"
          : narrow ? "노드를 눌러 흐름 보기" : "노드를 누르면 연결된 흐름만 강조돼요 · E 수정 모드 · 드래그로 이동 · ⌘ 스크롤로 확대");
    return h_flex().h(FOOTER_H).flex_none().px(12).gap(6).items_center().border_t(1).border_color(t.border)
      .child(info)
      .child(button("bp-fit", "맞춤", (cx) => this.command("fit", cx), (el) => el.when(fitted, (e) => e.text_color(t.muted))))
      .child(zoom)
      .child(button("bp-png", this.exporting ? "저장 중…" : "PNG", (cx) => this.exportPng(cx)));
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
