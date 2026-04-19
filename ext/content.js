// Inject page-script.js into the MAIN world and bridge its messages to background.
(() => {
  try {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("page-script.js");
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.addEventListener("load", () => s.remove());
  } catch {}

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__strix !== true) return;
    if (d.kind === "docid")   chrome.runtime.sendMessage({ type: "docid",   data: d.payload }).catch(() => {});
    if (d.kind === "wsframe") chrome.runtime.sendMessage({ type: "wsframe", data: d.payload }).catch(() => {});
  });
})();
