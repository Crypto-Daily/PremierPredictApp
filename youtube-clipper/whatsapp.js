"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");

const HOST = "127.0.0.1";
const PORT = Number(process.env.WHATSAPP_INTERNAL_PORT || 8766);
const DATA = path.resolve(process.env.CLIPPER_DATA || path.join(__dirname, "data"));
const AUTH_DIR = path.resolve(process.env.WHATSAPP_AUTH_DIR || path.join(DATA, "whatsapp-auth"));
const JOBS_DIR = path.resolve(DATA, "jobs");
const PHONE = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\D/g, "");
const DEFAULT_CHAT = process.env.WHATSAPP_CHAT_ID || (PHONE ? PHONE + "@s.whatsapp.net" : "");
let sock = null, connected = false, qrText = null, qrDataUrl = null, user = null, starting = false;

function send(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 65536) reject(new Error("Request too large")); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}
async function connect() {
  if (starting) return;
  starting = true;
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false
    });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async update => {
      if (update.qr) {
        qrText = update.qr;
        qrDataUrl = await QRCode.toDataURL(qrText, { width: 320, margin: 2 });
        connected = false;
        console.log("WhatsApp pairing QR is ready. Open the private Clipper page to scan it.");
      }
      if (update.connection === "open") {
        connected = true; qrText = null; qrDataUrl = null; user = sock.user || null;
        console.log("Dedicated WhatsApp session connected.");
      }
      if (update.connection === "close") {
        connected = false; user = null;
        const code = update.lastDisconnect?.error?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) {
          setTimeout(() => { starting = false; connect().catch(err => console.error("WhatsApp reconnect failed:", err)); }, 3000);
        } else {
          console.error("WhatsApp session logged out. Remove/re-pair only after confirming with the owner.");
        }
      }
    });
  } catch (err) {
    starting = false;
    console.error("WhatsApp startup failed:", err);
    setTimeout(() => connect().catch(console.error), 5000);
  }
}
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/status") {
    return send(res, 200, { connected, qr_data_url: qrDataUrl, user: user ? { id: user.id, name: user.name } : null, recipient_configured: Boolean(DEFAULT_CHAT) });
  }
  if (req.method === "POST" && req.url === "/send-media") {
    try {
      const body = await readBody(req);
      const chatId = String(body.chatId || DEFAULT_CHAT);
      const filePath = path.resolve(String(body.filePath || ""));
      const allowedRoot = path.resolve(JOBS_DIR) + path.sep;
      if (!connected || !sock) return send(res, 503, { success: false, error: "WhatsApp is not connected. Scan the QR code first." });
      if (!chatId || !/^\d+@s\.whatsapp\.net$/.test(chatId)) return send(res, 400, { success: false, error: "Set a valid destination phone number." });
      if (!filePath.startsWith(allowedRoot) || !fs.existsSync(filePath) || path.extname(filePath).toLowerCase() !== ".mp4") return send(res, 400, { success: false, error: "Clip path is invalid." });
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return send(res, 413, { success: false, error: "Clip exceeds the 64 MB sending limit." });
      await sock.sendMessage(chatId, { video: { url: filePath }, mimetype: "video/mp4", caption: String(body.caption || "").slice(0, 900), fileName: path.basename(filePath) });
      return send(res, 200, { success: true });
    } catch (err) {
      console.error("WhatsApp media send failed:", err);
      return send(res, 500, { success: false, error: err.message || "Media send failed." });
    }
  }
  return send(res, 404, { error: "Not found" });
});
server.listen(PORT, HOST, () => {
  console.log("Private Baileys bridge listening on " + HOST + ":" + PORT);
  connect().catch(console.error);
});
process.on("SIGTERM", () => { try { sock?.end(undefined); } catch {} server.close(() => process.exit(0)); });
process.on("SIGINT", () => { try { sock?.end(undefined); } catch {} server.close(() => process.exit(0)); });
