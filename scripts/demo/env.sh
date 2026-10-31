# Source this: a Herdr window, core and terminals of their own for the demo,
# so nothing from your own setup (spaces, terminals, layouts) shows up.
#   . scripts/demo/env.sh
# Everything lives under /Users/Shared so no user name shows in paths on
# screen. The window gets a home of its own there (mods may only read files
# in the home folder, and Blueprint keeps its data in the app folder); the
# terminals get your real home back, so Claude Code stays signed in.
DEMO="${BLUEPRINT_DEMO_DIR:-/Users/Shared/blueprint-demo}"
REC="${BLUEPRINT_DEMO_REC:-/Users/Shared/blueprint-demo-rec}"
REAL_HOME="${REAL_HOME:-$HOME}"
export HERDR_APP_HOME="$DEMO/home/.config/herdr-app"
export XDG_STATE_HOME="$DEMO/state"
export XDG_CONFIG_HOME="$DEMO/config"
export HC_SESSION=bpdemo
export ZDOTDIR="$DEMO/zsh"
