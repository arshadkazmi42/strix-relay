// Runs in MAIN world on every page. Proxies fetch and WebSocket.
(() => {
  if (window.__strix) return;
  const fetchLog = [], wsLog = [];
  const origFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const ts = Date.now();
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method) || (typeof input !== "string" && input && input.method) || "GET").toUpperCase();
    const reqHeaders = {};
    try {
      const h = init && init.headers;
      if (h instanceof Headers) h.forEach((v, k) => reqHeaders[k] = v);
      else if (Array.isArray(h)) for (const [k, v] of h) reqHeaders[k] = v;
      else if (h) Object.assign(reqHeaders, h);
    } catch {}
    let reqBody = null;
    try { if (init && init.body) reqBody = typeof init.body === "string" ? init.body : "[non-string]"; } catch {}
    let resp;
    try { resp = await origFetch(input, init); }
    catch (e) {
      pushFetch({ ts, url, method, status: 0, error: String(e?.message || e), requestHeaders: reqHeaders, requestBody: reqBody });
      throw e;
    }
    const clone = resp.clone();
    clone.text().then(text => {
      const hdrs = {}; clone.headers.forEach((v, k) => hdrs[k] = v);
      let bodyJson; try { bodyJson = JSON.parse(text); } catch {}
      pushFetch({ ts, url, method, status: resp.status,
        requestHeaders: reqHeaders, requestBody: reqBody,
        responseHeaders: hdrs, responseBody: text, responseBodyJson: bodyJson });
      try { if (/\/graphql(\W|$)/i.test(url) && reqBody) harvestGraphQL(url, reqBody); } catch {}
    }).catch(() => {});
    return resp;
  };
  function pushFetch(e) { fetchLog.push(e); if (fetchLog.length > 500) fetchLog.shift(); }

  function harvestGraphQL(url, body) {
    let src = null;
    try { src = JSON.parse(body); } catch {}
    if (!src) { try { const sp = new URLSearchParams(body); src = {}; for (const [k, v] of sp) src[k] = v; } catch {} }
    if (!src) return;
    const doc_id = src.doc_id || src.queryId || src.hash || null;
    const friendly_name = src.fb_api_req_friendly_name || src.operationName || null;
    if (!doc_id && !friendly_name) return;
    let variables = src.variables;
    if (typeof variables === "string") { try { variables = JSON.parse(variables); } catch {} }
    let origin; try { origin = new URL(url, location.href).origin; } catch { origin = location.origin; }
    window.postMessage({ __strix: true, kind: "docid", payload: {
      origin, friendly_name, doc_id,
      last_variables: variables ?? null,
      last_seen_iso: new Date().toISOString()
    } }, "*");
  }

  const OrigWS = window.WebSocket;
  function StrixWS(url, protocols) {
    const ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
    const origSend = ws.send.bind(ws);
    ws.send = function (data) {
      pushWS({ ts: Date.now(), direction: "out", url: String(url), payload: data });
      return origSend(data);
    };
    ws.addEventListener("message", (ev) =>
      pushWS({ ts: Date.now(), direction: "in", url: String(url), payload: ev.data }));
    return ws;
  }
  StrixWS.prototype = OrigWS.prototype;
  StrixWS.CONNECTING = OrigWS.CONNECTING; StrixWS.OPEN = OrigWS.OPEN;
  StrixWS.CLOSING = OrigWS.CLOSING; StrixWS.CLOSED = OrigWS.CLOSED;
  try { window.WebSocket = StrixWS; } catch {}

  function pushWS(raw) {
    let payloadText = null, payloadHex = null;
    try {
      const p = raw.payload;
      if (typeof p === "string") payloadText = p;
      else if (p instanceof ArrayBuffer) {
        payloadHex = Array.from(new Uint8Array(p)).map(x => x.toString(16).padStart(2, "0")).join("");
      } else if (typeof Blob !== "undefined" && p instanceof Blob) payloadText = `[blob ${p.size}B ${p.type}]`;
      else payloadText = String(p);
    } catch {}
    const e = { ts: raw.ts, direction: raw.direction, url: raw.url, payloadText, payloadHex };
    wsLog.push(e); if (wsLog.length > 1000) wsLog.shift();
    try { window.postMessage({ __strix: true, kind: "wsframe", payload: e }, "*"); } catch {}
  }

  window.__strix = {
    eval: (code) => (new Function(`"use strict"; return (async () => { ${code} })();`))(),
    fetch: (u, i) => fetch(u, i),
    fetchLog: () => fetchLog.slice(),
    wsLog: () => wsLog.slice()
  };
})();
