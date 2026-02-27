# Kwartz

AI-powered data analysis platform. Upload a dataset, open a session, and chat with an AI agent that analyzes, transforms, and visualizes your data using R — no code required.

## How it works

1. Sign up / log in (Supabase Auth)
2. Create a session from the dashboard
3. Upload CSV datasets into the session
4. Chat with an AI agent that writes and executes R code on your data
5. View results in an interactive table, R console, and plot gallery
6. Download transformed datasets as CSV

The agent runs R code (dplyr, ggplot2, tidyr, etc.) in-browser via WebR. All data stays client-side in DuckDB-WASM — the backend only handles auth, chat routing, and LLM calls.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Data engine | DuckDB-WASM (client-side), WebR (in-browser R) |
| Backend | Python 3.12, FastAPI, OpenRouter (Gemini 2.0 Flash) |
| Auth | Supabase Auth via `@supabase/ssr` (cookie-based) |
| Database | Supabase (PostgreSQL) |
| Payments | Stripe Subscriptions (Free / Pro) |

## Project structure

```
backend/
  main.py              # FastAPI endpoints
  services.py          # Business logic (SQL-based dataset ops)
  plan_limits.py       # Free/Pro plan constants
  agent/
    agent/
      base.py          # Base agent (R code execution, ask_user)
      complex.py       # Multi-step plan-and-execute agent
      simple.py        # Single-turn agent
      router.py        # LLM-based query classifier
    config.py          # Agent config
    llm.py             # OpenRouter client
    logger.py          # Agent trace logging

frontend/
  app/
    page.tsx           # Landing page
    login/             # Auth (sign in / sign up)
    dashboard/         # Session list + management
    sessions/[id]/     # Session workspace (table, chat, plots, R console)
    plans/             # Subscription management
  lib/
    api.ts             # API URL + getAccessToken helper
    supabase.ts        # Supabase browser client
    supabase-server.ts # Supabase middleware client
    useSessionData.ts  # Session auth + data hook
    useAgentChat.ts    # Chat SSE + message state hook
    duckdb.ts          # DuckDB-WASM initialization
    webr.ts            # WebR initialization + R execution
    webr-duckdb-bridge.ts  # Sync between R and DuckDB
  middleware.ts        # Auth middleware (protects /dashboard, /sessions, /plans)
```

## Setup

### Prerequisites

- Python 3.12+
- Node.js 20+
- A [Supabase](https://supabase.com) project
- An [OpenRouter](https://openrouter.ai) API key
- A [Stripe](https://stripe.com) account (test mode is fine)

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in values
uvicorn main:app --reload --port 8000
```

**Backend env vars** (`backend/.env`):
| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `DATABASE_URL` | PostgreSQL connection string |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `FRONTEND_URL` | Frontend URL for CORS + Stripe redirects (default: `http://localhost:3000`) |

### 2. Frontend

```bash
cd frontend
npm install
npm run dev   # runs on localhost:3000
```

Note: the dev/build scripts use `--webpack` (Next.js 16 defaults to Turbopack, which conflicts with the WebR webpack config).

**Frontend env vars** (`frontend/.env.local`):
| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `NEXT_PUBLIC_API_URL` | Backend API URL (default: `http://localhost:8000`) |

### 3. Supabase

The database schema is managed directly in the Supabase dashboard (SQL Editor). Key tables:

- `profiles` — user plan, Stripe IDs, usage counters
- `stripe_events` — webhook idempotency

RPC functions:
- `use_message_credits(p_user_id, p_cost)` — atomic credit deduction with weekly auto-reset
- `use_transform_rows(p_user_id, p_rows)` — atomic transform row deduction

### 4. Stripe webhooks (local dev)

```bash
stripe listen --forward-to localhost:8000/webhook/stripe
```

## API endpoints

All endpoints except `/health` and `/webhook/stripe` require `Authorization: Bearer <token>`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (unauthenticated) |
| `GET` | `/account` | User plan, usage, and limits |
| `POST` | `/chat` | SSE stream — sends message to AI agent |
| `POST` | `/chat/result` | Frontend posts R execution results back |
| `POST` | `/chat/answer` | Frontend posts user answers to agent questions |
| `POST` | `/chat/cancel` | Cancel running agent |
| `POST` | `/create-checkout-session` | Start Stripe checkout for Pro |
| `POST` | `/create-portal-session` | Open Stripe billing portal |
| `POST` | `/webhook/stripe` | Stripe webhook handler (signature-verified) |

## Agent architecture

The chat endpoint classifies each message as **simple** or **complex**:

- **Simple agent** (2 credits): single-turn R code generation + execution, up to 4 retry rounds
- **Complex agent** (10 credits): plans a multi-step approach, executes each step, replans after each result, up to 15 rounds. Re-charges 10 credits every 5 rounds for long-running tasks.

Both agents stream SSE events: `route`, `message`, `r_code`, `r_code_result`, `plan`, `plan_update`, `ask_user`, `error`.

R code is executed client-side via WebR. The frontend posts execution results back to `/chat/result`, forming a backend-frontend execution loop.

## Subscription plans

| | Free | Pro ($9/month) |
|---|---|---|
| Messages | 50 / week | 500 / week |
| Datasets | 5 | Unlimited |
| Rows per dataset | 100K | 500K |
| Storage | 50 MB | 1 GB |
| LLM transforms | Disabled | 500K rows / week |

Credits reset weekly from the user's `period_start` timestamp.
