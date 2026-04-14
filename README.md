# WhatsApp Mock for Turf Booking

Simulates Meta's WhatsApp Cloud API locally so you can build and test your turf booking bot without a real WhatsApp Business account.

## How It Works

```
You type in CLI
      │
      ▼
┌─────────────────┐   HMAC-signed POST    ┌──────────────────┐
│ mock-whatsapp    │ ───────────────────►  │ webhook           │
│ port 3001        │   /whatsapp           │ port 4000         │
│                  │                       │                   │
│ prints bot reply │   POST /v1/messages   │ handleMessage()   │
│ in terminal      │ ◄───────────────────  │ your bot logic    │
└─────────────────┘                       └──────────────────┘
```

1. You type a message (e.g. `hi`) in the mock terminal
2. Mock builds a Meta-format payload and signs it with HMAC-SHA256
3. Mock POSTs to `localhost:4000/whatsapp` with `X-Hub-Signature-256` header
4. Webhook verifies signature, extracts message, runs `handleMessage()`
5. Webhook replies via `POST /v1/messages` back to mock
6. Mock prints the bot reply in your terminal

## Setup

We now use NPM to manage persistent real-time session state.

```bash
git clone https://github.com/pruthvirajpatil2024/Turf-booking-website-.git
cd Turf-booking-website-
npm install
```

> **Note:** The bot requires the `redis` client package. However, if you *don't* have a real Redis database server installed on your machine, `webhook.cjs` will instantly and transparently fall back to a lightning-fast **In-Memory Cache Map** that mimics Redis perfectly so you can still test concurrency locks natively!

## Run

Open two or three terminals to test the real-time locking!

**Terminal 1 — Start webhook**
```bash
node webhook.cjs
```

**Terminal 2 — Start Mock Phone A**
```bash
node mock-whatsapp.cjs
```

Now type `hi` in Terminal 2 and press Enter.

## Advanced Features & Real-Time Architecture

This mock bot is engineered for high-concurrency real-time analysis:
- **Instant Identity Capture**: Checks the DB for incoming phone numbers; creates profiles silently if new.
- **Date Picker Mockup**: Because terminal CLI cannot render WhatsApp's visual interactive Date Picker, the architecture perfectly mimics date flows by translating them to simple numeric text menus (`1. Today`, `2. Tomorrow`).
- **Pessimistic Slot Locking (Real-Time Mutex)**: Eliminates double-booking. When a user selects a time, it locks temporarily for 5-minutes (TTL). If User B texts the bot subsequently, that slot is vanished from the timeline until User A finishes or abandons their session.
- **Global Interceptors**: Commands like `CANCEL` or `HISTORY` trigger instantly regardless of what state the user is trapped in.
- **Mock Relational DB**: Temporarily uses the Redis fallback loop to emulate a Turf booking persistent store.

## Test Messages

| You type | Bot Action / Flow State |
|----------|-----------------|
| `hi`     | Soft resets and displays internal Sport Selection |
| `1`, `2` | Navigates through Sport -> Turf -> Date -> Time lists |
| `CANCEL` | Immediately aborts the current session, deletes any Mutex locks held, and returns home |
| `HISTORY` or `MY BOOKINGS` | Bypasses the state machine and returns a list of your confirmed ticket IDs |
| `CONFIRM` | Translates the 5-minute Mutex lock into a permanent Booking Registration |

## Add Your Bot Logic

Edit `handleMessage()` in `webhook.cjs`. It maintains multi-stage dialogue states in memory contexts.

```js
{ from: "919876543210", name: "Mock User", text: "history" }
```

Returns customized responses based heavily on contextual caching.

## Switch to Real WhatsApp

Set these env vars and run `webhook.cjs` — zero code changes:

```bash
set WHATSAPP_APP_SECRET=your_real_app_secret
set WHATSAPP_VERIFY_TOKEN=your_real_verify_token
set WHATSAPP_ACCESS_TOKEN=your_real_access_token
set WHATSAPP_API_URL=https://graph.facebook.com/v21.0
set WHATSAPP_PHONE_NUMBER_ID=your_real_phone_number_id
```

## Files

| File | Purpose |
|------|---------|
| `mock-whatsapp.cjs` | Simulates Meta's API — CLI input, HMAC signing, receives replies |
| `webhook.cjs` | Your webhook — verifies HMAC, processes messages, sends replies |

---

## Update History

### 14/04/2026 Work
- **Added Dependencies**: Initialized `package.json` and natively supported `redis`.
- **Resilient Fallback Map**: Engineered an In-Memory caching bridge so the app functions seamlessly if no local Redis daemon is found.
- **5-Tier Context State Machine**: Scaled the conversation logic to handle deep multi-stage menus dynamically (`SPORT` > `TURF` > `DATE` > `TIME`).
- **Real-Time Concurrency Locks**: Implemented pessimistic 'Mutex' locks that temporarily reserve and hide time-slots for 5 minutes during booking to outright prevent double-bookings.
- **Global Commands & Mock DB**: Handled system-wide interrupt strings (`HISTORY`, `CANCEL`) seamlessly checking a native mockup JSON turf database.
