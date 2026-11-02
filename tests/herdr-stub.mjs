export const state = { settings: { zoom: 1, font_family: "mono" } };

// An element: every call is recorded and chains; when/children/child behave.
export function el(kind = "div") {
  const rec = { kind, props: {}, kids: [], handlers: {} };
  const self = new Proxy(rec, {
    get(t, name) {
      if (name in t) return t[name];
      if (name === "then") return undefined;
      return (...args) => {
        if (name === "when") return args[0] ? args[1](self) : self;
        if (name === "child") { t.kids.push(args[0]); return self; }
        if (name === "children") { t.kids.push(...args[0]); return self; }
        if (name.startsWith("on_")) { t.handlers[name] = args[args.length - 1]; return self; }
        t.props[name] = args.length === 1 ? args[0] : args;
        return self;
      };
    },
  });
  return self;
}

class PB {
  constructor(kind, width, ops = [], dash = null) { Object.assign(this, { kind, width, ops, dash }); }
  static stroke(w) { return new PB("stroke", w); }
  static fill() { return new PB("fill", null); }
  op(...o) { return new PB(this.kind, this.width, [...this.ops, o], this.dash); }
  dash_array(d) { return new PB(this.kind, this.width, this.ops, d); }
  move_to(x, y) { return this.op("M", x, y); }
  line_to(x, y) { return this.op("L", x, y); }
  cubic_bezier_to(x, y, a, b, c, d) { return this.op("C", x, y, a, b, c, d); }
  arc_to(rx, ry, r, l, s, x, y) { return this.op("A", rx, ry, r, l, s, x, y); }
  add_polygon(pts, c) { return this.op("P", pts, c); }
  close() { return this.op("Z"); }
  build() { return { kind: this.kind, width: this.width, ops: this.ops, dash: this.dash }; }
}
export const PathBuilder = PB;
export class View {}
export const div = () => el("div");
export const svg = () => el("svg");
export const v_flex = () => el("v_flex");
export const h_flex = () => el("h_flex");
export class InputState {}
export const Input = { new: () => el("input") };

globalThis.window = { paint_path: (path, color) => Object.assign(el("path"), { path, color }), viewport_size: () => ({ width: 1000, height: 800 }) };

export const settings = () => state.settings;
const none = () => null, list = () => [];
export const theme = () => ({}), agents = list, panes = list, spaces = list, focused = none, props = () => ({}), knownAgents = list;
export const exec = async () => ({ code: 0, stdout: "", stderr: "" }), hc = none, run = none, home = () => "/tmp", appHome = () => "/tmp";
export const notify = none, readTextFile = async () => "", writeTextFile = async () => {}, watchFolder = none, nextCommand = none;
export const shared = none, setShared = none, window = none;
