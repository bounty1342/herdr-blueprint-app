#!/bin/sh
# Type into Blueprint's request box as a person would: one note- command per
# character (Blueprint's note-<text> sets the box; "_" stands for a space).
# Usage: scripts/demo/type.sh "add rate limiting here" [seconds per character]
set -eu
. "$(dirname "$0")/env.sh"
text=$(printf %s "$1" | tr ' ' '_')
delay=${2:-0.06}
i=1
while [ $i -le ${#text} ]; do
  herdr-app do "blueprint.note-$(printf %s "$text" | cut -c1-$i)" >/dev/null
  sleep "$delay"
  i=$((i + 1))
done
