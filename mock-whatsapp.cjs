/**
 * WhatsApp Cloud API Mock Server
 * Simulates Meta's WhatsApp Business API behavior:
 * 1. Accepts CLI input as incoming user messages
 * 2. Constructs webhook payload matching Meta's format
 * 3. Signs payload with HMAC-SHA256 (X-Hub-Signature-256)
 * 4. POSTs to your webhook at localhost:4000/whatsapp
 * 5. Prints reply messages returned by your webhook
 *
 * Also exposes POST /v1/messages so your webhook can "send" replies back.
 */

const http = require("http");
const crypto = require("crypto");
const readline = require("readline");

// ── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  port: 3001,
  webhookUrl: "http://localhost:4000/whatsapp",
  appSecret: process.env.WHATSAPP_APP_SECRET || "mock_app_secret_key",
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "mock_verify_token",
  phoneNumberId: "100000000000000",
  wabaId: "200000000000000",
  mockUserPhone: "919876543210",
  mockUserName: "Mock User",
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function generateId() {
  return "wamid." + crypto.randomBytes(16).toString("hex");
}

function timestamp() {
  return Math.floor(Date.now() / 1000);
}

function sign(body) {
  const hmac = crypto.createHmac("sha256", CONFIG.appSecret);
  hmac.update(body, "utf-8");
  return "sha256=" + hmac.digest("hex");
}

/** Build a webhook payload identical to what Meta sends */
function buildWebhookPayload(text) {
  const msgId = generateId();
  const ts = timestamp();

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: CONFIG.wabaId,
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550000000",
                phone_number_id: CONFIG.phoneNumberId,
              },
              contacts: [
                {
                  profile: { name: CONFIG.mockUserName },
                  wa_id: CONFIG.mockUserPhone,
                },
              ],
              messages: [
                {
                  from: CONFIG.mockUserPhone,
                  id: msgId,
                  timestamp: String(ts),
                  text: { body: text },
                  type: "text",
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

/** POST payload to webhook with HMAC signature */
function deliverToWebhook(text) {
  const payload = buildWebhookPayload(text);
  const body = JSON.stringify(payload);
  const signature = sign(body);

  const url = new URL(CONFIG.webhookUrl);

  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "X-Hub-Signature-256": signature,
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Reply receiver (simulates POST /v1/messages from Meta) ──────────────────
const server = http.createServer((req, res) => {
  // Webhook verification (GET) — mirrors Meta's challenge flow
  if (req.method === "GET" && req.url.startsWith("/v1/verify")) {
    const params = new URL(req.url, `http://localhost:${CONFIG.port}`)
      .searchParams;
    if (params.get("hub.verify_token") === CONFIG.verifyToken) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(params.get("hub.challenge") || "ok");
    }
    res.writeHead(403);
    return res.end("Forbidden");
  }

  // Receive outbound messages from your webhook (POST /v1/messages)
  if (req.method === "POST" && req.url === "/v1/messages") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const msg = JSON.parse(body);
        const text =
          msg.text?.body ||
          msg.template?.name ||
          JSON.stringify(msg).slice(0, 120);
        console.log(`\n  📩 Bot reply → ${CONFIG.mockUserPhone}: ${text}\n`);

        // Respond like Meta does
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            messaging_product: "whatsapp",
            contacts: [{ input: msg.to, wa_id: msg.to }],
            messages: [{ id: generateId() }],
          })
        );
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid JSON" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ── CLI loop ────────────────────────────────────────────────────────────────
server.listen(CONFIG.port, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║        WhatsApp Cloud API Mock Server            ║
╠══════════════════════════════════════════════════╣
║  Mock API :  http://localhost:${CONFIG.port}/v1/messages    ║
║  Webhook  :  ${CONFIG.webhookUrl}              ║
║  HMAC key :  ${CONFIG.appSecret.slice(0, 20).padEnd(20)}             ║
╚══════════════════════════════════════════════════╝
  Type a message and press Enter to simulate an incoming WhatsApp message.
  The mock will sign it with HMAC and POST to your webhook.
`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "You > ",
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) return rl.prompt();

    try {
      const result = await deliverToWebhook(text);
      if (result.status !== 200) {
        console.log(`  ⚠️  Webhook responded ${result.status}: ${result.body}`);
      }
    } catch (err) {
      console.log(`  ❌ Could not reach webhook: ${err.message}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nShutting down mock...");
    server.close();
    process.exit(0);
  });
});
