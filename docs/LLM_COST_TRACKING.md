# LLM Cost Tracking

## Overview

Every chat turn logs token usage and credits charged to the `llm_usage` table. This lets us compare actual OpenRouter costs against what users "pay" in credits.

**Credit value assumption**: 1 credit = $0.02

## Table: `llm_usage`

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | UUID | References `profiles.id` |
| `session_id` | TEXT | Session where the chat occurred |
| `model` | TEXT | OpenRouter model ID |
| `input_tokens` | INT | Total input tokens across all rounds |
| `output_tokens` | INT | Total output tokens across all rounds |
| `tool_calls` | INT | Number of tool calls in the turn |
| `credits_charged` | INT | Total credits deducted (initial + per-tool) |
| `created_at` | TIMESTAMPTZ | When the turn completed |

## Credit Costs Per Model

Credits are charged **per-token** after each LLM round: `ceil(input × input_per_m/1M + output × output_per_m/1M)`.

A `min_credits` gate is deducted upfront; the first round's token cost is reduced by this amount.

| Model | Tier | min_credits | input_per_m | output_per_m | Cost Ratio | ~Typical |
|---|---|---|---|---|---|---|
| `deepseek/deepseek-v3.2` | Free | 2 | 220 | 350 | ~11% | ~4 credits |
| `google/gemini-3.1-flash-lite-preview` | Free | 3 | 250 | 1500 | ~10% | ~7 credits |
| `kwaipilot/kat-coder-pro` | Pro | 2 | 260 | 1035 | ~8% | ~6 credits |
| `inception/mercury-2` | Pro | 2 | 250 | 750 | ~10% | ~6 credits |
| `minimax/minimax-m2.5` | Pro | 3 | 370 | 1500 | ~8% | ~8 credits |
| `openai/gpt-5.1-codex-mini` | Pro | 3 | 250 | 2000 | ~10% | ~8 credits |
| `google/gemini-3-flash-preview` | Pro | 4 | 500 | 3000 | ~10% | ~14 credits |
| `openai/gpt-5.1-codex-max` | Max | 8 | 835 | 6670 | ~15% | ~26 credits |
| `openai/gpt-5.4` | Max | 10 | 1250 | 7500 | ~20% | ~34 credits |
| `anthropic/claude-sonnet-4.6` | Max | 10 | 1500 | 7500 | ~20% | ~38 credits |
| `anthropic/claude-opus-4.6` | Max | 20 | 2000 | 10000 | ~25% | ~50 credits |

Typical estimate based on ~15K input + ~2K output (simple single-round request).
Opus is the cost baseline at 25%. Cheaper models have lower ratios (more profitable).

Defined in `backend/plan_limits.py` → `MODEL_COSTS`.

## Queries

Run these in the Supabase SQL editor.

### Cost ratio by model

Shows whether each model is profitable (`cost_ratio < 1`) or losing money (`> 1`).

```sql
select model,
       count(*) as turns,
       avg(input_tokens)::int as avg_in,
       avg(output_tokens)::int as avg_out,
       avg(credits_charged)::numeric(5,1) as avg_credits,
       round(avg(credits_charged * 0.02)::numeric, 4) as avg_revenue,
       round(avg(
         input_tokens * case model
           when 'openai/gpt-oss-120b' then 0.04
           when 'qwen/qwen3.5-35b-a3b' then 0.17
           when 'minimax/minimax-m2.5' then 0.30
           when 'google/gemini-3-flash-preview' then 0.50
           when 'anthropic/claude-opus-4.6' then 5.00
         end / 1e6 +
         output_tokens * case model
           when 'openai/gpt-oss-120b' then 0.16
           when 'qwen/qwen3.5-35b-a3b' then 0.68
           when 'minimax/minimax-m2.5' then 1.10
           when 'google/gemini-3-flash-preview' then 2.00
           when 'anthropic/claude-opus-4.6' then 15.00
         end / 1e6
       )::numeric, 5) as avg_cost,
       round((sum(input_tokens * case model
           when 'openai/gpt-oss-120b' then 0.04
           when 'qwen/qwen3.5-35b-a3b' then 0.17
           when 'minimax/minimax-m2.5' then 0.30
           when 'google/gemini-3-flash-preview' then 0.50
           when 'anthropic/claude-opus-4.6' then 5.00
         end / 1e6 +
         output_tokens * case model
           when 'openai/gpt-oss-120b' then 0.16
           when 'qwen/qwen3.5-35b-a3b' then 0.68
           when 'minimax/minimax-m2.5' then 1.10
           when 'google/gemini-3-flash-preview' then 2.00
           when 'anthropic/claude-opus-4.6' then 15.00
         end / 1e6) / nullif(sum(credits_charged * 0.02), 0))::numeric, 3) as cost_ratio
from llm_usage
group by model
order by cost_ratio desc;
```

### Total spend by model (last 7 days)

```sql
select model,
       count(*) as turns,
       sum(input_tokens) as total_in,
       sum(output_tokens) as total_out,
       round(sum(
         input_tokens * case model
           when 'openai/gpt-oss-120b' then 0.04
           when 'qwen/qwen3.5-35b-a3b' then 0.17
           when 'minimax/minimax-m2.5' then 0.30
           when 'google/gemini-3-flash-preview' then 0.50
           when 'anthropic/claude-opus-4.6' then 5.00
         end / 1e6 +
         output_tokens * case model
           when 'openai/gpt-oss-120b' then 0.16
           when 'qwen/qwen3.5-35b-a3b' then 0.68
           when 'minimax/minimax-m2.5' then 1.10
           when 'google/gemini-3-flash-preview' then 2.00
           when 'anthropic/claude-opus-4.6' then 15.00
         end / 1e6
       )::numeric, 4) as total_cost_usd,
       sum(credits_charged) as total_credits
from llm_usage
where created_at > now() - interval '7 days'
group by model
order by total_cost_usd desc;
```

### Heaviest users by cost

```sql
select u.email, l.model,
       count(*) as turns,
       sum(l.credits_charged) as credits,
       round(sum(l.credits_charged * 0.02)::numeric, 2) as revenue_usd
from llm_usage l
join profiles u on u.id = l.user_id
where l.created_at > now() - interval '7 days'
group by u.email, l.model
order by credits desc
limit 20;
```

### Turns where we lost money

Individual turns where actual cost exceeded credit revenue.

```sql
select id, model, created_at,
       input_tokens, output_tokens, credits_charged,
       round((credits_charged * 0.02)::numeric, 4) as revenue,
       round((
         input_tokens * case model
           when 'openai/gpt-oss-120b' then 0.04
           when 'qwen/qwen3.5-35b-a3b' then 0.17
           when 'minimax/minimax-m2.5' then 0.30
           when 'google/gemini-3-flash-preview' then 0.50
           when 'anthropic/claude-opus-4.6' then 5.00
         end / 1e6 +
         output_tokens * case model
           when 'openai/gpt-oss-120b' then 0.16
           when 'qwen/qwen3.5-35b-a3b' then 0.68
           when 'minimax/minimax-m2.5' then 1.10
           when 'google/gemini-3-flash-preview' then 2.00
           when 'anthropic/claude-opus-4.6' then 15.00
         end / 1e6
       )::numeric, 5) as actual_cost
from llm_usage
where (
  input_tokens * case model
    when 'openai/gpt-oss-120b' then 0.04
    when 'qwen/qwen3.5-35b-a3b' then 0.17
    when 'minimax/minimax-m2.5' then 0.30
    when 'google/gemini-3-flash-preview' then 0.50
    when 'anthropic/claude-opus-4.6' then 5.00
  end / 1e6 +
  output_tokens * case model
    when 'openai/gpt-oss-120b' then 0.16
    when 'qwen/qwen3.5-35b-a3b' then 0.68
    when 'minimax/minimax-m2.5' then 1.10
    when 'google/gemini-3-flash-preview' then 2.00
    when 'anthropic/claude-opus-4.6' then 15.00
  end / 1e6
) > credits_charged * 0.02
order by created_at desc
limit 50;
```

## Notes

- Token counts come from OpenRouter via `stream_options: { include_usage: true }` on the streaming response
- Per-model pricing in queries is based on OpenRouter's published rates (input/output per 1M tokens) — update if rates change
- The `credits_tracker` in `main.py` accumulates initial + tool-call credits and passes it to the agent via a shared mutable list
- If `include_usage` isn't supported by a provider, tokens will be 0 for that row (cost shows as $0 but credits still tracked)
