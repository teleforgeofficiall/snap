# TELEFORGE Proxy Subscription System
## Business Model Document

---

## 1. Value Proposition

TELEFORGE provides **unlimited, rate-limit-free access** to top AI models (Claude, GPT-4, Gemini, Grok, DeepSeek) through a unified CLI coding agent — with **IP rotation** to bypass provider-level rate limits. Users pay either per-token (fund-based) or flat hourly (subscription).

## 2. Target Market

| Segment | Size | Willingness to Pay |
|---------|------|-------------------|
| Solo developers / freelancers | 10M+ | $10-30/mo |
| AI-first startups (2-10 devs) | 100K+ | $50-200/mo |
| AI agents / automation users | 500K+ | $20-100/mo |
| Students & learners | 5M+ | $5-15/mo |

## 3. Pricing Model

### 3.1 Fund-Based Pricing (per 1M tokens)

| Model | Input (per 1M) | Output (per 1M) | Markup vs OpenCode |
|-------|----------------|-----------------|-------------------|
| Claude Sonnet 4 | $0.15 | $0.60 | ~15% |
| Claude Haiku 3.5 | $0.08 | $0.40 | ~10% |
| GPT-4o | $0.10 | $0.30 | ~10% |
| Gemini 2.0 Flash | $0.05 | $0.15 | ~5% |
| DeepSeek V3 | $0.02 | $0.08 | ~5% |
| Grok 3 | $0.12 | $0.50 | ~10% |

*Pricing floor: OpenCode Zen API rate + 5-15% margin*
*Pricing can be adjusted dynamically based on real-time API costs*

### 3.2 Hourly Subscription Pricing

| Tier | Price/hr | Min Purchase | Rate Limit | IP Rotation | Dedicated Key |
|------|----------|-------------|------------|-------------|---------------|
| Hourly Basic | $1.50/hr | 4 hrs ($6) | 300 req/min | Yes (shared VPN) | No |
| Hourly Pro | $3.00/hr | 4 hrs ($12) | 600 req/min | Yes (dedicated IP) | Yes |

### 3.3 Cost Analysis

**Cost per hour (Hourly Basic, $1.50/hr):**

```
Assumptions per hour:
  - Average model: Claude Sonnet 4
  - Average request: 2K input + 1K output tokens
  - Requests per hour: 2000 (at ~33/min sustained)
  
  Token cost per request: (2000 * $0.15/1M) + (1000 * $0.60/1M) = $0.0009
  API cost per hour: 2000 * $0.0009 = $1.80

  Revenue per hour: $1.50
  Gross margin: -$0.30/hr (negative!)
  
  Breakeven: ~1300 requests/hr (22/min)

  Note: Most users don't sustain 2000 requests/hr. Realistic average: 500-800 req/hr
  API cost at 500 req/hr: $0.45
  Gross margin at 500 req/hr: $1.05/hr (70%)
  Gross margin at 800 req/hr: $0.78/hr (52%)
```

**Cost per month (Fund-Based, moderate user):**

```
Assumptions per month:
  - 50K input tokens + 25K output tokens per day
  - Average model: Claude Sonnet 4
  
  Daily cost: (50000 * $0.15/1M) + (25000 * $0.60/1M) = $0.0225
  Monthly cost (30 days): $0.675
  Monthly spend (with TELEFORGE markup): ~$0.78
  
  User would need to top up ~$10-20/mo for heavy usage
```

## 4. Revenue Model

### 4.1 Revenue Streams

| Stream | Margin | Notes |
|--------|--------|-------|
| Fund-based markup | 5-15% | Low margin, high volume |
| Hourly Basic | 40-70% | Medium margin, volume + infra cost |
| Hourly Pro | 50-75% | Highest margin, premium users |
| BYOK (future) | 0% | Zero margin, user brings own API key |

### 4.2 Projected Revenue (Year 1)

| Month | Free Users | Fund Users | Hourly Users | Monthly Revenue |
|-------|-----------|------------|-------------|-----------------|
| 1 | 500 | 50 | 10 | ~$750 |
| 2 | 1,000 | 100 | 25 | ~$1,875 |
| 3 | 2,000 | 200 | 50 | ~$3,750 |
| 6 | 5,000 | 500 | 150 | ~$12,000 |
| 12 | 10,000 | 1,000 | 500 | ~$45,000 |

*Assumptions: Fund users avg $15/mo, Hourly users avg 20 hrs/mo = $30/mo*

### 4.3 Cost Structure

| Cost Item | Monthly | Notes |
|-----------|---------|-------|
| Cloudflare Workers (3 proxies) | $0 | Free tier (100K req/day each) |
| Cloudflare Workers (gateway) | $0-5 | Free tier, may need Workers Paid |
| D1 Database | $0-25 | Free tier 5GB, $0.75/GB beyond |
| KV Storage | $0 | 1GB free |
| Stripe fees | 2.9% + $0.30 | Per transaction |
| 3x-ui VPS | $5-20/mo | For IP rotation infra |
| OpenCode API costs | Variable | Direct pass-through |
| Developer time | $0 (sweat equity) | Building it ourselves |

## 5. Market Positioning

### Competitive Landscape

| Product | Pricing Model | IP Rotation | BYOK | Billing Ownership |
|---------|--------------|-------------|------|-------------------|
| **TELEFORGE** | Fund + Hourly | Yes | Yes | Own |
| **OpenCode** | Fund + Subscription No | Yes | Own |
| **Cursor** | Subscription ($20/mo) | No | No | Own |
| **Claude Code** | Via Anthropic API | No | Yes | Anthropic |
| **GitHub Copilot** | Subscription ($10/mo) | No | No | Microsoft |

### Differentiation
1. **IP Rotation** — unique feature, no competitor offers this
2. **Dual billing** — flexibility of fund-based + simplicity of hourly
3. **Multi-key pool** — shared cost savings passed to users
4. **Open-source transparent** — CLI is open source (MIT)

## 6. Marketing Channels

- **GitHub** — open-source repo, 10K+ stars potential
- **Reddit** — r/programming, r/MachineLearning, r/ClaudeAI
- **Twitter/X** — dev community, AI tools accounts
- **Hacker News** — launch post (Show HN)
- **Dev.to / Medium** — technical blog posts
- **Product Hunt** — official launch
- **Word of mouth** — agent-to-agent (build an AI agent that recommends TELEFORGE)

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| OpenCode blocks proxy IPs | High | Rotate CF Workers (3 current, add more) |
| OpenCode changes API | High | Monitor API, version-specific adapters |
| 3x-ui server goes down | Medium | Fallback to WARP rotation |
| Stripe disputes / fraud | Medium | Min $10 top-up, email verification |
| Low user adoption | Medium | Free tier first, monetize after traction |
| API key pool exhaustion | Low | Alert admin, support BYOK as fallback |

## 8. Scaling Plan

| Phase | Users | Infra | Team |
|-------|-------|-------|------|
| MVP (now) | <100 | CF Workers free + D1 | Solo |
| Growth (3-6mo) | 100-1000 | CF Workers Paid + D1 | Solo + part-time |
| Scale (6-12mo) | 1000-10000 | Dedicated backend + RDS | 2-3 engineers |
| Enterprise (12mo+) | 10K+ | Multi-region, dedicated infra | 5+ engineers |
