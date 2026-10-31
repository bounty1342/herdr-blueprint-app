#!/bin/sh
# Undo add-button.sh: back to the layout used before it, clones deleted.
set -eu
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
prev_file="$home/layouts/.state/blueprint-previous-layout"
herdr-app do layout.switch --name "$(cat "$prev_file" 2>/dev/null || echo main)" >/dev/null || true
rm -f "$prev_file"
rm -f "$home/layouts/main-blueprint.json"
rm -rf "$home/mods/tabs-blueprint"
echo "Blueprint button removed"
