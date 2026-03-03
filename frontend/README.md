# R·Base Frontend

Next.js 16 frontend for R·Base — an in-browser R data science IDE with an integrated AI agent.

## Development

```bash
npm install
npm run dev   # runs on localhost:3000
```

Note: dev/build scripts use `--webpack` (Next.js 16 defaults to Turbopack, which conflicts with the WebR webpack config).

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `NEXT_PUBLIC_API_URL` | Backend API URL (default: `http://localhost:8000`) |

## Key directories

- `app/` — Next.js App Router pages (landing, login, dashboard, sessions, plans)
- `components/` — Shared React components (session workspace, settings, etc.)
- `lib/` — Client libraries (Supabase, DuckDB-WASM, WebR, API helpers, stores)
- `public/` — Static assets (fonts, icons, screenshots)
