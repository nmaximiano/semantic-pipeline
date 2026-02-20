# Semantic Pipeline — Roadmap

## Vision

An AI-agent data science platform where users upload CSV datasets and enrich them through natural language conversation. The agent can add columns, run LLM-powered transforms (sentiment, classification, extraction, translation, etc.), filter and reshape data, and perform analytics — all without writing code.

---

## Completed

### Core Platform
- CSV upload with metadata computation (row count, column stats, avg chars)
- 500MB per-user storage cap enforced on upload
- Paginated dataset viewer with column sorting
- Streaming CSV download (1000-row batches)
- Dataset delete, reset to original state, rename
- Dataset library page with storage meter

### Postgres-Backed Data Layer
- `dataset_rows` table stores row data as JSONB — no file re-downloads
- `dataset_rows_original` stores immutable upload state for pipeline replay
- All mutations run as parameterized SQL (no pandas after upload)
- Paginated row endpoint with sorting via RPC

### AI Agent
- Single-loop chat architecture with `done` tool for explicit termination
- JSON system prompt with structured conversation memory
- SSE streaming: interleaved thinking text + tool_start/progress/end events
- Agent cancel support (stop button + backend cancel endpoint)
- Persistent sessions — conversation history stored in DB, survives restarts
- Clear memory button to reset agent context
- Logging system (`agent.log`, newest-first, via AgentLogger)

### Agent Tools (13)
- **Read-only**: sample_rows, column_stats, distribution
- **Mutations**: rename_column, delete_columns (batch), duplicate_column, find_replace, filter_rows (12 operators)
- **Computed columns (free)**: rolling_window, shift_column, column_formula, case_when
- **LLM transform**: llm_transform (async batch processing, costs credits)

### Pipeline System
- Every mutation recorded as a pipeline step with params + result summary
- Undo last step, revert to any step, reset all
- SQL-based replay from immutable original rows
- SQL preview dropdown on each step

### Credit System
- 50 free credits on signup (DB trigger)
- Tiered pricing: 0.01–0.04 credits/row based on avg text length
- Stripe Checkout integration for credit purchases
- Atomic credit RPCs: deduct, refund, add_purchase

---

## Next Up

### Agent Improvements
- Better model selection / fallback logic for agent reliability
- Guard rails against destructive spirals (e.g. agent filtering out all rows)
- Template prompts / suggested actions for common transforms

### More Tools
- `sort_rows` — reorder dataset by column(s)
- `fill_missing` — fill nulls with value, mean, median, forward-fill
- `cast_type` — convert column types (text → number, date parsing)
- `normalize` — min-max or z-score normalization

### Export & Sharing
- Export to JSON, Parquet
- Download with selected columns only

### Polish
- Column preview on hover in dataset list
- Search/filter datasets by name, date, or columns
- Mobile responsiveness on dataset detail page
- Better error messages on frontend

### Production Readiness
- Unit + integration tests
- Rate limiting on API endpoints
- Deployment config (Docker, CI/CD)
- Production CORS domains
- Log rotation for agent.log
