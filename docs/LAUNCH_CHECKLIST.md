# MVP Launch Checklist

## MUST FIX (launch blockers)

### Deployment Fundamentals
- [ ] **No deployment config** — no Dockerfile, no platform config. Can't deploy yet.
- [x] **No COOP/COEP headers** — already configured in `next.config.ts`: `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` on all routes
- [x] **Hardcoded `localhost:8000`** in 7 frontend files — extracted to `frontend/lib/api.ts`, reads `NEXT_PUBLIC_API_URL` env var
- [x] **CORS hardcoded to localhost** — now dynamically includes `FRONTEND_URL` env var alongside localhost origins
- [x] **No health endpoint** — added `GET /health` → `{"status": "ok"}`
- [x] **`.env.example` lists 1 of 8 required vars** — backend lists all 8 vars, created `frontend/.env.example` with 3 vars
- [x] **Pin `requirements.txt`** — all 11 deps pinned to exact versions

### Bugs That Will Break Payments
- [x] **`period_start: "now()"` is a string literal, not a timestamp** — now uses `datetime.now(timezone.utc).isoformat()`
- [x] **Missing migration 005** — deleted `backend/migrations/` entirely (SQL lives in Supabase, migrations were incomplete/stale)

### Security
- [x] **Debug page `/debug` and `/api/debug-relay` ship in production** — deleted both entirely
- [x] **Raw exception strings sent to clients** in the chat SSE stream — now returns generic "Something went wrong. Please try again." (full error still logged server-side)
- [x] **No Next.js middleware** — added `frontend/middleware.ts` protecting `/dashboard`, `/sessions/*`, `/plans` with cookie-based Supabase auth; switched client to `createBrowserClient` from `@supabase/ssr`
- [x] **`dangerouslySetInnerHTML`** in `plans/page.tsx` FeatureRow — replaced with `{value}`

### Client-side Data Integrity
- [x] **Wrong OPFS file after logout/login** — `useRuntime` now always calls `initDuckDB(userId)` instead of skipping via stale `isInitialized()` check; DuckDB handles idempotency and user-switch internally
- [x] **Chat history lost on reload** — added `beforeunload` → `flushCheckpoint()` on session and dashboard pages
- [x] **No checkpoint flush on logout** — all 6 `handleLogout` functions now `await flushCheckpoint()` before `signOut()`

---

## SHOULD FIX (before inviting real users)

### Reliability
- [x] **No error boundaries** — added root `error.tsx` + session-level `error.tsx` with branded UI and recovery
- [x] **30+ empty `catch {}` blocks** in frontend — replaced all with `catch (e) { console.error(..., e) }`
- [x] **Stale auth tokens** — added `getAccessToken()` helper that fetches fresh token per API call
- [x] **`_active_agents` dict** — added concurrency guard: second request gets "Another query is already in progress"
- [x] **No OPFS storage quota handling** — checkpoint functions now detect quota errors and dispatch a `duckdb-storage-error` event; session and dashboard pages show a dismissible amber warning banner

### Business / Legal
- [x] **No Terms of Service or Privacy Policy** — added `/terms` and `/privacy` pages, linked from footer and SettingsMenu
- [x] **No forgot-password flow** — added `/reset-password` (email form) + `/reset-password/confirm` (new password form), linked from login page
- [x] **No email verification feedback** — signup now shows a "Check your email" interstitial with the user's address and a link back to sign in; `emailRedirectTo` set to `/auth/callback`
- [x] **Login page says "50 free credits"** — updated to "Sign up to start analyzing data"

### Ops
- [x] **No error tracking** — Sentry integrated in both frontend (`@sentry/nextjs`) and backend (`sentry-sdk[fastapi]`); user context attached via `get_current_user`; controlled by `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` env vars
- [ ] **No CI/CD, no tests** — zero test files, no GitHub Actions, no safety net. At minimum: `tsc --noEmit` + `next build --webpack` in CI
- [ ] **`agent.log` prepend is O(n)** — reads entire file on every log entry, grows unbounded, no rotation
- [x] **README is completely stale** — fully rewritten to reflect current architecture, stack, setup, and API

### Input Validation
- [x] **No `max_length` on `ChatRequest.message`** — added `max_length=16_000` on message and `max_length=100` on session_id via Pydantic `Field`
- [x] **`column_formula` SQL keyword blocklist** is incomplete — added SQL keywords: SELECT, INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, UNION, TRUNCATE, GRANT, REVOKE, COPY, EXECUTE
- [x] **No agent cost budget** — complex agent re-charges 10 credits every 5 rounds; stops with quota error if exhausted

---

## NICE-TO-HAVE (polish for credibility)

- [ ] Open Graph / SEO meta tags on landing page (no preview when shared on Twitter/LinkedIn)
- [ ] Session delete confirmation dialog
- [ ] Mobile responsiveness for session workspace (desktop-only layout currently)
- [ ] Rate-limit (429) handling in frontend (backend returns 429, frontend doesn't catch/display it)
- [ ] Request correlation IDs for cross-service tracing
- [x] Centralize `const API` into a single `lib/api.ts`
- [ ] Rotate all credentials (they've been visible in .env during development)

---

## Suggested Attack Order

| Priority | Items | Why |
|----------|-------|-----|
| **1. Deployment config** | Dockerfile (backend), Next.js build config, platform config | Can't ship without it |
| **2. COOP/COEP headers** | Configure headers in Next.js config + backend CORS | DuckDB + WebR break without them in production |
| **3. Email verification flow** | Add "check your email" interstitial after sign-up | Users will churn at the first step |
| **4. Fix agent.log** | Switch from prepend to append, add rotation or max size | Will degrade/OOM under load |
| **5. Flush on logout** | `await flushCheckpoint()` in logout handler | Completes the data-loss fix |
| **6. Sentry integration** | Add to both frontend and backend | Blind to production errors otherwise |
| **7. Basic CI** | GitHub Actions: `tsc --noEmit` + `next build --webpack` | Safety net before deploys |

Items in "MUST FIX" are the hard blockers. Everything after that is about not embarrassing yourself in front of paying users.
