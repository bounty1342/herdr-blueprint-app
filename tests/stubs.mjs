// Stand-ins for Herdr's modules ("gpui-kit", "gpui-base", "herdr") so the mod's
// files load in Node. Elements record the calls made on them; PathBuilder
// records its geometry as given (Herdr paints it as real px).
import { registerHooks } from "node:module";

const STUB = new URL("./herdr-stub.mjs", import.meta.url).href;
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "gpui-kit" || spec === "gpui-base" || spec === "herdr") return { url: STUB, shortCircuit: true }; // one instance, so tests share its state
    return next(spec, ctx);
  },
});
