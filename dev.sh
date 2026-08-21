#!/usr/bin/env bash
# Launches the API server (server/) and the frontend (app/) together.
# Ctrl+C stops both.
#
# By default, kills any process already listening on the server/app ports
# before starting — a stale dev server left running from a previous session
# (or a crashed shell) is a common source of "why isn't my change showing up"
# confusion. Pass --no-kill to skip this and start alongside whatever's
# already running instead.
set -e

cd "$(dirname "$0")"

SERVER_PORT=8787
APP_PORT=5173
KILL_EXISTING=1

for arg in "$@"; do
  case "$arg" in
    --no-kill) KILL_EXISTING=0 ;;
  esac
done

kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti "tcp:$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Killing existing process(es) on port $port: $pids"
    kill $pids 2>/dev/null || true
  fi
}

if [ "$KILL_EXISTING" -eq 1 ]; then
  kill_port "$SERVER_PORT"
  kill_port "$APP_PORT"
fi

cleanup() {
  kill "$SERVER_PID" "$APP_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

(cd server && npm run dev) &
SERVER_PID=$!

(cd app && npm run dev) &
APP_PID=$!

wait
