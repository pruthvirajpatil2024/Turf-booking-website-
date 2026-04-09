/**
 * WhatsApp Webhook Server — /whatsapp endpoint on port 4000
 *
 * Responsibilities:
 * 1. GET  /whatsapp  → Meta webhook verification (hub.challenge)
 * 2. POST /whatsapp  → Receive incoming messages, verify HMAC, process, reply
 *
 * Designed for drop-in swap: change WHATSAPP_API_URL from the mock
 * to https://graph.facebook.com/v21.0 and set a real token.
 */

const http = require("http");
const crypto = require("crypto");

// ── Config (swap these for production) ──────────────────────────────────────
const CONFIG = {
  port: 4000,
  appSecret: process.env.WHATSAPP_APP_SECRET || "mock_app_secret_key",
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "mock_verify_token",
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "mock_access_token",
  apiBaseUrl:
    process.env.WHATSAPP_API_URL || "http://localhost:3001", // mock
  // Production: "https://graph.facebook.com/v21.0"
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "100000000000000",
};

// ── HMAC verification ───────────────────────────────────────────────────────
function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = signatureHeader.replace("sha256=", "");
  const hmac = crypto.createHmac("sha256", CONFIG.appSecret);
  hmac.update(rawBody, "utf-8");
  const computed = hmac.digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(computed, "hex")
  );
}

// ── Send message via WhatsApp API (mock or real) ────────────────────────────
function sendMessage(to, text) {
  const path = CONFIG.apiBaseUrl.includes("graph.facebook.com")
    ? `/${CONFIG.phoneNumberId}/messages`
    : "/v1/messages";

  const body = JSON.stringify({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text },
  });

  const url = new URL(CONFIG.apiBaseUrl);

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      Authorization: `Bearer ${CONFIG.accessToken}`,
    },
  };

  const transport = url.protocol === "https:" ? require("https") : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Message handler (your turf booking logic goes here) ─────────────────────
/**
 * Replace this with your actual business logic.
 * Receives { from, name, text } and returns the reply string.
 */
async function handleMessage({ from, name, text }) {
  const msg = text.toLowerCase().trim();

  // Example turf-booking replies — swap with your real logic
  if (msg === "hi" || msg === "hello") {
    return `Hey ${name}! 🏟️ Welcome to TurfBook.\n\n1. Book a slot\n2. My bookings\n3. Check availability\n\nReply with a number to continue.`;
  }
  if (msg === "1") {
    return "Which turf would you like?\n\nA. Green Arena\nB. Sports Hub\nC. Prime Ground\n\nReply with A, B, or C.";
  }
  if (msg === "2") {
    return "You have no upcoming bookings. Type 1 to book a new slot.";
  }
  if (msg === "3") {
    return "All turfs are available tomorrow 6 AM – 10 PM. Type 1 to book.";
  }

  return `Sorry, I didn't understand "${text}". Type hi to start.`;
}

// ── Extract messages from Meta payload ──────────────────────────────────────
function extractMessages(payload) {
  const messages = [];
  if (payload.object !== "whatsapp_business_account") return messages;

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value?.messages) continue;

      const contactMap = {};
      for (const c of value.contacts || []) {
        contactMap[c.wa_id] = c.profile?.name || "Unknown";
      }

      for (const msg of value.messages) {
        if (msg.type === "text") {
          messages.push({
            from: msg.from,
            name: contactMap[msg.from] || "Unknown",
            text: msg.text.body,
            msgId: msg.id,
            timestamp: msg.timestamp,
          });
        }
        // Extend here: image, location, button, list, etc.
      }
    }
  }
  return messages;
}

// ── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${CONFIG.port}`);

  // ── Webhook verification (Meta sends GET on setup) ────────────────────
  if (req.method === "GET" && url.pathname === "/whatsapp") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === CONFIG.verifyToken) {
      console.log("✅ Webhook verified");
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(challenge);
    }
    res.writeHead(403);
    return res.end("Forbidden");
  }

  // ── Incoming messages (Meta sends POST) ───────────────────────────────
  if (req.method === "POST" && url.pathname === "/whatsapp") {
    let rawBody = "";
    req.on("data", (chunk) => (rawBody += chunk));
    req.on("end", async () => {
      // Verify HMAC
      const sig = req.headers["x-hub-signature-256"];
      if (!verifySignature(rawBody, sig)) {
        console.log("❌ Invalid HMAC signature — rejected");
        res.writeHead(401);
        return res.end("Unauthorized");
      }

      // Acknowledge immediately (Meta expects 200 fast)
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "received" }));

      // Process
      try {
        const payload = JSON.parse(rawBody);
        const messages = extractMessages(payload);

        for (const msg of messages) {
          console.log(`📨 ${msg.name} (${msg.from}): ${msg.text}`);
          const reply = await handleMessage(msg);
          await sendMessage(msg.from, reply);
        }
      } catch (err) {
        console.error("Processing error:", err.message);
      }
    });
    return;
  }

  // Health check
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200);
    return res.end("ok");
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(CONFIG.port, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║        WhatsApp Webhook Server                   ║
╠══════════════════════════════════════════════════╣
║  Webhook  :  http://localhost:${CONFIG.port}/whatsapp       ║
║  Health   :  http://localhost:${CONFIG.port}/health          ║
║  API mode :  ${CONFIG.apiBaseUrl.includes("graph") ? "PRODUCTION (Meta)" : "MOCK (localhost:3001)"}                  ║
╚══════════════════════════════════════════════════╝
  Waiting for messages...
`);
});
