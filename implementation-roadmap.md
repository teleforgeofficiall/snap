# TELEFORGE Proxy Subscription System
## Implementation Roadmap

---

## Phase 0: Foundation (Week 1)
### Dependency: None

**Goal:** Set up the Cloudflare Worker gateway + D1 database + core infrastructure

| Task | Details | Deliverable |
|------|---------|-------------|
| 0.1 | Create CF Worker `teleforge-gateway` | `worker/gateway.js` — basic HTTP handler |
| 0.2 | Create D1 database + schema | `worker/schema.sql` — users, subscriptions, proxy_keys, usage_log, pricing tables |
| 0.3 | Create KV namespace | `teleforge-kv` — rate limits, cooldowns, rotation state |
| 0.4 | Implement auth system | Login/register with email + bearer token |
| 0.5 | Implement basic routing | Route dispatcher with middleware chain |
| 0.6 | Deploy to Cloudflare | `wrangler deploy`, smoke test endpoints |
| 0.7 | Update CLI config | CLI reads new `teleforge.json` config pointing to gateway |

**Verification:** `curl https://teleforge-gateway.workers.dev/v1/auth/whoami` returns user info

---

## Phase 1: Multi-Key Pool (Week 2)
### Dependency: Phase 0

**Goal:** Admin can add/manage OpenCode API keys; system auto-selects keys

| Task | Details | Deliverable |
|------|---------|-------------|
| 1.1 | `POST /v1/keys/add` endpoint | Accept key, validate against OpenCode, store encrypted in D1 |
| 1.2 | `GET /v1/keys/list` endpoint | List all keys with status, last used, fail count |
| 1.3 | `POST /v1/keys/remove` endpoint | Soft-delete (set status = 'removed') |
| 1.4 | `GET /v1/keys/stats` endpoint | Per-key usage stats from usage_log |
| 1.5 | Key selection algorithm | LRU + cooldown logic in gateway.js |
| 1.6 | 429 handling | Auto-cooldown, auto-rotate, alert on >5 failures |
| 1.7 | CLI: `teleforge keys *` commands | Add, list, remove, stats |
| 1.8 | Merge PR to main | Test key rotation manually |

**Verification:** Add 2 keys, send 10 requests — verify both keys used, roughly 50/50 split

---

## Phase 2: Fund-Based Billing (Week 3)
### Dependency: Phase 0

**Goal:** Users can add funds via Stripe and use them per-request

| Task | Details | Deliverable |
|------|---------|-------------|
| 2.1 | Stripe Checkout integration | `POST /v1/topup` → create checkout session → return URL |
| 2.2 | Stripe webhook handler | `POST /stripe/webhook` → verify signature → credit user balance |
| 2.3 | Balance deduction on proxy | After each proxied request, deduct cost (microcents) from balance |
| 2.4 | Balance checking middleware | If balance < estimated request cost, return 402 Payment Required |
| 2.5 | `GET /v1/balance` endpoint | Show current balance, usage history |
| 2.6 | `GET /v1/usage` endpoint | Paginated usage log per user |
| 2.7 | Pricing table | `pricing` table seeded with model costs |
| 2.8 | CLI: `teleforge top-up`, `balance`, `usage` | All fund-based CLI commands |
| 2.9 | Auto-reload | Optional: auto-charge when balance < threshold |

**Verification:** Top up $10, send requests, verify balance decreases correctly

---

## Phase 3: Hourly Subscription (Week 4)
### Dependency: Phase 2

**Goal:** Users can buy hourly subscriptions with elevated rate limits

| Task | Details | Deliverable |
|------|---------|-------------|
| 3.1 | Stripe subscription product | Create Stripe product for hourly plan ($1.50/hr) |
| 3.2 | `POST /v1/subscribe` endpoint | Create checkout session for subscription |
| 3.3 | Stripe webhook for sub | On payment success → create subscription record in D1 |
| 3.4 | Subscription middleware | Check hours_remaining > 0 before allowing proxy |
| 3.5 | Hourly tracking | Track elapsed time, decrement hours_used |
| 3.6 | Auto-expire | CRON job (or on-request check) to expire stale subs |
| 3.7 | Elevated rate limits | 300 req/min for hourly users (track in KV) |
| 3.8 | `GET /v1/subscription` endpoint | Status, remaining hours, rate limit |
| 3.9 | `POST /v1/cancel` endpoint | Cancel subscription, pro-rata refund (Stripe) |
| 3.10 | CLI: `teleforge subscribe`, `status`, `cancel` | All subscription CLI commands |

**Verification:** Subscribe for 1 hour, use for 30 min, verify `teleforge status` reports 0.5 hrs remaining, auto-expire works

---

## Phase 4: IP Rotation (Week 5)
### Dependency: Phase 3

**Goal:** Hourly subscribers get automatic IP rotation via 3x-ui

| Task | Details | Deliverable |
|------|---------|-------------|
| 4.1 | Set up 3x-ui server | Deploy on VPS, configure panel, test REST API |
| 4.2 | 3x-ui API client in gateway | Login, create inbound, delete inbound, list |
| 4.3 | Provision on subscribe | On hourly sub start, create 3x-ui user → store config |
| 4.4 | Deprovision on expire | On sub end, delete 3x-ui inbound |
| 4.5 | `GET /v1/proxy/config` | Return VMess/VLESS connection details |
| 4.6 | `POST /v1/proxy/rotate` | Delete old inbound, create new one → new IP |
| 4.7 | CLI proxy integration | CLI reads VPN config, connects via Xray core |
| 4.8 | CLI: `teleforge proxy *` commands | status, rotate, config |
| 4.9 | WARP fallback | If 3x-ui fails, fall back to WARP IP rotation |
| 4.10 | Monitor rotation success | Track IP change success/failure in logs |

**Verification:** Subscribe hourly → `teleforge proxy config` shows VMess URL → IP check shows different IPs on rotation

---

## Phase 5: Polish & Testing (Week 6)
### Dependency: All phases

**Goal:** Test everything, fix bugs, harden security, prepare for launch

| Task | Details | Deliverable |
|------|---------|-------------|
| 5.1 | Integration tests | End-to-end: auth → top up → use → check balance |
| 5.2 | Error handling pass | All 4xx/5xx responses, graceful degradation |
| 5.3 | Security audit | Key encryption, token storage, webhook verification |
| 5.4 | Rate limit tuning | Calibrate limits for free/fund/hourly users |
| 5.5 | KV cooldown tuning | Optimize cooldown times based on real 429 patterns |
| 5.6 | Stripe test mode | Full payment flow test with test cards |
| 5.7 | Documentation | CLI help text, README, setup guide |
| 5.8 | Smoke test from clean install | New user: install → login → use → pay |
| 5.9 | npm publish | v1.1.0 with billing + proxy subs |
| 5.10 | Launch | GitHub release, HN post, Twitter thread |

**Verification:** Fresh user can install, create account, add funds, use TELEFORGE end-to-end

---

## Phase 6: Post-Launch (Month 2+)
### Dependency: Phase 5

| Task | Priority | Timeline |
|------|----------|----------|
| Realtime usage dashboard | Medium | Month 2 |
| Web dashboard (billing + stats) | High | Month 2 (Phase 3 website) |
| Team/workspace billing | Low | Month 3 |
| Multi-region proxy deployment | Medium | Month 3 |
| Custom model pricing per user | Low | Month 3 |
| Alerting: key failures, billing errors | Medium | Month 2 |
| Referral program ($5 credit per referral) | Low | Month 3 |
| Analytics: per-model usage, peak hours | Medium | Month 2 |

---

## Milestone Summary

```
Week 1:  Foundation      ─── Gateway + D1 + Auth
Week 2:  Multi-Key Pool  ─── Key management + auto-rotation
Week 3:  Fund Billing    ─── Stripe + balance deduction
Week 4:  Hourly Sub      ─── Subscriptions + rate limits
Week 5:  IP Rotation     ─── 3x-ui + VPN integration
Week 6:  Polish & Launch ─── Tests + docs + release
```

## File Delivery Checklist

```
worker/gateway.js           — Gateway worker
worker/schema.sql           — D1 database schema
worker/wrangler.toml        — Worker config (updated)
packages/opencode/src/cli/cmd/billing.ts  — CLI billing commands
packages/opencode/src/cli/cmd/keys.ts     — CLI key management commands
packages/opencode/src/cli/cmd/proxy.ts    — CLI proxy/VPN commands
packages/opencode/src/billing/client.ts   — Billing API client (to gateway)
packages/opencode/src/billing/balance.ts  — Balance checking logic
packages/opencode/src/billing/subscription.ts — Subscription logic
packages/opencode/src/provider/keypool.ts — Key selection algorithm
packages/opencode/src/vpn/manager.ts      — 3x-ui API client
packages/opencode/src/vpn/warp.ts         — WARP rotation (existing, extend)
```
