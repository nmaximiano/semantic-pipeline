# Credit System Implementation Plan

## Overview

A prepaid credit system where users buy credits upfront and spend them on semantic analysis jobs. The system guarantees profitability by charging based on worst-case estimates and controlling hidden costs (reasoning tokens).

---

## 1. Pricing Model

### Cost Structure (gpt-oss-20b:nitro with minimal reasoning)

| Cost Type | Rate |
|-----------|------|
| Input tokens | $0.02/M |
| Output tokens | $0.10/M (includes reasoning) |

### User-Facing Pricing

```
1 credit = $0.01
100 credits = $1.00

Cost per row = 0.02 credits (i.e., 500 rows = 10 credits = $0.10)
```

### Margin Calculation

Actual API cost for 500 rows: ~$0.001
User pays: $0.10
**Margin: ~100x**

This absorbs variance from long texts, reasoning spikes, and retries.

---

## 2. Credit Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. User signs up → gets 50 free credits                    │
│  2. User buys credits → Stripe/PayPal → credits added       │
│  3. User uploads CSV, configures job                        │
│  4. System shows: "This will use ~15 credits"               │
│  5. User confirms → 15 credits DEDUCTED IMMEDIATELY         │
│  6. Job runs (user cannot cancel mid-job)                   │
│  7. Job completes → user downloads result                   │
│  8. If job fails → partial refund for unprocessed rows      │
└─────────────────────────────────────────────────────────────┘
```

**Key principle:** Credits deducted BEFORE API calls, not after.

---

## 3. Pre-Flight Cost Estimation

Pure function, no API call needed:

```python
def estimate_cost_credits(num_rows: int) -> int:
    """Estimate credits needed for a job. Always rounds up."""
    CREDITS_PER_ROW = 0.02
    MIN_CREDITS = 1
    return max(MIN_CREDITS, math.ceil(num_rows * CREDITS_PER_ROW))
```

For more precision (based on actual text lengths):

```python
def estimate_cost_credits_precise(texts: list[str]) -> int:
    """Estimate based on actual character counts."""
    TOKENS_PER_CHAR = 0.25
    OUTPUT_TOKENS_PER_ROW = 50  # includes reasoning buffer
    INPUT_PRICE = 0.02 / 1_000_000
    OUTPUT_PRICE = 0.10 / 1_000_000
    MARGIN = 3.0
    CREDITS_PER_DOLLAR = 100

    input_tokens = sum(len(t) * TOKENS_PER_CHAR for t in texts)
    output_tokens = len(texts) * OUTPUT_TOKENS_PER_ROW

    cost_dollars = (input_tokens * INPUT_PRICE + output_tokens * OUTPUT_PRICE) * MARGIN
    return max(1, math.ceil(cost_dollars * CREDITS_PER_DOLLAR))
```

---

## 4. Abuse Prevention

| Layer | Protection | Implementation |
|-------|------------|----------------|
| Input size | Already have | `MAX_ROWS=50k`, `MAX_CHARS=4k`, `MAX_FILE=50MB` |
| Output size | Hard cap | `max_tokens=2000` per batch |
| Reasoning cost | Force minimal | `reasoning: { effort: "minimal" }` |
| Credit check | Pre-flight | Reject if `estimate > balance` |
| Rate limiting | Per user | Max 3 concurrent jobs, 10k rows/hour |
| Output truncation | Post-process | Truncate results > 100 chars |
| Free tier abuse | Verification | Email verification required, 50 credit limit until verified |

---

## 5. API Changes

### New endpoint: `POST /analyze` (modified)

Request now requires auth:
```
Authorization: Bearer <user_token>
```

Response includes cost info:
```json
{"progress": 50, "total": 500, "credits_used": 1}
...
{"done": true, "csv": "...", "total_credits_used": 10, "actual_cost_usd": 0.001}
```

### New endpoint: `GET /balance`

```json
{"credits": 85, "email": "user@example.com"}
```

### New endpoint: `POST /purchase`

Initiates Stripe checkout, webhook adds credits on success.

---

## 6. Actual Cost Tracking

The response includes exact cost — no separate API call needed:

```python
response = client.chat.completions.create(...)
actual_cost = response.usage.cost  # e.g., 0.000029
```

Log for analytics (not for billing):
```python
log.info(f"Job {job_id}: estimated=${estimated:.4f}, actual=${actual_cost:.6f}, margin={estimated/actual_cost:.1f}x")
```

---

## 7. Failure Handling

| Scenario | Action |
|----------|--------|
| Job fails at row 250/500 | Refund `ceil(250/500 * credits_charged)` |
| API timeout | Retry 3x, then fail + full refund |
| OpenRouter down | Fail immediately + full refund |
| User closes browser | Job continues, result saved for later download |
| Invalid CSV | Fail before credit deduction |

---

## 8. Database Schema

```sql
-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    credits INTEGER DEFAULT 50 NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Credit transactions (audit log)
CREATE TABLE credit_transactions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    amount INTEGER NOT NULL,  -- positive = add, negative = spend
    type VARCHAR(50) NOT NULL,  -- 'purchase', 'job_charge', 'job_refund', 'signup_bonus'
    job_id UUID,  -- nullable, links to job if applicable
    created_at TIMESTAMP DEFAULT NOW()
);

-- Jobs
CREATE TABLE jobs (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'pending',  -- pending, running, completed, failed
    rows_total INTEGER NOT NULL,
    rows_processed INTEGER DEFAULT 0,
    credits_charged INTEGER NOT NULL,
    credits_refunded INTEGER DEFAULT 0,
    actual_cost_usd DECIMAL(10, 6),
    result_csv TEXT,  -- stored for later download
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
```

---

## 9. Auth Integration Options

### Option A: Simple JWT (Recommended for MVP)

- User signs up with email/password
- Server issues JWT on login
- JWT included in all API requests
- Refresh tokens for long sessions

```python
# Login returns
{"token": "eyJ...", "expires_in": 86400}

# All requests include
Authorization: Bearer eyJ...
```

**Pros:** Simple, stateless, no third-party dependency
**Cons:** Must implement password reset, email verification yourself

### Option B: OAuth (Google/GitHub)

- "Sign in with Google" button
- No passwords to manage
- Google handles email verification

**Pros:** Users trust it, less friction, no password management
**Cons:** Dependency on third party, some users don't want to link accounts

### Option C: Auth0 / Clerk / Supabase Auth

- Third-party handles everything
- Drop-in React components
- Handles email verification, password reset, OAuth, MFA

**Pros:** Production-ready immediately, handles edge cases
**Cons:** Monthly cost ($25-100+), vendor lock-in

### Recommendation

**Start with Option A (JWT)** for MVP:
1. Simple to implement
2. No external dependencies
3. Can add OAuth later

Or **Option C (Clerk/Supabase)** if you want to move fast:
1. Clerk: Best DX, React components, $25/mo after 5k MAU
2. Supabase: Free tier generous, also gives you Postgres

---

## 10. Implementation Order

### Phase 1: Backend Auth (no credits yet)
1. Add Postgres database
2. User signup/login endpoints
3. JWT middleware
4. Protect `/analyze` endpoint

### Phase 2: Credit System
1. Add `credits` column to users
2. Add `credit_transactions` table
3. Pre-flight cost estimation
4. Credit deduction before job
5. Refund logic for failures

### Phase 3: Payments
1. Stripe integration
2. Webhook to add credits on successful payment
3. Purchase history page

### Phase 4: Polish
1. Email verification
2. Password reset
3. Usage dashboard
4. Rate limiting

---

## 11. API Configuration for Cost Control

```python
# In main.py

MODEL = "openai/gpt-oss-20b:nitro"
MAX_BATCH_SIZE = 50
MAX_TOKENS_PER_BATCH = 2000  # Hard cap to prevent runaway

def apply_llm_batch(...):
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=MAX_TOKENS_PER_BATCH,
        extra_body={"reasoning": {"effort": "minimal"}},  # 97% cheaper
        messages=[...],
    )
    # Cost is right here:
    actual_cost = response.usage.cost
```

---

## 12. Revenue Projections

| Scenario | Rows/month | Your cost | User pays | Profit |
|----------|------------|-----------|-----------|--------|
| 100 users, 1k rows each | 100k | $0.20 | $20 | $19.80 |
| 1k users, 5k rows each | 5M | $10 | $1,000 | $990 |
| 10k users, 10k rows each | 100M | $200 | $20,000 | $19,800 |

At scale, API costs are ~1% of revenue.

---

## 13. Open Questions

1. **Free tier limits?** 50 credits (2,500 rows) seems reasonable for trial
2. **Credit expiration?** Probably not — creates bad UX
3. **Bulk discounts?** Maybe 10% off for $50+ purchases
4. **Team accounts?** Defer to later — adds complexity
5. **API access?** Could charge premium for programmatic access
