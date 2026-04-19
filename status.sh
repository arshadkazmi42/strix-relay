#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

pidalive() {
  local f=$1 p
  [ -f "$f" ] || { echo "no"; return; }
  p=$(cat "$f")
  if kill -0 "$p" 2>/dev/null; then echo "yes (pid $p)"; else echo "no (stale pidfile)"; fi
}

URL=""
[ -f relay-url.txt ] && URL=$(sed 's/^RELAY_URL=//' relay-url.txt)

echo "relay  : $(pidalive relay.pid)"
echo "tunnel : $(pidalive tunnel.pid)"
echo "url    : ${URL:-unknown}"

if [ -f .token ] && [ -f relay.pid ] && kill -0 "$(cat relay.pid)" 2>/dev/null; then
  TOKEN=$(cat .token)
  HEALTH=$(curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:9876/v1/health 2>/dev/null || true)
  echo "health : ${HEALTH:-unreachable}"
fi
