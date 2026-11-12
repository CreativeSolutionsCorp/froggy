#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVER_PID=""
cleanup() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

npm run start:server > /tmp/market-coach-server.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS http://localhost:3001/health >/tmp/market-coach-health.json 2>/dev/null; then
    break
  fi

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "The server failed to start."
    cat /tmp/market-coach-server.log
    exit 1
  fi

  sleep 1
done

curl -fsS http://localhost:3001/health | grep -q '"ok":true'
printf 'Smoke test passed: server health is responding.\n'
