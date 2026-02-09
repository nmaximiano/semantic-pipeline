-- Stripe webhook event deduplication table
-- Prevents double-crediting from duplicate webhook deliveries

CREATE TABLE public.stripe_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    checkout_session_id TEXT,
    user_id UUID REFERENCES public.profiles(id),
    credits_added INTEGER,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_stripe_events_session ON public.stripe_events(checkout_session_id);
