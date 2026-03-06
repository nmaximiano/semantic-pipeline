# Agent Upgrades

Tracked improvements to the agent system, informed by conversation reports and testing.

---

## Completed

### Prompt: Use exact column names from context
The agent was guessing column names instead of reading them from the dataset context passed in the system prompt. Added rule: "Use the EXACT column names from the dataset context."

### Prompt: Only use available packages
The agent tried `install.packages("zoo")` despite only base R + tidyverse being available. Added rule: "ONLY use the available packages listed above."

### Prompt: Combine operations into fewer tool calls
The agent was splitting trivial inspect/compute/check steps into separate `execute_r` calls (19 calls for a 4-call task). Added rule: "Combine related operations into a SINGLE execute_r call."

### Prompt: Stronger cleanup rule
The agent left intermediate dataframes (`joined`, `roll_corr_df`, etc.) in the R environment after analysis. Strengthened the cleanup rule to require `rm()` of all temporary objects in the same `execute_r` call.

### Fix: Strip broken markdown images in assistant messages
The agent sometimes emits `![...](attachment://plot.png)` in its final response. ReactMarkdown rendered this as `<img src="attachment://...">` or empty `src=""`, causing browser warnings and failed loads. Added `stripBrokenImages()` to remove these before rendering.

---

## Planned

### Plan tool feedback is hollow
When the agent calls the `plan` tool, the message history only stores `"Plan displayed to user."` as the tool result — the actual step descriptions are lost. On subsequent LLM rounds within the same request, the model can only "remember" the plan from its own tool call arguments, not from an explicit feedback message. Across separate chat requests, plans are completely gone since `chatMemory` (user/assistant/r_code turns) doesn't include plan steps.

**Fix options:**
- Store the full plan steps JSON as the tool result content instead of the placeholder string
- Persist the current plan in `chatMemory` so it carries across requests
- Inject the active plan into the system prompt (similar to how `active_dataset` is injected)

### Agent duplicates plot rendering
In the k-means report, the agent produced a plot in tool call #3, then immediately called `execute_r` again in tool #5 with near-identical code to "recreate" the same plot. Two images shown to the user for the same thing.

### Plan tool called AFTER execution
The agent executed clustering and plotted results (tools #3-#6), then showed a plan for what it already did (tool #7). Plan should come first or not at all.

### Agent mutates same dataframe repeatedly, causing `.x`/`.y` column pollution
The agent assigned `Cluster` to `bitcoin_daily_5y` multiple times across separate tool calls, causing join-like column duplication (`Cluster.x`, `Cluster.y`). Then spent 5 tool calls diagnosing and fixing. Should assign cleanly in one pass.

### Errored R execution still renders plots
When `execute_r` returns an error, the frontend still captures and displays any partial ggplot output that was rendered before the error. Users see broken/incomplete plots. Consider suppressing plot capture when `success === false`.

### Chat memory is lossy
The `chatMemory` stored in DuckDB only keeps `{user, assistant, r_code}` per turn. Plots, tool call details, errors, and plan steps are all lost between requests. The agent has no memory of what it visualized, what failed, or what it planned.

**Fix options:**
- Expand chat memory turns to include tool outcomes (success/error), plot descriptions, and plan state
- Cap per-turn size to avoid blowing up the context window
