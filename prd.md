# TELEFORGE AI — Proxy Subscription System
## Product Requirements Document (PRD)

---

## 1. Executive Summary

TELEFORGE is an AI agentic coding tool (Cursor/Claude Code-class) that provides access to top LLMs (Claude, GPT, Gemini, Grok, DeepSeek) through a unified CLI. Currently, TELEFORGE proxies requests through Cloudflare Workers to the OpenCode Zen API using a shared API key pool. This PRD defines a **Proxy Subscription System** that enables TELEFORGE to operate its own billing, authentication, usage tracking, and IP rotation — making it fully independent from OpenCode's backend.

## 2. Problem Statement

- **No billing infra**: TELEFORGE has no way to charge users directly; all billing goes through OpenCode's Zen API
- **Rate limits**: OpenCode imposes per-IP and per-key rate limits that throttle heavy users
- **Single point of failure**: 3 Cloudflare Workers + 1 OpenCode API key = one block takes down the entire service
- **No user separation**: All users share the same API key — impossible to track per-user usage or charge differentially
- **No premium tier**: Power users who want higher rate limits or dedicated resources have no paid option

## 3. Goals & Success Metrics

### Goals
- Launch TELEFORGE's own billing system (fund-based + hourly subscription)
- Enable multi-key auto-rotation across an admin-managed pool of OpenCode API keys
- Provide IP rotation for hourly subscribers to bypass rate limits
- Track per-user usage, cost, and billing
- Admin CLI for key management and system monitoring

### Success Metrics
| Metric | Target |
|--------|--------|
| Users onboarded to billing | >100 in first month |
| Hourly subscription revenue | >$1,000/mo |
| API key utilization | >80% across pool |
| 429 rate-limit errors reduced | <1% of requests |
| System uptime | >99.5% |

## 4. User Personas

### Persona A: Free User
- Uses TELEFORGE casually
- Gets access via OpenCode Zen free tier (promo tokens, per-IP limits)
- No login/billing required
- Limited to small models, low rate limits

### Persona B: Fund-Based User
- Heavy daily user (developer, student)
- Wants consistent access without rate limits
- Pays per token via balance top-ups ($10–50/mo)
- Gets shared pool access

### Persona C: Hourly Subscriber
- Power user (professional dev, agency)
- Needs high rate limits, dedicated resources, IP rotation
- Pays hourly (min 4 hours, $1.50/hr)
- Gets dedicated key from pool, elevated rate limits, VPN IP rotation

### Persona D: Admin
- TELEFORGE operator
- Manages API key pool, monitors usage, configures pricing
- CLI-only for MVP

## 5. Features

### 5.1 Billing System
**FUND-BASED**
- User deposits money via Stripe Checkout (min $10)
- Balance stored in microcents in D1 database
- Per-request cost deducted based on model pricing
- Auto-reload option when balance drops below threshold
- Usage history with per-model breakdown

**HOURLY SUBSCRIPTION**
- User purchases hours via Stripe Checkout (min 4 hours)
- Hourly rate: $1.50/hr (configurable)
- Unlimited requests during active subscription
- Elevated rate limits (300 req/min vs 60 req/min)
- Auto-expire when hours are consumed
- Cancel anytime, remaining hours refunded (pro-rata)

### 5.2 Multi-Key Auto-Rotation
- Admin adds N OpenCode API keys via CLI
- System validates each key on add
- Request routing:
  - Select key by least-recently-used algorithm
  - If key returns 429 → mark cooldown (60s), pick next
  - If key fails >5 times → mark expired, notify admin
- Hourly subscribers optionally get a dedicated key for session duration
- Dashboard: per-key usage, failure rate, remaining capacity

### 5.3 IP Rotation
- Enabled ONLY for hourly subscribers
- Via self-hosted **3x-ui** (Xray panel) server:
  - Workers call 3x-ui REST API to create/delete user inbounds
  - CLI receives VMess/VLESS connection config
  - All traffic routes through VPN for duration of session
  - On subscription expire → inbound deleted → IP changes
- Fallback: Cloudflare WARP (existing warp.ts integration)
- Rotation frequency: every 15 minutes or on-demand

### 5.4 Admin CLI
```bash
teleforge keys add <key>           # Add OpenCode API key to pool
teleforge keys list                # List all keys + status
teleforge keys remove <id>         # Remove key from pool
teleforge keys rotate              # Manually force rotation
teleforge keys stats               # Per-key usage + failures
teleforge pricing set <model>      # Set per-model pricing
teleforge billing stats            # Revenue + active subs
```

### 5.5 User CLI
```bash
teleforge login                    # Create account / sign in
teleforge balance                  # Check balance (fund-based)
teleforge top-up $20               # Add funds via Stripe
teleforge usage                    # Usage history

teleforge subscribe --hours 4      # Subscribe hourly
teleforge status                   # Remaining time, rate limit
teleforge cancel                   # Cancel subscription

teleforge proxy status             # Current proxy info
teleforge proxy rotate             # Force IP rotation (hourly)
teleforge proxy config             # Show VPN connection details
```

## 6. User Flows

### Flow A: Fund-Based User
1. `teleforge login` → creates account → stores auth token
2. `teleforge top-up $20` → Stripe Checkout → pays → webhook adds $20 to D1 balance
3. Uses TELEFORGE normally → each request deducts microcents from balance
4. `teleforge balance` → shows remaining balance, usage history
5. Optional: enable auto-reload → when balance < $5, auto-charge $20

### Flow B: Hourly Subscription
1. `teleforge login` → creates account
2. `teleforge subscribe --hours 4` → Stripe Checkout → pays $6
3. Backend provisions via 3x-ui: creates user inbound → returns VMess URL
4. CLI connects through VPN → all traffic goes through 3x-ui proxy
5. Elevated rate limits active (300 req/min)
6. `teleforge status` → shows remaining hours, time until expiry
7. After 4 hours → subscription expires → inbound deleted → IP removed
8. User can re-subscribe anytime

### Flow C: Admin Key Management
1. `teleforge keys add sk-opencode-key-xxx` → validated against OpenCode API
2. Key stored encrypted in D1
3. System starts using key in rotation pool
4. On 429: key auto-cooldowns → next key picked
5. `teleforge keys stats` → shows all keys with usage counts, failure rates
6. `teleforge keys remove <id>` → removes from pool immediately

## 7. Non-Goals (Future)
- Web dashboard UI (Phase 3)
- Multi-region proxy deployment
- Custom model fine-tuning
- Team/workspace billing
- Usage analytics dashboard
- Alerting system for key failures

## 8. Constraints
- Must use Cloudflare Workers (free tier initially where possible)
- D1 database: 5GB storage limit
- Stripe for all payment processing
- 3x-ui must be self-hosted on a VPS (user-managed)
- Must not modify OpenCode's backend in any way
- All TELEFORGE branding: dark theme (#0a0a0a), purple (#9d7cd8)
