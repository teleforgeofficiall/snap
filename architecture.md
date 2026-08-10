# TELEFORGE Proxy Subscription System
## System Architecture Document

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Machine (CLI)                        │
│  ┌──────────────┐  ┌────────────┐  ┌──────────────────────┐ │
│  │ teleforge CLI │  │ WARP/Tor  │  │ 3x-ui VPN Client     │ │
│  │ (TS / Bun)    │  │ (optional)│  │ (v2ray/Xray core)    │ │
│  └──────┬───────┘  └────────────┘  └──────────────────────┘ │
└─────────┼───────────────────────────────────────────────────┘
          │ HTTPS
          ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Workers (TELEFORGE Backend)          │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │           Gateway Worker (gateway.js)               │     │
│  │  • Auth middleware                                  │     │
│  │  • Billing check (balance / sub active)             │     │
│  │  • Key selection from pool                          │     │
│  │  • Usage logging                                    │     │
│  │  • IP rotation dispatch                             │     │
│  └──────────┬────────────────────┬───────────────────┘     │
│             │                    │                           │
│             ▼                    ▼                           │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │    D1 Database    │  │  KV Namespace    │                │
│  │  • users          │  │ • rate limits    │                │
│  │  • subscriptions  │  │ • key cooldowns  │                │
│  │  • proxy_keys     │  │ • session cache  │                │
│  │  • usage_log      │  │ • rotation state │                │
│  │  • pricing        │  │                  │                │
│  └──────────────────┘  └──────────────────┘                │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │         Proxy Workers (proxy-1/2/3)                │     │
│  │  • Transparent HTTP proxy to OpenCode              │     │
│  │  • Host header rewrite                             │     │
│  │  • X-Forwarded-For injection                       │     │
│  └──────────────────┬────────────────────────────────┘     │
└─────────────────────┼───────────────────────────────────────┘
                      │ HTTPS
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              OpenCode Zen API (console.opencode.ai)          │
│  • Free tier (per-IP)                                       │
│  • BYOK tier (per-key)                                      │
│  • Subscription tier                                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Self-Hosted 3x-ui Server (VPS)                 │
│  • Xray panel with REST API                                 │
│  • Manages user inbounds (VMess/VLESS/Trojan)               │
│  • Per-user traffic & IP limits                             │
│  • Workers create/delete inbounds via API                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Stripe                                          │
│  • Checkout sessions for payments                           │
│  • Webhooks → update D1 on success                          │
│  • Billing portal for subscription management               │
└─────────────────────────────────────────────────────────────┘
```

## 2. Component Details

### 2.1 Gateway Worker (gateway.js)

**Purpose:** Single entry point for all TELEFORGE API requests

**Routes:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/auth/login` | Create account / sign in |
| GET | `/v1/auth/whoami` | Current user info |
| GET | `/v1/balance` | Check balance |
| POST | `/v1/topup` | Create Stripe checkout for fund add |
| POST | `/v1/subscribe` | Create Stripe checkout for hourly sub |
| GET | `/v1/subscription` | Current subscription status |
| POST | `/v1/cancel` | Cancel subscription |
| GET | `/v1/usage` | Usage history |
| POST | `/v1/chat/completions` | **Main proxy endpoint** — auth + billing + route |
| POST | `/v1/keys/add` | Admin: add API key to pool |
| GET | `/v1/keys/list` | Admin: list keys |
| POST | `/v1/keys/remove` | Admin: remove key |
| GET | `/v1/keys/stats` | Admin: key usage stats |
| POST | `/v1/proxy/rotate` | Force IP rotation |
| GET | `/v1/proxy/config` | Get proxy/VPN connection details |
| POST | `/stripe/webhook` | Stripe webhook receiver |

**Request Flow (Proxy):**

```
1. Receive request → extract auth token + model + body
2. Authenticate user (token → D1 users table)
3. Billing check:
   a. If hourly subscriber → check hours_remaining > 0
   b. If fund-based → check balance > estimated cost
   c. If free → allow with lower rate limits
4. Select API key from pool:
   a. Read key pool from D1
   b. Exclude cooldown/expired keys
   c. Pick least-recently-used key
   d. Mark key as "in use" in KV
5. If hourly + IP rotation:
   a. Check 3x-ui user exists
   b. If not, provision via 3x-ui API
   c. Return proxy config in response headers
6. Forward request to proxy worker:
   a. Rewrite host to proxy-{n}.workers.dev
   b. Inject selected API key
   c. Add X-Teleforge-User header for tracking
7. Receive response → parse usage (token counts)
8. Deduct cost from balance / track hourly usage
9. Log to usage_log table
10. Return response to CLI
```

### 2.2 Proxy Workers (proxy-1/2/3)

**Purpose:** Transparent HTTP relay to OpenCode Zen API

Already implemented in `worker/index.js`:
- Strips Origin/Referer headers
- Adds X-Forwarded-For: teleforge-proxy
- Injects X-Proxy-Source: teleforge-cloudflare
- Simple host rewrite from proxy URL → console.opencode.ai
- CORS handling for all origins

### 2.3 D1 Database Schema

```sql
-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- ULID
  email TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT,
  auth_token TEXT NOT NULL,
  balance BIGINT NOT NULL DEFAULT 0,  -- in microcents
  plan TEXT NOT NULL DEFAULT 'free',  -- 'free', 'fund', 'hourly'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Hourly Subscriptions
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,           -- ULID
  user_id TEXT NOT NULL REFERENCES users(id),
  stripe_subscription_id TEXT,
  hours_purchased INTEGER NOT NULL,
  hours_used REAL NOT NULL DEFAULT 0,
  rate_limit INTEGER NOT NULL DEFAULT 300,  -- req/min
  vpn_enabled INTEGER NOT NULL DEFAULT 1,
  vpn_user_id TEXT,              -- 3x-ui user ID
  vpn_config TEXT,               -- VMess/VLESS connection JSON
  status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'expired', 'cancelled'
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- API Key Pool (admin-managed)
CREATE TABLE proxy_keys (
  id TEXT PRIMARY KEY,           -- ULID
  key_value TEXT NOT NULL,       -- encrypted at rest
  provider TEXT NOT NULL DEFAULT 'opencode',  -- 'opencode' for now
  label TEXT,                    -- optional human label
  status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'cooldown', 'expired'
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  added_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Usage Log
CREATE TABLE usage_log (
  id TEXT PRIMARY KEY,           -- ULID
  user_id TEXT NOT NULL REFERENCES users(id),
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost BIGINT NOT NULL,          -- in microcents
  proxy_key_id TEXT REFERENCES proxy_keys(id),
  ip_address TEXT,
  plan_type TEXT NOT NULL,       -- 'fund', 'hourly', 'free'
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pricing Table
CREATE TABLE pricing (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL UNIQUE,
  input_price_per_1m INTEGER NOT NULL,    -- in microcents
  output_price_per_1m INTEGER NOT NULL,
  hourly_rate_usd REAL,                   -- NULL for non-hourly models
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.4 KV Namespace

```
Key Pattern                          Value                    TTL
─────────────────────────────────────────────────────────────────────
rate_limit:<user_id>                 { count, window_start }  60s
key_cooldown:<key_id>                { until }                60s
key_in_use:<key_id>                  { user_id, acquired_at } 30s
rotation_state                       { current_index }        N/A
session:<session_id>                 { user_id, plan, key }   3600s
```

### 2.5 Multi-Key Selection Algorithm

```
Input: pool of active keys
Output: selected key

Algorithm: Least-Recently-Used with Cooldown

1. Filter keys:
   - status = 'active'
   - NOT in key_cooldown KV (cooldown expired)
   - NOT in key_in_use KV (free to use)

2. If pool empty:
   - Return cooldown keys with soonest expiry
   - Wait for cooldown to expire
   - OR fall back to free tier (no key)

3. Sort by last_used_at ASC (oldest first)

4. Pick first key

5. Set key_in_use KV for this key (TTL: 30s)

6. On 429 response:
   - Set key_cooldown KV for 60s
   - Increment fail_count in D1
   - If fail_count > 5 → set status = 'expired'
   - Retry with next key
```

### 2.6 IP Rotation via 3x-ui

**3x-ui REST API Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/login` | POST | Auth to 3x-ui panel |
| `/panel/api/inbounds/list` | GET | List all inbounds |
| `/panel/api/inbounds/add` | POST | Create new user inbound |
| `/panel/api/inbounds/del/:id` | POST | Delete inbound |
| `/panel/api/inbounds/update/:id` | POST | Update inbound (expiry, traffic) |

**Flow for hourly subscription:**

```
1. User subscribes → workers receive webhook
2. Workers POST to 3x-ui login → get session token
3. Workers POST to 3x-ui inbounds/add:
   {
     "remark": "teleforge-user-{userId}",
     "port": random(10000-60000),
     "protocol": "vmess",
     "settings": {
       "clients": [{
         "id": uuid(),
         "email": "user-{userId}",
         "expiryTime": now + hours_purchased * 3600 * 1000
       }]
     }
   }
4. Workers receive inbound config → store in subscriptions.vpn_config
5. CLI receives VMess URL → connects via Xray core
6. On cancel/expire → DELETE inbound
```

### 2.7 Stripe Integration

**Flow:**

1. CLI calls `/v1/topup` or `/v1/subscribe`
2. Gateway creates Stripe Checkout Session:
   - fund: `mode: payment`, `line_items: [{ price_data: { unit_amount: amount_usd_cents } }]`
   - hourly: `mode: subscription`, `line_items: [{ price: hourly_price_id }]`
3. Returns `checkout_url` to CLI → user opens in browser
4. Stripe redirects to success_url → webhook sent
5. Gateway receives webhook at `/stripe/webhook`:
   - Verifies signature
   - fund: adds amount to user balance in D1
   - hourly: creates subscription record, provisions 3x-ui inbound
6. CLI polls `/v1/subscription` or user manually runs `teleforge balance`

## 3. Security

- API keys stored in D1 encrypted at rest (AES-256-GCM with env var key)
- Auth tokens: JWT or opaque bearer tokens
- Stripe webhook signature verification
- 3x-ui credentials: Cloudflare Worker secrets (not in code)
- Rate limiting on auth endpoints (5 req/min per IP)
- All traffic over HTTPS only

## 4. Monitoring & Observability

- CF Worker > Logs > Real-time logging
- Track per-request: user_id, model, success/failure, latency
- Alerts (via email/webhook): key failure rate >10%, billing errors
- Dashboard via CF Workers Analytics dashboard

## 5. Deployment

```bash
# Gateway worker
cd worker
npx wrangler deploy gateway.js --name teleforge-gateway

# D1 database
npx wrangler d1 create teleforge-db
npx wrangler d1 execute teleforge-db --file=schema.sql

# KV namespace
npx wrangler kv:namespace create teleforge-kv

# Environment variables
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put XUI_PANEL_URL
npx wrangler secret put XUI_USERNAME
npx wrangler secret put XUI_PASSWORD
```
