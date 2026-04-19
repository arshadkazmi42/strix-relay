// Bun HTTP + WS relay. Single file.
// WS auth note: browsers can't set Authorization on WebSocket, so the extension
// passes the bearer as ?token=<hex> on /ws. HTTP clients use the Authorization header.
import { readFileSync, appendFileSync } from "node:fs";

const TOKEN = readFileSync("./.token", "utf8").trim();
const PORT = 9876;
const VERSION = "0.1.0";
const AUDIT_PATH = "./audit.log";
const AUDIT_MAX_BODY = 4096;
const AUDIT_BUF_SIZE = 1000;

type WSData = { authed: boolean };
type Pending = { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> };
type Audit = { ts: string; method: string; path: string; remote: string; status: number; ms: number; request: string | null; response: string | null };

let extSocket: any = null;
let devtoolsAttached = false;
const pending = new Map<string, Pending>();
const auditBuf: Audit[] = [];

function truncate(s: string): string {
  return s.length > AUDIT_MAX_BODY ? s.slice(0, AUDIT_MAX_BODY) + `…[+${s.length - AUDIT_MAX_BODY}B]` : s;
}
function auditPush(e: Audit) {
  auditBuf.push(e);
  if (auditBuf.length > AUDIT_BUF_SIZE) auditBuf.shift();
  try { appendFileSync(AUDIT_PATH, JSON.stringify(e) + "\n"); } catch {}
}

const authOK = (req: Request) =>
  (req.headers.get("Authorization") || "") === `Bearer ${TOKEN}`;

const json = (obj: any, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

function send(type: string, payload: any, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!extSocket) return reject(new Error("extension not connected"));
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("timeout")); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try { extSocket.send(JSON.stringify({ id, type, payload })); }
    catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
  });
}

async function wrap(p: Promise<any>): Promise<Response> {
  try { return json(await p); }
  catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === "extension not connected") return json({ ok: false, error: msg }, 503);
    return json({ ok: false, error: msg }, 500);
  }
}

async function route(req: Request, u: URL): Promise<Response> {
  const path = u.pathname;
  if (path === "/v1/health" && req.method === "GET")
    return json({ ok: true, extConnected: !!extSocket, devtoolsAttached, version: VERSION, auditBuffered: auditBuf.length });

  if (path === "/v1/eval"      && req.method === "POST") return wrap(send("eval",      await req.json()));
  if (path === "/v1/fetch"     && req.method === "POST") return wrap(send("fetch",     await req.json()));
  if (path === "/v1/click"     && req.method === "POST") return wrap(send("click",     await req.json()));
  if (path === "/v1/tabs"      && req.method === "GET")  return wrap(send("tabs",      {}));
  if (path === "/v1/openTab"   && req.method === "POST") return wrap(send("openTab",   await req.json()));
  if (path === "/v1/tabSelect" && req.method === "POST") return wrap(send("tabSelect", await req.json()));

  if (path === "/v1/docids" && req.method === "GET")
    return wrap(send("docids", { filter: u.searchParams.get("filter") || "" }));

  if (path === "/v1/ws-frames" && req.method === "GET")
    return wrap(send("wsframes", {
      since: u.searchParams.get("since"),
      direction: u.searchParams.get("direction") || "both",
      host: u.searchParams.get("host") || ""
    }));

  if (path === "/v1/netlog" && req.method === "GET") {
    if (!devtoolsAttached)
      return json({ ok: false, error: "open DevTools on the target tab to enable /v1/netlog" }, 412);
    return wrap(send("netlog", {
      since: u.searchParams.get("since"),
      urlContains: u.searchParams.get("urlContains"),
      limit: Number(u.searchParams.get("limit") || 100)
    }));
  }

  if (path === "/v1/audit" && req.method === "GET") {
    const since = u.searchParams.get("since");
    const sinceMs = since ? Date.parse(since) : 0;
    const pc = (u.searchParams.get("pathContains") || "").toLowerCase();
    const limit = Math.max(1, Math.min(AUDIT_BUF_SIZE, Number(u.searchParams.get("limit") || 100)));
    const out = auditBuf.filter(e =>
      (!sinceMs || Date.parse(e.ts) >= sinceMs) &&
      (!pc || e.path.toLowerCase().includes(pc))
    ).slice(-limit);
    return json(out);
  }

  return json({ ok: false, error: "not found" }, 404);
}

Bun.serve({
  port: PORT,
  async fetch(req, srv) {
    const u = new URL(req.url);
    const path = u.pathname;

    if (path === "/ws") {
      const token = u.searchParams.get("token") || "";
      const hdr = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (token !== TOKEN && hdr !== TOKEN) return new Response("unauthorized", { status: 401 });
      if (srv.upgrade(req, { data: { authed: true } })) return;
      return new Response("ws upgrade failed", { status: 400 });
    }

    if (!authOK(req)) return json({ ok: false, error: "unauthorized" }, 401);

    const started = Date.now();
    let reqBody: string | null = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      try { reqBody = await req.clone().text(); } catch {}
    }

    let res: Response;
    try { res = await route(req, u); }
    catch (e: any) { res = json({ ok: false, error: String(e?.message || e) }, 500); }

    if (path !== "/v1/audit") {
      let respBody: string | null = null;
      try { respBody = await res.clone().text(); } catch {}
      auditPush({
        ts: new Date().toISOString(),
        method: req.method,
        path: u.pathname + (u.search || ""),
        remote: req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "",
        status: res.status,
        ms: Date.now() - started,
        request: reqBody ? truncate(reqBody) : null,
        response: respBody ? truncate(respBody) : null
      });
    }
    return res;
  },
  websocket: {
    open(ws) {
      if (!(ws.data as WSData)?.authed) { ws.close(1008, "unauthorized"); return; }
      if (extSocket && extSocket !== ws) { try { extSocket.close(1000, "replaced"); } catch {} }
      extSocket = ws;
      console.log("[relay] ext connected");
    },
    message(ws, raw) {
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === "response" && m.id) {
        const p = pending.get(m.id);
        if (!p) return;
        clearTimeout(p.timer); pending.delete(m.id);
        if (m.ok === false) p.reject(new Error(m.error || "error"));
        else p.resolve(m.result);
      } else if (m.type === "event" && m.name === "devtoolsAttached") {
        devtoolsAttached = !!m.value;
      }
    },
    close(ws) {
      if (extSocket === ws) { extSocket = null; devtoolsAttached = false; }
      for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error("extension disconnected")); pending.delete(id); }
      console.log("[relay] ext disconnected");
    }
  }
});

console.log(`[relay] listening on http://localhost:${PORT}`);
