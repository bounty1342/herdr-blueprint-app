#!/bin/sh
# Start the demo window from scratch: a fresh app home with Blueprint, the
# tollgate project as a git repo, a plain zsh, and Claude Code in a tollgate
# space. Claude Code runs without your user settings (no hooks, status line or
# language from ~/.claude), in English, in auto mode, with edits allowed in
# the project and in Blueprint's data folder.
#
#   scripts/demo/start.sh            Claude Code left, Blueprint right, 1280x800
#   scripts/demo/start.sh --stack    Blueprint above Claude Code, 1280x1100
set -eu
here=$(cd "$(dirname "$0")" && pwd)
stack=false; [ "${1:-}" = "--stack" ] && stack=true
if $stack; then size="1280.0, 1100.0"; else size="1280.0, 800.0"; fi
# Drop the outer agent session and Herdr, so nothing treats this as nested.
for name in $(env | sed -n -E 's/^((HERDR_|CLAUDE|CODEX_|HC_)[A-Z_]*|AI_AGENT)=.*/\1/p'); do
  unset "$name"
done
. "$here/env.sh"
herdr-app do app.quit >/dev/null 2>&1 || true
hc server stop >/dev/null 2>&1 || true
sleep 1
rm -rf "$DEMO"
mkdir -p "$HERDR_APP_HOME/mods" "$HERDR_APP_HOME/themes" "$XDG_STATE_HOME" "$XDG_CONFIG_HOME" "$ZDOTDIR"
printf 'export HOME="%s"\nPS1="%%1~ %%# "\nHISTFILE=%s/history\n' "$REAL_HOME" "$ZDOTDIR" > "$ZDOTDIR/.zshrc"
rsync -a --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude '.*' "$here/../../mods/blueprint/" "$HERDR_APP_HOME/mods/blueprint/"
cp "$here/rose-pine.json" "$HERDR_APP_HOME/themes/"
printf '{ "zoom": 1.0, "appearance": "dark", "sounds": { "enabled": false }, "core": "%s" }\n' "$(command -v herdr-core || echo "$REAL_HOME/.local/bin/herdr-core")" > "$HERDR_APP_HOME/settings.json"
printf '{ "state": "windowed", "bounds": [60.0, 40.0, %s] }\n' "$size" > "$HERDR_APP_HOME/window.json"
printf '{ "frame.welcomed": "skipped" }\n' > "$HERDR_APP_HOME/shared.json"
# No "Updated to ..." toast: this home has seen this version.
version=$(herdr-app --version | grep -o '[0-9][0-9.]*' | head -1)
printf '{ "last_run": "%s", "presented": [] }\n' "$version" > "$HERDR_APP_HOME/update-notes.json"
# The project, as if someone had been working on it for a while.
P="$DEMO/tollgate"
cp -R "$here/tollgate" "$P"
git -C "$P" init -q -b main
git -C "$P" add -A
git -C "$P" -c user.name=demo -c user.email=demo@example.com commit -q -m "Tollgate 0.4.2"

HOME="$DEMO/home" nohup /Applications/Herdr.app/Contents/MacOS/Herdr > "$DEMO/app.log" 2>&1 &
i=0; until herdr-app status >/dev/null 2>&1; do i=$((i + 1)); [ $i -gt 50 ] && { echo "the demo window didn't start"; exit 1; }; sleep 0.2; done
herdr-app do app.theme --name rose-pine >/dev/null
argv=$(python3 -c 'import json, sys; print(json.dumps(["claude", "--setting-sources", "project", "--settings", json.dumps({"language": "english"}), "--permission-mode", "auto", "--add-dir", sys.argv[1]]))' "$HERDR_APP_HOME/data/blueprint")
herdr-app do space.new --name tollgate --folder "$P" --argv "$argv" >/dev/null
# Claude Code asks whether to trust a folder it hasn't seen.
i=0; until hc read t1 2>/dev/null | grep -q "trust this folder"; do i=$((i + 1)); [ $i -gt 50 ] && break; sleep 0.2; done
hc keys t1 down enter >/dev/null 2>&1 || true
# No sidebar: the agent and Blueprint get the whole width.
herdr-app do layout.hide --id sidebar >/dev/null
# Blueprint beside it (English: the window's home has no ~/.claude settings).
if $stack; then
  herdr-app do pane.split --direction down --mod blueprint >/dev/null
  herdr-app do pane.swap --direction up >/dev/null
else
  herdr-app do pane.split --direction right --mod blueprint >/dev/null
fi
echo "demo window up: $HERDR_APP_HOME"
