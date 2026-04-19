#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

[ -f .token ]                       || { echo "./setup.sh first (no .token)";       exit 1; }
command -v bun          >/dev/null  || { echo "./setup.sh first (bun not on PATH)"; exit 1; }
command -v cloudflared  >/dev/null  || { echo "./setup.sh first (no cloudflared)";  exit 1; }

if [ -f relay.pid ] && kill -0 "$(cat relay.pid)" 2>/dev/null; then
  echo "relay already running (pid $(cat relay.pid)). ./stop.sh first."; exit 1
fi
rm -f relay.pid tunnel.pid relay-url.txt

TOKEN=$(cat .token)

: > relay.log
nohup bun run relay.ts >>relay.log 2>&1 &
echo $! > relay.pid

# Wait for /v1/health
ready=false
for i in $(seq 1 25); do
  if curl -fsS -H "Authorization: Bearer $TOKEN" http://localhost:9876/v1/health >/dev/null 2>&1; then
    ready=true; break
  fi
  sleep 0.2
done
$ready || { echo "relay failed to start; see relay.log"; cat relay.log; exit 1; }

: > tunnel.log
nohup cloudflared tunnel --url http://localhost:9876 --no-autoupdate >>tunnel.log 2>&1 &
echo $! > tunnel.pid

URL=""
for i in $(seq 1 60); do
  U=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' tunnel.log | head -1 || true)
  if [ -n "$U" ]; then URL=$U; break; fi
  sleep 0.5
done

if [ -z "$URL" ]; then
  echo "tunnel failed to produce URL; see tunnel.log"; tail -n 40 tunnel.log; exit 1
fi
echo "RELAY_URL=$URL" > relay-url.txt

cat <<EOF
============================================================
 STRIX RELAY READY
============================================================
 Public URL : $URL
 Token      : $TOKEN
 Logs       : tail -f relay.log tunnel.log
 Stop       : ./stop.sh

 Quick test:
   curl -H "Authorization: Bearer $TOKEN" $URL/v1/health

 Extension setup (one-time):
   1. Open chrome://extensions, enable Developer mode.
   2. Click "Load unpacked" and select the ./ext folder in this directory.
   3. Click the extension's "Details" → "Extension options".
   4. Paste:
        Relay URL : ws://localhost:9876/ws
        Token     : $TOKEN
      and click Save.
   5. Open any tab. The extension auto-connects.
   6. (Optional but recommended) Open DevTools on the target tab so the
      /v1/netlog endpoint can capture full request/response bodies.
============================================================
EOF
