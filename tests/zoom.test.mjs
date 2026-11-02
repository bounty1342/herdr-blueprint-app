// Blueprint at Herdr zoom 1 and 1.2: what Herdr puts on screen (element px x
// zoom, paths as given) must line up, and real px coming in must be divided.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state } from "./herdr-stub.mjs";
import Blueprint from "../mods/blueprint/main.js";
import { parseFlowchart } from "../mods/blueprint/mermaid.js";

const SRC = `flowchart LR
  a[package.json] --> b{check}
  b --> c[(store)]
  b --> d[done]
  d --> e[one] --> f[two] --> g[three] --> h[four] --> i[five]`;
const REAL = { width: 900, height: 500 }; // the canvas on screen
const T = new Proxy({}, { get: () => "#808080" });
const PAL = { active: "#ffcc00", done: "#00cc66" };
// On the box's outline: inside it, within 1.5 px of a side.
const onBox = (p, b) => p.x > b.x - 1.5 && p.x < b.x + b.w + 1.5 && p.y > b.y - 1.5 && p.y < b.y + b.h + 1.5
  && Math.min(Math.abs(p.x - b.x), Math.abs(p.x - b.x - b.w), Math.abs(p.y - b.y), Math.abs(p.y - b.y - b.h)) < 1.5;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.75, `${msg}: ${a} vs ${b}`);
const flat = (e, out = []) => { if (e && typeof e === "object") { out.push(e); (e.kids ?? []).forEach((c) => flat(c, out)); } return out; };

function make(k) {
  state.settings.zoom = k;
  const bp = Object.create(Blueprint.prototype);
  const g = parseFlowchart(SRC);
  Object.assign(bp, {
    graphs: [{ key: "k", rev: 1, g }], tab: 0, measured: {}, vers: {}, cache: new Map(), views: {}, dirs: {},
    size: null, selected: null, hovered: null, exporting: false, paneFocused: false, compose: null, editing: false,
    drag: null, mono: "mono", T: {}, loading: false, width: 0,
  });
  const cx = {};
  bp.redraw = () => {};
  bp.canvas(T, PAL, cx).handlers.on_size_change(REAL, cx);
  return bp;
}

// What Herdr shows: element px times zoom, accumulated down the tree; paths as is.
function screen(bp, k) {
  const els = bp.drawing(T, PAL);
  const boxes = new Map(), paths = [];
  for (const top of els) {
    const ox = (top.props.left ?? 0) * k, oy = (top.props.top ?? 0) * k;
    const id = String(top.props.id ?? "");
    if (id.startsWith("bp-n-")) boxes.set(id.split("-").pop(), { x: ox, y: oy, w: top.props.w * k, h: top.props.h * k });
    for (const e of flat(top)) if (e.path) paths.push({ ...e.path, ox, oy, id });
  }
  return { boxes, paths };
}

for (const k of [1, 1.2]) {
  test(`zoom ${k}: canvas size is layout px and fit stays inside`, () => {
    const bp = make(k);
    near(bp.size.width, REAL.width / k, "width");
    near(bp.size.height, REAL.height / k, "height");
    for (const [id, b] of screen(bp, k).boxes) {
      assert.ok(b.x >= -0.5 && b.x + b.w <= REAL.width + 0.5, `box ${id} x ${b.x}..${b.x + b.w} outside ${REAL.width}`);
      assert.ok(b.y >= -0.5 && b.y + b.h <= REAL.height + 0.5, `box ${id} y outside`);
    }
  });

  test(`zoom ${k}: edges start on their box and end at the next`, () => {
    const bp = make(k);
    const { boxes, paths } = screen(bp, k);
    const { L } = bp.current();
    const strokes = paths.filter((p) => p.kind === "stroke" && !p.id && p.ops.some((o) => o[0] === "C"));
    const starts = strokes.flatMap((p) => p.ops.filter((o) => o[0] === "M").map((o) => ({ x: o[1], y: o[2] })));
    for (const ed of L.edges) {
      const a = boxes.get(ed.e.from);
      const hit = starts.find((s) => onBox(s, a));
      assert.ok(hit, `edge ${ed.e.from}->${ed.e.to} doesn't start on ${JSON.stringify(a)}; starts ${JSON.stringify(starts)}`);
    }
    // Arrow tips touch the target.
    const tips = paths.filter((p) => p.kind === "fill" && !p.id).flatMap((p) => p.ops.map((o) => o[1][0]));
    for (const ed of L.edges) {
      const b = boxes.get(ed.e.to);
      assert.ok(tips.some(([x, y]) => onBox({ x, y }, b)), `no arrow tip on ${ed.e.to}`);
    }
    // Stroke widths scale with everything else.
    assert.ok(strokes.every((p) => p.width >= 1.25 * k - 1e-9));
  });

  test(`zoom ${k}: diamond and cylinder outlines fill their boxes`, () => {
    const bp = make(k);
    const { boxes, paths } = screen(bp, k);
    for (const id of ["b", "c"]) {
      const box = boxes.get(id);
      const xs = paths.filter((p) => p.id.endsWith(`-${id}`) && p.kind === "stroke")
        .flatMap((p) => p.ops.flatMap((o) => (o[0] === "P" ? o[1].map((q) => q[0]) : o[0] === "M" || o[0] === "L" ? [o[1]] : o[0] === "A" ? [o[6]] : [])));
      assert.ok(xs.length, `no outline for ${id}`);
      near(Math.max(...xs) + box.x, box.x + box.w - (k * 1) / 2, `${id} right edge`);
    }
  });

  test(`zoom ${k}: dot grid spans the canvas on screen`, () => {
    const bp = make(k);
    const grid = screen(bp, k).paths.find((p) => p.dash);
    const ends = grid.ops.filter((o) => o[0] === "L").map((o) => o[1]);
    assert.ok(Math.min(...ends) >= REAL.width - 0.5, `grid ends at ${Math.min(...ends)}`);
    assert.ok(Math.abs(grid.width - 1.6 * k) < 1e-9);
  });

  test(`zoom ${k}: text measured on screen becomes layout px`, () => {
    const bp = make(k);
    bp.measure("n:k@1:a", "k@1", { width: 120 * k, height: 30 * k }, { timer: { after() {} } });
    near(bp.measured["n:k@1:a"].w, 120, "w");
    near(bp.measured["n:k@1:a"].h, 30, "h");
  });

  test(`zoom ${k}: ⌘-scroll keeps the point under the pointer`, () => {
    const bp = make(k);
    const v0 = bp.current().v, real = { x: 300, y: 200 };
    const at = (v) => ({ x: (real.x / k - v.x) / v.z, y: (real.y / k - v.y) / v.z }); // drawing point under the pointer
    const before = at(v0);
    bp.canvas(T, PAL, {}).handlers.on_scroll_wheel({ local_position: real, delta: { x: 0, y: 100 }, modifiers: { platform: true } }, {});
    const v1 = bp.current().v;
    near(v1.z, v0.z * Math.exp((100 / k) * 0.003), "z");
    const after = at(v1);
    near(after.x, before.x, "x");
    near(after.y, before.y, "y");
  });

  test(`zoom ${k}: scroll and drag move the drawing with the pointer`, () => {
    const bp = make(k);
    const h = bp.canvas(T, PAL, {}).handlers;
    const v0 = bp.current().v;
    h.on_scroll_wheel({ local_position: { x: 10, y: 10 }, delta: { x: 60, y: -30 }, modifiers: {} }, {});
    const v1 = bp.current().v;
    near((v1.x - v0.x) * k, 60, "wheel x on screen");
    near((v1.y - v0.y) * k, -30, "wheel y on screen");
    h.on_mouse_down({ position: { x: 100, y: 100 } });
    bp.drag && h.on_mouse_move({ position: { x: 220, y: 140 } }, {});
    const v2 = bp.current().v;
    near((v2.x - v1.x) * k, 120, "drag x on screen");
    near((v2.y - v1.y) * k, 40, "drag y on screen");
  });
}
