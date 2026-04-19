// DevTools page: captures full request/response bodies for the inspected tab.
const port = chrome.runtime.connect({ name: "devtools" });
const entries = [];

function hdrs(arr) { const o = {}; for (const h of arr || []) o[h.name] = h.value; return o; }

chrome.devtools.network.onRequestFinished.addListener((req) => {
  req.getContent((body) => {
    entries.push({
      ts: Date.parse(req.startedDateTime) || Date.now(),
      method: req.request.method,
      url: req.request.url,
      status: req.response.status,
      requestHeaders: hdrs(req.request.headers),
      responseHeaders: hdrs(req.response.headers),
      requestBody: (req.request.postData && req.request.postData.text) || null,
      responseBody: body || null
    });
    if (entries.length > 500) entries.shift();
  });
});

port.onMessage.addListener((msg) => {
  if (msg.type !== "netlog:query") return;
  const p = msg.params || {};
  const since = p.since ? Date.parse(p.since) : 0;
  const uc = (p.urlContains || "").toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(p.limit) || 100));
  const out = entries
    .filter(e => (!since || e.ts >= since) && (!uc || e.url.toLowerCase().includes(uc)))
    .slice(-limit);
  port.postMessage({ type: "netlog:response", entries: out });
});
