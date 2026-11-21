const $ = (id) => document.getElementById(id);
const state = {server: "", token: ""};

async function init() {
  const saved = await chrome.storage.local.get(["server", "token"]);
  state.server = saved.server || "";
  state.token = saved.token || "";
  $("server").value = state.server;
  $("connection").textContent = state.token ? "Browser connected" : "Not connected";
  $("send").disabled = !state.token;
}
$("pair").addEventListener("click", async () => {
  const server = $("server").value.trim().replace(/\/+$/, "");
  const code = $("code").value.trim();
  if (!/^https:\/\//i.test(server) || !code) {
    $("status").textContent = "Enter your HTTPS Clipper address and pairing code.";
    return;
  }
  $("status").textContent = "Requesting access to your Clipper address…";
  try {
    const allowed = await chrome.permissions.request({origins: [server + "/*"]});
    if (!allowed) throw new Error("Permission was not granted for this Clipper address.");
    $("status").textContent = "Connecting…";
    const response = await fetch(server + "/api/browser/pair", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({code})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Pairing failed.");
    state.server = server; state.token = data.token;
    await chrome.storage.local.set({server, token: state.token});
    $("connection").textContent = "Browser connected";
    $("send").disabled = false;
    $("code").value = "";
    $("status").textContent = "Connected. You can now send the active YouTube video.";
  } catch (error) { $("status").textContent = error.message; }
});
$("send").addEventListener("click", async () => {
  $("status").textContent = "Checking active tab…";
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const url = tab?.url || "";
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isYouTube = host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com");
    const isVideo = isYouTube && (host === "youtu.be" || parsed.pathname === "/watch" && parsed.searchParams.has("v") || parsed.pathname.startsWith("/shorts/"));
    if (!isVideo) throw new Error("Open a YouTube video first, then try again.");
    const response = await fetch(state.server + "/api/browser/submit", {
      method: "POST",
      headers: {"Content-Type": "application/json", "Authorization": "Bearer " + state.token},
      body: JSON.stringify({url})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not send video.");
    $("status").textContent = "Sent! Job ID: " + data.id + ". Return to Clipper to watch progress.";
  } catch (error) { $("status").textContent = error.message; }
});
init();
