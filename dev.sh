#!/usr/bin/env bash
# Launches the API server (server/) and the frontend (app/) together.
# Ctrl+C stops both.
set -e

cd "$(dirname "$0")"

cleanup() {
  kill "$SERVER_PID" "$APP_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

(cd server && npm run dev) &
SERVER_PID=$!

(cd app && npm run dev) &
APP_PID=$!

wait
