# MVP Launch Checklist

## MUST FIX (launch blockers)

### Deployment Fundamentals
- [ ] **No deployment config** — no Dockerfile, no platform config. Can't deploy yet.
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

---

## SHOULD FIX (before inviting real users)

### Reliability
- [x] **No error boundaries** — added root `error.tsx` + session-level `error.tsx` with branded UI and recovery
- [x] **30+ empty `catch {}` blocks** in frontend — replaced all with `catch (e) { console.error(..., e) }`
- [x] **Stale auth tokens** — added `getAccessToken()` helper that fetches fresh token per API call
- [x] **`_active_agents` dict** — added concurrency guard: second request gets "Another query is already in progress"

### Business / Legal
- [x] **No Terms of Service or Privacy Policy** — added `/terms` and `/privacy` pages, linked from footer and SettingsMenu
- [x] **No forgot-password flow** — added `/reset-password` (email form) + `/reset-password/confirm` (new password form), linked from login page
- [ ] **No email verification feedback** — sign-up redirects to dashboard before email is confirmed, user bounces with no explanation
- [x] **Login page says "50 free credits"** — updated to "Sign up to start analyzing data"

### Ops
- [ ] **No error tracking** (Sentry or equivalent) — production errors are invisible
- [ ] **No CI/CD, no tests** — zero test files, no GitHub Actions, no safety net
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
- [ ] Rate-limit (429) handling in frontend
- [ ] Request correlation IDs for cross-service tracing
- [x] Centralize `const API` into a single `lib/api.ts`
- [ ] Rotate all credentials (they've been visible in .env during development)

---

## Suggested Attack Order

| Phase | Items | Estimate |
|-------|-------|----------|
| **Day 1: Make it deployable** | Dockerfile, env vars, CORS, health, pin deps | ~half day |
| **Day 1: Fix the payment bug** | period_start, missing migration | ~1 hour |
| **Day 2: Security hardening** | debug page, error leak, middleware, XSS | ~half day |
| **Day 2: Error UX** | error boundaries, empty catches, token refresh | ~half day |
| **Day 3: Legal + auth flows** | ToS, privacy, forgot-password, email verify | ~1 day |
| **Day 3: Observability** | Sentry, basic CI, log rotation | ~half day |

Items in "MUST FIX" are the hard blockers. Everything after that is about not embarrassing yourself in front of paying users.
