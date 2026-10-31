#!/bin/sh
# Put a Blueprint button next to Files and Changes in the tab bar; it opens
# Blueprint as a side panel. Herdr's own `main` layout and `tabs` mod are
# read-only (replaced on every start), so this clones them as main-blueprint
# and tabs-blueprint, patches the clones and switches the window to them.
#
# Clones are yours and never updated by Herdr. After a Herdr release changes
# the tab bar or the main layout, run scripts/remove-button.sh, then this again.
# Running this twice is fine: steps already done are skipped.
set -eu
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

[ -d "$home/mods/tabs-blueprint" ] || herdr-app do mod.clone '{"name":"tabs","as":"tabs-blueprint"}' >/dev/null
[ -f "$home/layouts/main-blueprint.json" ] || herdr-app do layout.clone '{"name":"main","as":"main-blueprint"}' >/dev/null

python3 - "$home" <<'PY'
import json, sys
home = sys.argv[1]

# The tab bar: list "blueprint" among the panels and add its button after Changes.
p = f"{home}/mods/tabs-blueprint/main.js"
s = open(p).read()
if '"blueprint"' not in s:
    enabled = 'const enabled = shared("workspace.panels") ?? ["files", "changes"];'
    changes = 'el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))'
    if enabled not in s or changes not in s:
        sys.exit("tabs-blueprint: the tab bar changed in this Herdr version; add the button by hand (see the comments in this script)")
    s = s.replace(enabled, 'const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "blueprint"];', 1)
    s = s.replace(changes, changes + '\n      .child(panelButton("blueprint", "Blueprint", "mods/blueprint/icon.svg"))', 1)
    open(p, "w").write(s)

# The layout: the cloned tab bar, and Blueprint as a third panel.
p = f"{home}/layouts/main-blueprint.json"
d = json.load(open(p))
def find(n, id):
    if isinstance(n, dict):
        if n.get("id") == id: return n
        for c in n.get("children", []):
            f = find(c, id)
            if f: return f
    return None
find(d, "tabs")["content"]["mod"] = "tabs-blueprint"
body = find(d, "panel-body")
if not any(c.get("id") == "blueprint" for c in body["children"]):
    body["children"].append({"id": "blueprint", "type": "block", "content": {"mod": "blueprint", "props": {"panel": True}}})
json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
open(p, "a").write("\n")
PY

herdr-app check "$home/mods/tabs-blueprint" >/dev/null
herdr-app do layout.switch --name main-blueprint >/dev/null
echo "Blueprint button added: layout main-blueprint (ctrl-shift-l switches back)"
