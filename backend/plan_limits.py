"""Plan limits and constants for the Free/Pro/Max subscription model."""

PLANS = {
    "free": {
        "credits_per_week": 50,
        "max_datasets": 5,
        "max_rows_per_dataset": 100_000,
        "max_storage_bytes": 50 * 1024 * 1024,  # 50 MB
    },
    "pro": {
        "credits_per_week": 500,
        "max_datasets": None,  # unlimited
        "max_rows_per_dataset": 500_000,
        "max_storage_bytes": 1024 * 1024 * 1024,  # 1 GB
    },
    "max": {
        "credits_per_week": 2000,
        "max_datasets": None,  # unlimited
        "max_rows_per_dataset": 2_000_000,
        "max_storage_bytes": 4 * 1024 * 1024 * 1024,  # 4 GB
    },
}

# Per-token credit costs.  Credits are charged after each LLM round based on
# actual token usage:  ceil(input * input_per_m/1M + output * output_per_m/1M)
# Rates target ≤25% cost-to-revenue ratio at $0.01/credit.
# min_credits = minimum remaining credits required to use the model (gate).
MODEL_COSTS = {
    "deepseek/deepseek-v3.2":              {"min_credits": 2,  "input_per_m": 220,  "output_per_m": 350},    # ~11% ($0.25/$0.40)
    "inception/mercury-2":                  {"min_credits": 2,  "input_per_m": 250,  "output_per_m": 750},    # ~10% ($0.25/$0.75)
    "kwaipilot/kat-coder-pro":             {"min_credits": 2,  "input_per_m": 260,  "output_per_m": 1035},   # ~8%  ($0.207/$0.828)
    "google/gemini-3.1-flash-lite-preview": {"min_credits": 3, "input_per_m": 250,  "output_per_m": 1500},   # ~10% ($0.25/$1.50)
    "openai/gpt-5.1-codex-mini":           {"min_credits": 3,  "input_per_m": 250,  "output_per_m": 2000},   # ~10% ($0.25/$2)
    "minimax/minimax-m2.5":                {"min_credits": 3,  "input_per_m": 370,  "output_per_m": 1500},   # ~8%  ($0.295/$1.20)
    "google/gemini-3-flash-preview":       {"min_credits": 4,  "input_per_m": 500,  "output_per_m": 3000},   # ~10% ($0.50/$3)
    "openai/gpt-5.1-codex-max":            {"min_credits": 8,  "input_per_m": 835,  "output_per_m": 6670},   # ~15% ($1.25/$10)
    "openai/gpt-5.4":                      {"min_credits": 10, "input_per_m": 1250, "output_per_m": 7500},   # ~20% ($2.50/$15)
    "anthropic/claude-sonnet-4.6":         {"min_credits": 10, "input_per_m": 1500, "output_per_m": 7500},   # ~20% ($3/$15)
    "anthropic/claude-opus-4.6":           {"min_credits": 20, "input_per_m": 2000, "output_per_m": 10000},  # ~25% ($5/$25)
}
DEFAULT_MODEL_COST = {"min_credits": 4, "input_per_m": 500, "output_per_m": 3000}

# Which models each plan tier can access.  Higher tiers include all lower ones.
_FREE_MODELS = {
    "deepseek/deepseek-v3.2",
    "google/gemini-3.1-flash-lite-preview",
}
_PRO_MODELS = _FREE_MODELS | {
    "kwaipilot/kat-coder-pro",
    "inception/mercury-2",
    "minimax/minimax-m2.5",
    "openai/gpt-5.1-codex-mini",
    "google/gemini-3-flash-preview",
}
_MAX_MODELS = _PRO_MODELS | {
    "openai/gpt-5.1-codex-max",
    "openai/gpt-5.4",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.6",
}

MODEL_TIERS: dict[str, set[str]] = {
    "free": _FREE_MODELS,
    "pro": _PRO_MODELS,
    "max": _MAX_MODELS,
}

DEFAULT_MODEL_BY_PLAN: dict[str, str] = {
    "free": "google/gemini-3.1-flash-lite-preview",
    "pro": "google/gemini-3-flash-preview",
    "max": "google/gemini-3-flash-preview",
}

STRIPE_PRICE_IDS: dict[str, str] = {
    "pro": "price_1T7mR4AZUw5YsFH9rYUAGLoB",
    "max": "price_1T7mR6AZUw5YsFH9VJSY2BBk",
}
# Reverse lookup: price_id → plan name (used by webhook)
PRICE_TO_PLAN: dict[str, str] = {v: k for k, v in STRIPE_PRICE_IDS.items()}
