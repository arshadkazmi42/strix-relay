// Strix service worker: maintains WS to relay, routes commands to tabs.
const DEFAULT_URL = "ws://localhost:9876/ws";
let relayUrl = DEFAULT_URL, token = "";
let ws = null, backoff = 1000, reconnectTimer = null;
let pinnedTabId = null, devtoolsPort = null;
const docidsMap = new Map(); // aggregated across tabs
const wsFrames = [];

async function loadSettings() {
  const s = await chrome.storage.local.get(["relayUrl", "token"]);
  relayUrl = s.relayUrl || DEFAULT_URL; token = s.token || "";
}
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 30000);
}
async function connect() {
  await loadSettings();
  if (!token) { scheduleReconnect(); return; }
  let u;
  try { u = new URL(relayUrl); u.searchParams.set("token", token); }
  catch { scheduleReconnect(); return; }
  try { ws = new WebSocket(u.toString()); } catch { scheduleReconnect(); return; }
  ws.onopen = () => { backoff = 1000; notifyDevtools(); };
  ws.onerror = () => { try { ws?.close(); } catch {} };
  ws.onclose = () => { ws = null; scheduleReconnect(); };
  ws.onmessage = async (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    const { id, type, payload } = m;
    try {
      const result = await handle(type, payload || {});
      safeSend({ id, type: "response", ok: true, result });
    } catch (e) {
      safeSend({ id, type: "response", ok: false, error: String(e?.message || e) });
    }
  };
}
function safeSend(o) { try { ws?.send(JSON.stringify(o)); } catch {} }

async function resolveTab(tabId) {
  if (typeof tabId === "number") return tabId;
  if (pinnedTabId !== null) { try { await chrome.tabs.get(pinnedTabId); return pinnedTabId; } catch {} }
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!t) throw new Error("no active tab");
  return t.id;
}
async function exec(tabId, func, args, world = "MAIN") {
  const r = await chrome.scripting.executeScript({ target: { tabId }, world, func, args: [args] });
  return r[0]?.result;
}

// ---- functions injected into MAIN world ----
function _evalInPage(a) {
  const logs = []; const _o = console.log;
  console.log = (...xs) => {
    try { logs.push(xs.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ")); }
    catch { logs.push(String(xs)); }
    _o.apply(console, xs);
  };
  const fin = (r, err) => {
    console.log = _o;
    if (err) return { ok: false, error: String(err?.message || err), stack: err?.stack, logs };
    let safe; try { safe = JSON.parse(JSON.stringify(r ?? null)); } catch { safe = String(r); }
    return { ok: true, result: safe, logs };
  };
  try {
    const p = (new Function(`"use strict"; return (async () => { ${a.code} })();`))();
    return Promise.resolve(p).then(r => fin(r, null), e => fin(null, e));
  } catch (e) { return fin(null, e); }
}
async function _fetchInPage(a) {
  try {
    const r = await fetch(a.url, {
      method: a.method || "GET", headers: a.headers || {},
      body: a.body, credentials: a.credentials || "include"
    });
    const headers = {}; r.headers.forEach((v, k) => headers[k] = v);
    const text = await r.text();
    let bodyJson; try { bodyJson = JSON.parse(text); } catch {}
    return { ok: true, status: r.status, headers, body: text, bodyJson };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}
function _clickInPage(a) {
  if (a.selector) {
    const el = document.querySelector(a.selector);
    if (!el) return { ok: false, error: "selector not found" };
    el.click(); return { ok: true };
  }
  if (typeof a.x === "number" && typeof a.y === "number") {
    const el = document.elementFromPoint(a.x, a.y);
    if (!el) return { ok: false, error: "no element at point" };
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: a.x, clientY: a.y }));
    return { ok: true };
  }
  return { ok: false, error: "need selector or x/y" };
}

// ---- command router ----
async function handle(type, p) {
  switch (type) {
    case "eval": {
      const tab = await resolveTab(p.tabId);
      const out = await exec(tab, _evalInPage, { code: p.code || "" }, p.world || "MAIN");
      return out ?? { ok: false, error: "no result (page CSP may block eval)" };
    }
    case "fetch": return await exec(await resolveTab(p.tabId), _fetchInPage, p, "MAIN");
    case "click": return await exec(await resolveTab(p.tabId), _clickInPage, p, "MAIN");
    case "tabs": {
      const ts = await chrome.tabs.query({});
      return ts.map(t => ({ id: t.id, windowId: t.windowId, url: t.url, title: t.title,
        active: t.active, audible: t.audible, incognito: t.incognito }));
    }
    case "openTab": {
      const t = await chrome.tabs.create({ url: p.url, active: p.active !== false });
      return { ok: true, tabId: t.id };
    }
    case "tabSelect": {
      pinnedTabId = p.tabId ?? null;
      try { await chrome.storage.session.set({ pinnedTabId }); } catch {}
      return { ok: true, pinnedTabId };
    }
    case "docids": {
      const f = (p.filter || "").toLowerCase();
      const all = [...docidsMap.values()];
      return f ? all.filter(x =>
        String(x.friendly_name || "").toLowerCase().includes(f) ||
        String(x.doc_id || "").toLowerCase().includes(f) ||
        String(x.origin || "").toLowerCase().includes(f)) : all;
    }
    case "wsframes": {
      const since = p.since ? Date.parse(p.since) : 0;
      const dir = p.direction || "both";
      const host = (p.host || "").toLowerCase();
      return wsFrames.filter(f => (!since || f.ts >= since) &&
        (dir === "both" || f.direction === dir) &&
        (!host || String(f.url || "").toLowerCase().includes(host)));
    }
    case "netlog": {
      if (!devtoolsPort) throw new Error("devtools not attached");
      return await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error("devtools query timeout")), 10000);
        const onMsg = (m) => {
          if (m.type !== "netlog:response") return;
          clearTimeout(to); devtoolsPort.onMessage.removeListener(onMsg); resolve(m.entries);
        };
        devtoolsPort.onMessage.addListener(onMsg);
        devtoolsPort.postMessage({ type: "netlog:query", params: p });
      });
    }
    default: throw new Error("unknown command: " + type);
  }
}

function notifyDevtools() { safeSend({ type: "event", name: "devtoolsAttached", value: !!devtoolsPort }); }

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "devtools") return;
  devtoolsPort = port; notifyDevtools();
  port.onDisconnect.addListener(() => { devtoolsPort = null; notifyDevtools(); });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === "docid") {
    const d = msg.data || {};
    const key = `${d.origin}|${d.friendly_name || ""}|${d.doc_id || ""}`;
    const prev = docidsMap.get(key);
    if (prev) {
      prev.last_variables = d.last_variables ?? prev.last_variables;
      prev.last_seen_iso = d.last_seen_iso;
      prev.count = (prev.count || 0) + 1;
    } else { docidsMap.set(key, { ...d, count: 1 }); }
  } else if (msg.type === "wsframe") {
    wsFrames.push(msg.data);
    if (wsFrames.length > 1000) wsFrames.shift();
  }
});

(async () => {
  try {
    const s = await chrome.storage.session.get("pinnedTabId");
    if (typeof s.pinnedTabId === "number") pinnedTabId = s.pinnedTabId;
  } catch {}
  connect();
})();
// Keep service worker alive while WS is open.
setInterval(() => { try { ws?.send(JSON.stringify({ type: "ping" })); } catch {} }, 20000);
