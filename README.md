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

No dependencies needed. Just Node.js.

```bash
git clone https://github.com/pruthvirajpatil2024/Turf-booking-website-.git
cd Turf-booking-website-
```

## Run

Open two terminals:

**Terminal 1 — Start webhook**
```bash
node webhook.cjs
```

**Terminal 2 — Start mock**
```bash
node mock-whatsapp.cjs
```

Now type `hi` in Terminal 2 and press Enter.

## Test Messages

| You type | Bot replies with |
|----------|-----------------|
| `hi`     | Welcome menu with 3 options |
| `1`      | Turf selection |
| `2`      | Your bookings |
| `3`      | Availability info |

## Add Your Bot Logic

Edit `handleMessage()` in `webhook.cjs`. It receives:

```js
{ from: "919876543210", name: "Mock User", text: "hi" }
```

Return a string and it gets sent back as the reply.

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
