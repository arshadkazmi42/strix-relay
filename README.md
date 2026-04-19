# Strix Relay

Single-user Chrome extension + local relay + Cloudflare tunnel. Lets a remote
process drive your logged-in browser across any domain. Built for authorized
bug-bounty work.

## Quickstart

```bash
./setup.sh     # installs bun + cloudflared, generates .token (idempotent)
./start.sh     # starts relay on :9876 and a trycloudflare.com tunnel
./stop.sh      # stops everything
./status.sh    # quick status check
```

The one manual step is loading the unpacked extension:

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select the `./ext` folder.
3. Extension → **Details** → **Extension options**.
4. Paste the Relay URL (`ws://localhost:9876/ws`) and the token printed by
   `./start.sh`, then **Save & Reload**.
5. Open any tab. The extension auto-connects to the relay.
6. (Optional but recommended) Open DevTools on the target tab so
   `/v1/netlog` can capture full bodies.

`./start.sh` prints the public `https://*.trycloudflare.com` URL and the
bearer token. Put those in your remote process; every request must carry
`Authorization: Bearer <token>`.

## HTTP API

All endpoints require `Authorization: Bearer <TOKEN>`.

| Method | Path            | Description |
|--------|-----------------|-------------|
| GET    | `/v1/health`    | `{extConnected, devtoolsAttached, version}` |
| GET    | `/v1/tabs`      | every tab across all windows |
| POST   | `/v1/openTab`   | `{url, active?}` |
| POST   | `/v1/tabSelect` | `{tabId}` pins the default tab |
| POST   | `/v1/eval`      | `{code, tabId?, world?}` |
| POST   | `/v1/fetch`     | `{url, method?, headers?, body?, credentials?, tabId?}` |
| POST   | `/v1/click`     | `{selector}` or `{x, y}` |
| GET    | `/v1/docids`    | harvested GraphQL doc_ids (`?filter=<substr>`) |
| GET    | `/v1/ws-frames` | captured WebSocket frames (`?since=<iso>&direction=in\|out\|both&host=<substr>`) |
| GET    | `/v1/netlog`    | DevTools-captured requests with bodies (requires DevTools open) |

Error codes:
- `401` bad / missing token
- `400` no active tab
- `412` `/v1/netlog` without DevTools attached
- `503` extension not connected

## Security

**This extension can run arbitrary JavaScript in any tab and read cookies on
every site the user visits. Anyone with the bearer token + the public tunnel
URL has full control of the browser.**

- Token is generated locally; transport to/from the tunnel is HTTPS via
  cloudflared.
- Run `./stop.sh` whenever not actively using the relay.
- Regenerate the token after each engagement: `rm .token && ./setup.sh`.
- **STRONGLY recommend** running this in a dedicated Chrome profile used only
  for bug-bounty work, so the extension cannot reach personal tabs.
- Pages with strict CSP may block `/v1/eval` (uses `new Function` in MAIN
  world). Workaround: run the code via DevTools console, or open DevTools
  and use `/v1/netlog` for passive capture instead.

## Files

```
setup.sh start.sh stop.sh status.sh .gitignore relay.ts README.md
ext/
  manifest.json background.js content.js page-script.js
  devtools.html devtools.js options.html options.js icon128.png
```

No runtime deps beyond Bun + cloudflared. No build step.
