const $ = (id) => document.getElementById(id);

(async () => {
  const s = await chrome.storage.local.get(["relayUrl", "token"]);
  if (s.relayUrl) $("url").value = s.relayUrl;
  if (s.token)    $("tok").value = s.token;
})();

$("save").addEventListener("click", async () => {
  const relayUrl = $("url").value.trim();
  const token    = $("tok").value.trim();
  if (!relayUrl || !token) { $("status").textContent = "URL and token required"; return; }
  await chrome.storage.local.set({ relayUrl, token });
  $("status").textContent = "Saved. Reloading extension...";
  setTimeout(() => chrome.runtime.reload(), 300);
});
