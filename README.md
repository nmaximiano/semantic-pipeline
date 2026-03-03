# R·Base

In-browser R data science IDE with an integrated AI agent.

Write and run R code, generate ggplot2 visualizations, and analyze datasets — all in your browser with zero setup. An AI agent is built in: describe what you want in plain English and it writes, executes, and iterates on R code for you.

**Live:** [tryrbase.com](https://tryrbase.com)

## How it works

1. Sign up / log in (Supabase Auth — email or Google OAuth)
2. New users land on a waitlist; beta access is granted manually
3. Create a session from the dashboard
4. Upload CSV datasets into the session
5. Write R code in the console, or chat with the AI agent to generate it
6. View results in an interactive data table, R console output, and plot gallery
7. Download transformed datasets as CSV

R code runs in-browser via WebR (dplyr, ggplot2, tidyr, stringr, lubridate, and more). All data stays client-side in DuckDB-WASM with OPFS persistence — the backend only handles auth, chat routing, and LLM calls.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Data engine | DuckDB-WASM (OPFS persistence, user-scoped), WebR (in-browser R) |
| Backend | Python 3.12, FastAPI, OpenRouter (Gemini 2.0 Flash) |
| Auth | Supabase Auth via `@supabase/ssr` (cookie-based) |
| Database | Supabase (PostgreSQL) |
| Error tracking | Sentry (frontend + backend) |
| Payments | Stripe Subscriptions (currently disabled — beta period) |

## Production infrastructure

| Service | Platform | URL |
|---------|----------|-----|
| Frontend | Vercel | [tryrbase.com](https://tryrbase.com) |
| Backend API | Railway | `semantic-pipeline-production.up.railway.app` |
| Database + Auth | Supabase | Project `fnnienxmuikwobdxnpey` |
| Error tracking | Sentry | Org: RBase |

### MCP servers (for Claude Code)

| Service | MCP | Notes |
|---------|-----|-------|
| Supabase | Yes | Query tables, run SQL, apply migrations, manage branches |
| Sentry | Yes | View issues, search errors, check project health |
| Railway | No | Managed via dashboard or `railway` CLI |
| Vercel | No | Managed via dashboard or `vercel` CLI |
| Stripe | Yes | View customers, subscriptions, events |

## Project structure

```
backend/
  main.py              # FastAPI endpoints
  services.py          # Business logic (SQL-based dataset ops)
  plan_limits.py       # Free/Pro/Beta plan constants
  Dockerfile           # Production container (Railway)
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
    page.tsx           # Landing page (public)
    login/             # Auth (sign in / sign up)
    waitlist/          # Waitlist page (free users)
    dashboard/         # Session list + dataset library
    sessions/[id]/     # Session workspace (table, chat, plots, R console)
    plans/             # Subscription management
    feedback/          # Feedback form (beta users only)
    auth/callback/     # OAuth + email confirmation callback
  components/
    RConsole.tsx        # In-browser R console (WebR)
    SettingsMenu.tsx    # User settings dropdown
    FeedbackWidget.tsx  # Floating feedback button (beta users)
    session/            # Session workspace sub-components
  lib/
    api.ts             # API URL + getAccessToken helper
    supabase.ts        # Supabase browser client
    supabase-server.ts # Supabase middleware client
    useSessionData.ts  # Session auth + data hook
    useAgentChat.ts    # Chat SSE + message state hook
    useRuntime.ts      # DuckDB + WebR initialization hook
    duckdb.ts          # DuckDB-WASM singleton (OPFS, user-scoped)
    webr.ts            # WebR initialization + R execution
    webr-duckdb-bridge.ts  # Sync between R and DuckDB
    chatMemory.ts      # Chat history persistence (DuckDB)
    useTheme.ts        # Light/dark theme toggle
  middleware.ts        # Auth + plan gating middleware
```

## Local development

### Prerequisites

- Python 3.12+
- Node.js 20+
- A [Supabase](https://supabase.com) project
- An [OpenRouter](https://openrouter.ai) API key

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in values
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev   # runs on localhost:3000
```

Note: build uses `--webpack` flag (Next.js 16 defaults to Turbopack, which conflicts with the WebR/DuckDB webpack config).

## Environment variables

### Backend (`backend/.env`)

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `DATABASE_URL` | PostgreSQL connection string |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `FRONTEND_URL` | Frontend URL for CORS (default: `http://localhost:3000`). Both `www` and non-`www` variants are auto-allowed. |
| `SENTRY_DSN` | Sentry DSN for backend error tracking |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `NEXT_PUBLIC_API_URL` | Backend API URL (default: `http://localhost:8000`) |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for frontend error tracking |
| `SENTRY_AUTH_TOKEN` | Sentry auth token (for source map uploads during build) |

## Database schema

Managed in Supabase dashboard (SQL Editor). Key tables:

- `profiles` — user plan, Stripe IDs, usage counters, `beta_expires_at`
- `sessions` — workspaces with `history` JSONB for chat memory
- `session_datasets` — join table with `display_order` for tab ordering
- `datasets` — file metadata (columns, row count, size)
- `dataset_rows` / `dataset_rows_original` — row data (original preserved for replay)
- `jobs` / `pipeline_steps` — agent job tracking
- `stripe_events` — webhook idempotency
- `feedback` — beta user feedback

RPC functions:
- `use_message_credits(p_user_id, p_cost)` — atomic credit deduction with weekly auto-reset
- `use_transform_rows(p_user_id, p_rows)` — atomic transform row deduction

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
| `POST` | `/feedback` | Submit feedback (beta users only) |
| `POST` | `/create-checkout-session` | Start Stripe checkout (currently returns 403) |
| `POST` | `/create-portal-session` | Open Stripe billing portal |
| `POST` | `/webhook/stripe` | Stripe webhook handler (signature-verified) |

## Agent architecture

The chat endpoint classifies each message as **simple** or **complex**:

- **Simple agent** (2 credits): single-turn R code generation + execution, up to 4 retry rounds
- **Complex agent** (10 credits): plans a multi-step approach, executes each step, replans after each result, up to 15 rounds

Both agents stream SSE events: `route`, `message`, `r_code`, `r_code_result`, `plan`, `plan_update`, `ask_user`, `error`.

R code is executed client-side via WebR. The frontend posts execution results back to `/chat/result`, forming a backend-frontend execution loop.

## Access control

### Waitlist / beta gating

All new users start on the `free` plan and see a waitlist page. Access is gated **server-side in Next.js middleware** — free users are redirected to `/waitlist` for all protected routes (`/dashboard`, `/sessions`, `/plans`, `/feedback`).

**Granting beta access** (via Supabase SQL Editor):
```sql
UPDATE profiles SET plan = 'beta', beta_expires_at = NOW() + INTERVAL '1 month'
WHERE email = 'user@example.com';
```

Beta auto-expires: the backend checks `beta_expires_at` on each authenticated request and reverts to `free` when expired.

### Plans

| | Free (waitlist) | Beta | Pro ($9/mo, disabled) |
|---|---|---|---|
| Access | Waitlist only | Full | Full |
| Messages | 50 / week | 500 / week | 500 / week |
| Datasets | 5 | Unlimited | Unlimited |
| Rows per dataset | 100K | 500K | 500K |
| Storage | 50 MB | 1 GB | 1 GB |
| LLM transforms | Disabled | 500K rows / week | 500K rows / week |

Credits reset weekly from the user's `period_start` timestamp.

## Client-side data architecture

- **DuckDB-WASM** stores all dataset and chat data client-side in OPFS, scoped per user (`opfs://kwartz_<userId>.duckdb`)
- **Checkpoint flushing**: DuckDB WAL is debounce-flushed every 1s, force-flushed on `beforeunload` and logout
- **OPFS quota handling**: quota errors dispatch a `duckdb-storage-error` CustomEvent, surfaced as a warning banner
- **COOP/COEP headers**: configured in `next.config.ts` (required for SharedArrayBuffer — used by both DuckDB OPFS and WebR)
