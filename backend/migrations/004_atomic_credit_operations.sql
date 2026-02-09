-- FIX 1: Remove the UPDATE policy on profiles so users cannot set their own credits
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- FIX 2: Atomic credit deduction (race-free)
CREATE OR REPLACE FUNCTION deduct_credits(
    p_user_id UUID,
    p_amount INT,
    p_job_id UUID,
    p_description TEXT
) RETURNS INT AS $$
DECLARE
    new_balance INT;
BEGIN
    UPDATE public.profiles
    SET credits = credits - p_amount
    WHERE id = p_user_id AND credits >= p_amount
    RETURNING credits INTO new_balance;

    IF NOT FOUND THEN
        RETURN -1;  -- insufficient credits
    END IF;

    INSERT INTO public.credit_transactions (user_id, amount, type, job_id, description)
    VALUES (p_user_id, -p_amount, 'job_charge', p_job_id, p_description);

    RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic credit refund (race-free)
CREATE OR REPLACE FUNCTION refund_credits(
    p_user_id UUID,
    p_amount INT,
    p_job_id UUID,
    p_description TEXT
) RETURNS INT AS $$
DECLARE
    new_balance INT;
BEGIN
    UPDATE public.profiles
    SET credits = credits + p_amount
    WHERE id = p_user_id
    RETURNING credits INTO new_balance;

    INSERT INTO public.credit_transactions (user_id, amount, type, job_id, description)
    VALUES (p_user_id, p_amount, 'job_refund', p_job_id, p_description);

    RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- FIX 3: Atomic purchase credit addition with idempotency (race-free)
CREATE OR REPLACE FUNCTION add_purchase_credits(
    p_event_id TEXT,
    p_event_type TEXT,
    p_checkout_session_id TEXT,
    p_user_id UUID,
    p_credits INT
) RETURNS BOOLEAN AS $$
BEGIN
    -- Idempotency: insert event, skip if duplicate
    INSERT INTO public.stripe_events (event_id, event_type, checkout_session_id, user_id, credits_added)
    VALUES (p_event_id, p_event_type, p_checkout_session_id, p_user_id, p_credits)
    ON CONFLICT (event_id) DO NOTHING;

    IF NOT FOUND THEN
        RETURN FALSE;  -- already processed
    END IF;

    -- Atomically add credits
    UPDATE public.profiles SET credits = credits + p_credits WHERE id = p_user_id;

    -- Log transaction
    INSERT INTO public.credit_transactions (user_id, amount, type, description)
    VALUES (p_user_id, p_credits, 'purchase', 'Purchased ' || p_credits || ' credits via Stripe');

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
