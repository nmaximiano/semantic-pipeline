# Scalability Considerations

Current assessment as of Feb 2026. The system works for local development and single-user testing. These are the architectural concerns to address before/after a public prototype launch.

---

## 1. Pandas In-Memory Processing — HIGH PRIORITY

**Status:** Being addressed now (SQL migration).

Every dataset mutation loads the full dataset into a pandas DataFrame in the backend's memory, transforms it, then writes all rows back to Postgres. This means:

- Memory usage scales linearly with dataset size per request
- Concurrent users multiply memory pressure (10 users × 200MB dataset = 2GB RAM spikes)
- Every new operation must be implemented as pandas logic — and re-implemented as SQL later
- The pipeline replay path (undo) downloads the original CSV from Storage and re-runs all steps through pandas, compounding the cost

Moving to pure SQL keeps data in Postgres and eliminates the download → parse → transform → serialize → write round-trip entirely.

---

## 2. Job Durability — LOW PRIORITY (for prototype)

**Status:** Acceptable for now. Address before scaling.

LLM transform jobs (`run_job`) run as fire-and-forget `asyncio.Task` instances inside the FastAPI process. If the server restarts mid-job, the work is lost. The current mitigation:

- `cleanup_stuck_jobs()` on startup marks orphaned jobs as failed
- Credits are refunded proportionally for unprocessed rows

This works for a prototype but becomes a problem when:
- Deployment platforms kill/restart processes during deploys
- Multiple backend instances are needed (jobs aren't distributed)

**Future fix:** Task queue (Celery + Redis, or Supabase pgmq) with a separate worker process. Jobs survive restarts and can scale horizontally.

---

## 3. Connection Pooling — LOW PRIORITY

**Status:** Fine for prototype. One-line fix when needed.

Currently using `psycopg2.ThreadedConnectionPool(max=10)` with synchronous connections. Handles single-digit concurrent users fine since most DB calls are fast.

**When it matters:** Sustained concurrent load from dozens of users.

**Future fix:**
- Switch to Supabase's PgBouncer pooler URL (connection string change)
- Or migrate to `asyncpg` for native async DB access
- Both are non-breaking changes to the rest of the codebase

---

## 4. Deployment & Environment Config — DEFERRED

Not yet deployed. Both frontend and backend run on localhost with hardcoded URLs.

**When ready:**
- Frontend → Vercel (natural fit for Next.js)
- Backend → Railway, Fly.io, Render, or AWS ECS (containerized FastAPI)
- Environment variables for API URLs, keys, Stripe mode
- Staging/production separation
- CI/CD pipeline

---

## Priority Order

1. **Pandas → SQL migration** (eliminates biggest architectural debt)
2. **Deployment & config** (required for any public access)
3. **Job durability** (matters once users run long transforms on a deployed system)
4. **Connection pooling** (config change, do it when deploying)
