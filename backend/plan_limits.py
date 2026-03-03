"""Plan limits and constants for the Free/Pro subscription model."""

PLANS = {
    "free": {
        "credits_per_week": 50,
        "transform_rows_per_week": 0,
        "max_datasets": 5,
        "max_rows_per_dataset": 100_000,
        "max_storage_bytes": 50 * 1024 * 1024,  # 50 MB
    },
    "pro": {
        "credits_per_week": 500,
        "transform_rows_per_week": 500_000,
        "max_datasets": None,  # unlimited
        "max_rows_per_dataset": 500_000,
        "max_storage_bytes": 1024 * 1024 * 1024,  # 1 GB
    },
    "beta": {
        "credits_per_week": 500,
        "transform_rows_per_week": 500_000,
        "max_datasets": None,  # unlimited
        "max_rows_per_dataset": 500_000,
        "max_storage_bytes": 1024 * 1024 * 1024,  # 1 GB
    },
}

SIMPLE_QUERY_COST = 2
COMPLEX_QUERY_COST = 10

STRIPE_PRO_PRICE_ID = "price_1T2RqmPDzFXM2p2yCht2JAH3"
