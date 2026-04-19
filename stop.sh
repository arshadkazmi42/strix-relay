#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

killit() {
  local name=$1 pidfile=$2 pid
  [ -f "$pidfile" ] || { echo "$name: no pidfile"; return 0; }
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for i in 1 2 3 4 5 6; do kill -0 "$pid" 2>/dev/null && sleep 0.5 || break; done
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
    echo "killed $name (pid $pid)"
  else
    echo "$name: not running (stale pidfile)"
  fi
  rm -f "$pidfile"
}

killit relay  relay.pid
killit tunnel tunnel.pid
