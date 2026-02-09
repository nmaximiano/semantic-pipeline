# Semantic Pipeline

Upload a CSV, pick a text column, write plain-English instructions, and get back your CSV with a new LLM-generated column.

## What it does

1. User signs up / logs in (Supabase Auth)
2. User uploads a CSV
3. Selects a column to analyze
4. Writes instructions (e.g. "classify sentiment as positive/neutral/negative")
5. Names the new output column
6. System estimates credits needed, deducts upfront
7. Downloads the original CSV + the new column

## Stack

- **Backend**: Python, FastAPI, Pandas, OpenRouter API (`openai/gpt-oss-20b:nitro`), Supabase
- **Frontend**: Next.js (React), Supabase Auth
- **Database**: Supabase (PostgreSQL)

## Setup

### 1. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run `backend/migrations/001_initial_schema.sql`
3. Copy your project URL, anon key, and service role key

### 2. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev  # runs on localhost:3000
```

### Environment Variables

Backend (`backend/.env`):
```
OPENROUTER_API_KEY=sk-or-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Frontend (`frontend/.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

## API

### Public Endpoints

#### `POST /upload`
Multipart form with `file` field. Returns column names.
```json
{ "columns": ["text", "date", "id"] }
```

#### `POST /preview`
Multipart form with `file`, `column_name`, `prompt`. Runs one random observation.
```json
{ "input": "sample text", "output": "positive" }
```

#### `GET /estimate?rows=500`
Estimate credits needed for a job.
```json
{ "rows": 500, "credits": 10, "cost_usd": 0.10 }
```

### Protected Endpoints (require `Authorization: Bearer <token>`)

#### `GET /balance`
Get current credit balance.
```json
{ "credits": 45, "email": "user@example.com" }
```

#### `GET /jobs`
List user's job history.
```json
{ "jobs": [{ "id": "...", "status": "completed", "rows_total": 500, ... }] }
```

#### `POST /analyze`
Multipart form with `file`, `column_name`, `prompt`, `new_column_name`. Requires auth and sufficient credits. Streams progress as NDJSON.
```json
{"progress": 50, "total": 500}
{"done": true, "csv": "...", "credits_used": 10, "job_id": "..."}
```

## Credit System

- New users get 50 free credits
- 1 credit = $0.01
- Tiered pricing based on average text length per row:

| Tier | Avg chars/row | Credits/row | Example: 10,000 rows |
|------|--------------|-------------|---------------------|
| Short | < 500 | 0.01 | 100 credits ($1.00) |
| Medium | 500 - 2,000 | 0.02 | 200 credits ($2.00) |
| Long | 2,000+ | 0.04 | 400 credits ($4.00) |

- Credits are deducted upfront before job runs
- Partial refunds for failed jobs (based on unprocessed rows)
- Guaranteed profit at every tier (40-50x margin over API costs)

See `CREDIT_SYSTEM.md` for full documentation.

## Batching

The `/analyze` endpoint groups rows into batches to reduce the number of LLM calls. Two constants control batching:

| Constant | Value | Purpose |
|---|---|---|
| `MAX_BATCH_CHARS` | 40,000 | Max total characters in a single batch prompt |
| `MAX_BATCH_SIZE` | 50 | Max rows per batch |

Rows are greedy-packed: each row is added to the current batch until adding it would exceed either limit, at which point a new batch starts. Empty rows are skipped entirely.

If the LLM returns a response that can't be fully parsed, successfully parsed results are kept and only the missing items are retried individually.

## TODO

- **Output length control**: Need a way to cap LLM output tokens to prevent abuse (e.g. prompt injection causing expensive long responses). `max_tokens` on the API interferes with batch formatting at high batch sizes — need an alternative approach (e.g. post-hoc truncation, per-result validation, or a separate output budget calculation).

## Data limits

These are defined as constants at the top of `backend/main.py` for easy adjustment.

| Limit | Value | Reason |
|---|---|---|
| Max file size | 50 MB | Memory safety |
| Max rows | 50,000 | API cost / time |
| Max chars per observation | 4,000 | LLM context window |
| Empty column | Rejected | Nothing to analyze |
