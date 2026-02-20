-- Migration 014: Replace credit system with Free/Pro subscription model
-- Adds plan columns, weekly usage tracking, subscription RPCs
-- Drops old credit infrastructure

BEGIN;

-- 1. Extend profiles table with subscription columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS credits_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transform_rows_used INTEGER NOT NULL DEFAULT 0;

-- 2. RPC: use_message_credits — atomic weekly-resetting message credit check
CREATE OR REPLACE FUNCTION use_message_credits(p_user_id UUID, p_cost INT)
RETURNS JSON AS $$
DECLARE
  rec RECORD;
  lim INT;
BEGIN
  SELECT plan, period_start, credits_used INTO rec
  FROM public.profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('allowed', false, 'error', 'user_not_found');
  END IF;

  -- Auto-reset weekly
  IF rec.period_start + INTERVAL '7 days' <= NOW() THEN
    UPDATE public.profiles
    SET credits_used = 0, transform_rows_used = 0, period_start = NOW()
    WHERE id = p_user_id;
    rec.credits_used := 0;
  END IF;

  lim := CASE WHEN rec.plan = 'pro' THEN 500 ELSE 50 END;

  IF rec.credits_used + p_cost > lim THEN
    RETURN json_build_object('allowed', false, 'credits_used', rec.credits_used, 'credits_limit', lim);
  END IF;

  UPDATE public.profiles SET credits_used = credits_used + p_cost WHERE id = p_user_id;
  RETURN json_build_object('allowed', true, 'credits_used', rec.credits_used + p_cost, 'credits_limit', lim);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RPC: use_transform_rows — atomic weekly-resetting transform row check
CREATE OR REPLACE FUNCTION use_transform_rows(p_user_id UUID, p_rows INT)
RETURNS JSON AS $$
DECLARE
  rec RECORD;
  lim INT;
BEGIN
  SELECT plan, period_start, transform_rows_used INTO rec
  FROM public.profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('allowed', false, 'error', 'user_not_found');
  END IF;

  IF rec.period_start + INTERVAL '7 days' <= NOW() THEN
    UPDATE public.profiles
    SET credits_used = 0, transform_rows_used = 0, period_start = NOW()
    WHERE id = p_user_id;
    rec.transform_rows_used := 0;
  END IF;

  lim := CASE WHEN rec.plan = 'pro' THEN 500000 ELSE 0 END;

  IF rec.transform_rows_used + p_rows > lim THEN
    RETURN json_build_object('allowed', false, 'transform_rows_used', rec.transform_rows_used, 'transform_rows_limit', lim);
  END IF;

  UPDATE public.profiles SET transform_rows_used = transform_rows_used + p_rows WHERE id = p_user_id;
  RETURN json_build_object('allowed', true, 'transform_rows_used', rec.transform_rows_used + p_rows, 'transform_rows_limit', lim);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Update signup trigger — free plan, no credits
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, plan, credits_used, period_start)
  VALUES (NEW.id, 'free', 0, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Cleanup old credit infrastructure
DROP FUNCTION IF EXISTS deduct_credits(UUID, INT, UUID, TEXT);
DROP FUNCTION IF EXISTS refund_credits(UUID, INT, UUID, TEXT);
DROP FUNCTION IF EXISTS add_purchase_credits(TEXT, TEXT, TEXT, UUID, INT);

DROP TABLE IF EXISTS credit_transactions;

-- Drop credits column from profiles (may not exist if already removed)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS credits;

-- Drop credit-related columns from jobs
ALTER TABLE public.jobs DROP COLUMN IF EXISTS credits_charged;
ALTER TABLE public.jobs DROP COLUMN IF EXISTS credits_refunded;

COMMIT;
