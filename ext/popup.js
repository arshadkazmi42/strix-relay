const $ = (id) => document.getElementById(id);

async function refresh() {
  const { relayUrl = "(not set — open Options)" } = await chrome.storage.local.get("relayUrl");
  $("url").textContent = relayUrl;
  try {
    const r = await chrome.runtime.sendMessage({ type: "__status" });
    if (r?.connected) { $("ws").textContent = "connected";    $("ws").className = "ok"; }
    else               { $("ws").textContent = "disconnected"; $("ws").className = "bad"; }
    $("dt").textContent = r?.devtools ? "attached" : "not attached";
    $("dt").className   = r?.devtools ? "ok" : "k";
    $("pin").textContent = (r?.pinnedTabId ?? null) === null ? "(none)" : String(r.pinnedTabId);
  } catch {
    $("ws").textContent = "bg unreachable"; $("ws").className = "bad";
  }
}

$("pinBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  await chrome.runtime.sendMessage({ type: "__pin", tabId: tab.id });
  refresh();
});
$("unpinBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "__pin", tabId: null });
  refresh();
});
$("optBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
