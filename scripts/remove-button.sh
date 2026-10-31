#!/bin/sh
# Undo add-button.sh: back to Herdr's own layout, clones deleted.
set -eu
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
herdr-app do layout.switch --name main >/dev/null || true
rm -f "$home/layouts/main-blueprint.json"
rm -rf "$home/mods/tabs-blueprint"
echo "Blueprint button removed"
