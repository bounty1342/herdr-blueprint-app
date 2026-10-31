#!/bin/sh
# Copy the mod into the Herdr app so it hot-reloads: Herdr does not notice
# edits behind a symlinked mod folder, so the app gets real files.
#   scripts/sync.sh          copy once
#   scripts/sync.sh --watch  copy again whenever a file changes (Ctrl-C to stop)
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
src="$here/mods/blueprint/"
dst="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/blueprint/"

sync_once() {
  # A symlink left from an older setup would make rsync write into the project.
  [ -L "${dst%/}" ] && rm "${dst%/}"
  mkdir -p "$dst"
  rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude '.*' "$src" "$dst"
}

sync_once
echo "synced -> $dst"
[ "${1:-}" = "--watch" ] || exit 0
last=""
while :; do
  now=$(find "$src" -type f ! -name 'gpui-kit.d.ts' ! -name 'jsconfig.json' -exec stat -f '%m %N' {} + | sort | shasum)
  if [ "$now" != "$last" ]; then
    [ -n "$last" ] && sync_once && echo "synced $(date +%T)"
    last=$now
  fi
  sleep 1
done
