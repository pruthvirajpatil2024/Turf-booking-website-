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
const { createClient } = require("redis");

const redisClient = createClient({
  socket: {
    reconnectStrategy: false // Completely stops the endless retry loop and terminal spam!
  }
});
redisClient.on("error", () => {}); // Hide connection errors when polling

let isRedisConnected = false;
const mockStore = new Map();

// Resilient cache wrapper
const cache = {
  get: async (key) => {
    if (isRedisConnected) return await redisClient.get(key);
    const item = mockStore.get(key);
    if (item && item.expiry > Date.now()) return item.value;
    if (item) mockStore.delete(key);
    return null;
  },
  setEx: async (key, seconds, value) => {
    if (isRedisConnected) return await redisClient.setEx(key, seconds, value);
    mockStore.set(key, { value, expiry: Date.now() + seconds * 1000 });
  },
  del: async (key) => {
    if (isRedisConnected) return await redisClient.del(key);
    mockStore.delete(key);
  }
};

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

// ── Global Mocks (For Case Study Demo) ──────────────────────────────────────
const MOCK_DB = {
  turfs: [
    { id: "a", name: "Green Arena" },
    { id: "b", name: "Sports Hub" },
    { id: "c", name: "Prime Ground" }
  ],
  sports: ["Football", "Cricket", "Badminton"],
  times: ["06:00 AM", "08:00 AM", "04:00 PM", "06:00 PM", "08:00 PM"],
  bookings: [] // Array of { bookingId, waId, turf, sport, date, time, status }
};

const generateBookingId = () => "BK" + Math.floor(Math.random() * 100000);

// Helper to check for active locks or existing bookings
async function getAvailableTimes(turfId, dateText) {
  const allTimes = MOCK_DB.times;
  const available = [];
  
  for (const t of allTimes) {
    // 1. Check if permanently booked
    const isBooked = MOCK_DB.bookings.some(b => b.turf === turfId && b.date === dateText && b.time === t && b.status !== "CANCELLED");
    
    // 2. Check if temporarily locked
    const lockKey = `mutex:slot:${turfId}:${dateText}:${t}`;
    const isLocked = await cache.get(lockKey);
    
    if (!isBooked && !isLocked) {
      available.push(t);
    }
  }
  return available;
}

// ── Message handler (your turf booking logic goes here) ─────────────────────
/**
 * Real-time booking logic handling concurrency, state, and identity.
 */
async function handleMessage({ from, name, text }) {
  const rawMsg = text.trim();
  const msg = rawMsg.toLowerCase();
  const redisKey = `user:${from}:state`;
  const contextKey = `user:${from}:context`; // Store intermediate booking selections
  const profileKey = `user:${from}:profile`;

  // R1: Identity capture on first message
  let profileRaw = await cache.get(profileKey);
  let profile = profileRaw ? JSON.parse(profileRaw) : null;
  
  if (!profile) {
    profile = { name, phone: from, joinedAt: Date.now() };
    await cache.setEx(profileKey, 86400 * 365, JSON.stringify(profile)); // 1 year
  }

  // R5 & R6: Global Interceptors
  if (msg === "history" || msg === "my bookings") {
    const userBookings = MOCK_DB.bookings.filter(b => b.waId === from);
    if (userBookings.length === 0) return "You have no bookings on record.";
    let res = "📋 *Your Bookings:*\n";
    userBookings.forEach(b => {
      res += `\nID: ${b.bookingId} (${b.status})\n${b.turf} - ${b.sport}\n📅 ${b.date} at ${b.time}\n`;
    });
    await cache.del(redisKey); // Reset state
    return res + "\nType *hi* to return to menu.";
  }

  if (msg === "cancel") {
    await cache.del(redisKey);
    await cache.del(contextKey);
    return "Action cancelled. Type *hi* to start over.";
  }

  // State processing
  let state = await cache.get(redisKey) || "HOME";
  let contextRaw = await cache.get(contextKey);
  let context = contextRaw ? JSON.parse(contextRaw) : {};

  // Reset to HOME if they say hi/hello
  if (msg === "hi" || msg === "hello") {
    state = "HOME";
  }

  if (state === "HOME") {
    await cache.setEx(redisKey, 300, "AWAITING_SPORT");
    await cache.del(contextKey);
    
    let menu = `Hey ${profile.name}! 🏟️ Welcome to TurfBook.\n\nWhich sport are you looking to play?\n`;
    MOCK_DB.sports.forEach((s, idx) => menu += `${idx + 1}. ${s}\n`);
    return menu + "\nReply with a number (or type CANCEL anytime).";
  }

  if (state === "AWAITING_SPORT") {
    const index = parseInt(msg) - 1;
    if (index >= 0 && index < MOCK_DB.sports.length) {
      context.sport = MOCK_DB.sports[index];
      await cache.setEx(contextKey, 300, JSON.stringify(context));
      await cache.setEx(redisKey, 300, "AWAITING_TURF");
      
      let menu = `Great! You selected ${context.sport}.\nWhich turf would you like?\n`;
      MOCK_DB.turfs.forEach((t, idx) => menu += `${idx + 1}. ${t.name}\n`);
      return menu + "\nReply with a number.";
    }
    return "Invalid selection. Please reply with a valid number from the list.";
  }

  if (state === "AWAITING_TURF") {
    const index = parseInt(msg) - 1;
    if (index >= 0 && index < MOCK_DB.turfs.length) {
      context.turf = MOCK_DB.turfs[index].id;
      context.turfName = MOCK_DB.turfs[index].name;
      await cache.setEx(contextKey, 300, JSON.stringify(context));
      await cache.setEx(redisKey, 300, "AWAITING_DATE");
      
      return `Awesome! You selected ${context.turfName}.\nWhich date do you want to book?\n\n1. Today\n2. Tomorrow\n3. Day after tomorrow\n\nReply with 1, 2, or 3.`;
    }
    return "Invalid selection. Please reply with a valid number from the list.";
  }

  if (state === "AWAITING_DATE") {
    const dates = ["Today", "Tomorrow", "Day after tomorrow"];
    const index = parseInt(msg) - 1;
    if (index >= 0 && index < dates.length) {
      context.date = dates[index];
      
      // Concurrency check! (R7)
      const available = await getAvailableTimes(context.turf, context.date);
      if (available.length === 0) {
        return `Sorry! Real-time check shows ${context.turfName} is fully booked or locked for ${context.date}.\n\nType CANCEL to start over.`;
      }
      
      context.availableTimes = available;
      await cache.setEx(contextKey, 300, JSON.stringify(context));
      await cache.setEx(redisKey, 300, "AWAITING_TIME");
      
      let menu = `Available slots for ${context.date}:\n`;
      available.forEach((t, idx) => menu += `${idx + 1}. ${t}\n`);
      return menu + "\nReply with a number to lock your slot temporarily.";
    }
    return "Invalid selection. Please reply with 1, 2, or 3.";
  }

  if (state === "AWAITING_TIME") {
    const index = parseInt(msg) - 1;
    const available = context.availableTimes || [];
    
    if (index >= 0 && index < available.length) {
      const selectedTime = available[index];
      
      // Attempt to acquire lock dynamically (R7 mid-flow check)
      const lockKey = `mutex:slot:${context.turf}:${context.date}:${selectedTime}`;
      const isLocked = await cache.get(lockKey);
      
      if (isLocked) {
         return `⚠️ Whoops! That slot was *just* taken mid-flow by someone else!\n\nPlease pick a different slot from the previous list, or type CANCEL to restart.`;
      }
      
      // Acquire pessimistic lock for 5 minutes!
      await cache.setEx(lockKey, 300, from);
      
      context.time = selectedTime;
      await cache.setEx(contextKey, 300, JSON.stringify(context));
      await cache.setEx(redisKey, 300, "AWAITING_CONFIRMATION");
      
      return `🔒 Your slot at ${selectedTime} is temporarily locked for 5 minutes!\n\n*Confirm Details:*\nSport: ${context.sport}\nTurf: ${context.turfName}\nDate: ${context.date}\nTime: ${context.time}\n\nType *CONFIRM* to finalize your booking, or *CANCEL* to release the lock.`;
    }
    return "Invalid selection. Please reply with a number from the slot list.";
  }

  if (state === "AWAITING_CONFIRMATION") {
    if (msg === "confirm") {
      const booking = {
        bookingId: generateBookingId(),
        waId: from,
        turf: context.turfName,
        sport: context.sport,
        date: context.date,
        time: context.time,
        status: "CONFIRMED"
      };
      
      MOCK_DB.bookings.push(booking);
      
      const lockKey = `mutex:slot:${context.turf}:${context.date}:${context.time}`;
      await cache.del(lockKey);
      
      await cache.del(redisKey);
      await cache.del(contextKey);
      
      return `✅ *Booking Confirmed!*\n\n🎟️ Ticket ID: ${booking.bookingId}\n${booking.turf} - ${booking.date} @ ${booking.time}\n\nThank you for booking! Type *MY BOOKINGS* anytime to view your ticket. (Pretend there is a QR code here 🔲).`;
    }
    return "Please type *CONFIRM* to finalize, or *CANCEL* to abort.";
  }

  return `Sorry, I didn't understand "${rawMsg}". Type *hi* to see the menu.`;
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

function startServer() {
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
}

redisClient.connect().then(() => {
  isRedisConnected = true;
  console.log("✅ Connected to Real Redis");
  startServer();
}).catch(err => {
  isRedisConnected = false;
  console.log("⚠️  Redis server not found locally (ECONNREFUSED).");
  console.log("♻️  Automatically falling back to fast In-Memory Cache mode so the app still works!");
  startServer();
});
