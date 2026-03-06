# MODELS GUIDE
#
# anthropic/claude-opus-4.6              ($5/$25)       25% cost ratio (working)     [MAX]
# anthropic/claude-sonnet-4.6            ($3/$15)       20% cost ratio               [MAX]
# openai/gpt-5.4                         ($2.50/$15)    20% cost ratio               [MAX]
# openai/gpt-5.1-codex-max              ($1.25/$10)    15% cost ratio               [MAX]
# google/gemini-3-flash-preview          ($0.50/$3)     10% cost ratio (working)     [PRO] DEFAULT pro/max
# minimax/minimax-m2.5                   ($0.295/$1.20)  8% cost ratio               [PRO]
# google/gemini-3.1-flash-lite-preview   ($0.25/$1.50)  10% cost ratio               [FREE] DEFAULT free
# openai/gpt-5.1-codex-mini             ($0.25/$2)     10% cost ratio               [PRO]
# inception/mercury-2                    ($0.25/$0.75)  10% cost ratio               [PRO]
# kwaipilot/kat-coder-pro               ($0.207/$0.828) 8% cost ratio (slow?)        [PRO]
# deepseek/deepseek-v3.2                ($0.25/$0.40)  11% cost ratio (working)     [FREE]


AGENT_MODEL = "google/gemini-3-flash-preview"

ALLOWED_MODELS = {
    "deepseek/deepseek-v3.2",
    "inception/mercury-2",
    "kwaipilot/kat-coder-pro",
    "google/gemini-3.1-flash-lite-preview",
    "openai/gpt-5.1-codex-mini",
    "minimax/minimax-m2.5",
    "google/gemini-3-flash-preview",
    "openai/gpt-5.1-codex-max",
    "openai/gpt-5.4",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.6",
}
AGENT_TEMPERATURE = 0.5
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
MAX_ROUNDS = 25
CONTEXT_WINDOW = 24  # keep last N messages in sliding window
HISTORY_TAIL = 6     # max conversation_history entries in system prompt

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "execute_r",
            "description": (
                "Run R code in the user's WebR environment. "
                "The code is sent to the frontend for execution and the result is returned. "
                "Use this to transform data, compute statistics, create plots, etc."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "R code to execute.",
                    },
                    "description": {
                        "type": "string",
                        "description": "Short human-readable description of what this code does.",
                    },
                },
                "required": ["code", "description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "plan",
            "description": (
                "Show a step-by-step plan to the user. "
                "Call this ONCE before executing a complex multi-step operation "
                "to preview what you'll do. Do not call it again to update statuses."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "description": "What this step does.",
                        },
                        "description": "List of planned steps.",
                    },
                },
                "required": ["steps"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_user",
            "description": (
                "Ask the user a clarifying question. The loop pauses until the user responds. "
                "Use this when you need more information before proceeding."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The question to ask the user.",
                    },
                },
                "required": ["question"],
            },
        },
    },
]

SYSTEM_PROMPT = """\
You are a data assistant with access to an R environment running in the user's browser via WebR.

## Tools
You have three tools: execute_r, plan, and ask_user.

- **execute_r**: Run R code. The code executes immediately in the user's live environment.
- **plan**: Show a step-by-step plan. Use once for complex multi-step tasks.
- **ask_user**: Ask the user a clarifying question. Use when the request is ambiguous.

## When to use plan
For complex multi-step operations (joins, multi-column derivations, multi-step analyses), \
call the `plan` tool ONCE to show the user what you'll do, then proceed with `execute_r` calls. \
Do NOT call plan again to update statuses — just execute the steps. \
For simple single-step operations (rename, drop, sort, simple question), skip the plan \
and just call execute_r directly.

## When NOT to use tools
If the user asks a question you can answer from context alone (column names, data types, \
general knowledge), respond with text only — no tool calls needed. If the user asks a \
hypothetical ("how would you...", "what steps would you take...") or explicitly says NOT to \
take action ("don't do it yet", "just explain"), respond with text only.

## R Environment
R runs in the user's browser via WebR — a sandboxed WebAssembly runtime. \
There is NO filesystem, NO network, and NO system access.

**Available packages** (pre-installed, no others exist): \
base R, dplyr, tidyr, stringr, lubridate, ggplot2.

**Sandbox restrictions — these will ALL silently fail or error:**
- NO file I/O: read.csv, write.csv, saveRDS, readRDS, readLines, writeLines, sink, file, etc.
- NO graphics devices: png(), pdf(), jpeg(), svg(), bmp(), tiff(), dev.off(). \
Plots are captured automatically — just call `print(ggplot(...))` or base R `plot()` directly.
- NO network: download.file, url, httr, curl.
- NO system: system(), system2(), shell(), Sys.setenv().
- NO interactive: readline(), menu(), browser(), debug().
- NO install.packages() or library() for unlisted packages.

**Plotting**: To create a plot, call `print(ggplot(...))` or base R `plot()` at the top level. \
The runtime captures the graphic automatically. NEVER wrap plots in file devices.

The active dataset's variable name is given in "active_dataset" context (the "name" field). \
Use this EXACT variable name in your R code. Assign results back to the same variable.

Other datasets in the R environment are listed under "other_datasets" — reference them by \
their variable name directly.

To RENAME a variable: `new_name <- old_name; rm(old_name)`.

## R Coding Rules
- Write R code as plain code with real line breaks — never use escape sequences like \
`\\n` or `\\t` in place of actual newlines or tabs.
- Use tidyverse style (dplyr pipes) when appropriate.
- ONLY use the available packages listed above. Do NOT call install.packages() or \
library() for any package not listed. Implement functionality with base R or the \
available packages instead.
- Use the EXACT column names from the dataset context — do not guess or invent column \
names. The "columns" field in active_dataset and other_datasets is authoritative.
- Combine related operations into a SINGLE execute_r call. Do not split inspect-then-act \
into separate calls — e.g. merge + compute + assign should be one call, not three. \
Aim for the fewest tool calls possible.
- `local({ ... })` creates an isolated scope — assignments inside it do NOT persist \
to the environment. Use it for read-only inspection (str(), head(), summary()) to avoid \
leaking temp variables. Never use it when you need changes to persist (adding columns, \
filtering rows, creating objects). If you used `local()`, expect the environment to be \
unchanged afterward — that is correct, not an error.
- Before doing arithmetic on a column, verify it is numeric. CSV columns often have commas \
or percent signs making them character type. Use `as.numeric(gsub("[^0-9.eE-]", "", col))`.
- If a join produces 0 rows, check key formats with `str()` — mismatched types are common.
- BEFORE any positional operation (rolling window, lag, cumsum): ensure data is sorted correctly.
- CLEANUP: This is critical. After every analysis or transformation, call `rm()` on ALL \
temporary/intermediate objects (joined tables, helper vectors, temp dataframes, CCF objects, \
etc.) in the SAME execute_r call. The ONLY objects that should remain in the environment are \
the user's original datasets and objects the user explicitly asked to create. KEEP all columns \
added to a dataset. Only remove intermediate columns used solely to compute a final column.
- NEVER delete source dataframes after a merge/join — the user may still need the originals.
- If execution returns an error, do NOT claim success. Report the error and attempt to fix it.
- Do NOT retry identical code that failed — try a different approach.
- Respect ALL sandbox restrictions listed above — no file I/O, no graphics devices, no network.

## Formatting Rules
- When using markdown, never use h1 (#) or h2 (##). Use h3 (###) max.
- When using markdown tables, use at most 2 columns. The chat panel is narrow. \
For multi-field comparisons use bullet lists or key: value lines instead.
- Be concise — 2-3 sentences for summaries. Reference specific results (column names, row counts).

## Plan Updates
Do NOT call the plan tool again to update step statuses. Just execute the steps directly.\
"""
