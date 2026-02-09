-- Semantic Pipeline Database Schema
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/fnnienxmuikwobdxnpey/sql)

-- User profiles (extends Supabase auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    credits INTEGER DEFAULT 50 NOT NULL CHECK (credits >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can only read their own profile
CREATE POLICY "Users can read own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile (but not credits directly)
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Credit transactions (audit log)
CREATE TABLE public.credit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,  -- positive = add, negative = spend
    type TEXT NOT NULL CHECK (type IN ('signup_bonus', 'purchase', 'job_charge', 'job_refund')),
    job_id UUID,  -- nullable, links to job if applicable
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- Users can only read their own transactions
CREATE POLICY "Users can read own transactions" ON public.credit_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- Jobs
CREATE TABLE public.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    filename TEXT,
    column_name TEXT,
    prompt TEXT,
    new_column_name TEXT,
    rows_total INTEGER NOT NULL,
    rows_processed INTEGER DEFAULT 0,
    credits_charged INTEGER NOT NULL,
    credits_refunded INTEGER DEFAULT 0,
    actual_cost_usd DECIMAL(10, 6),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Enable Row Level Security
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Users can only read their own jobs
CREATE POLICY "Users can read own jobs" ON public.jobs
    FOR SELECT USING (auth.uid() = user_id);

-- Function to create profile on signup (triggered automatically)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, credits)
    VALUES (NEW.id, NEW.email, 50);

    INSERT INTO public.credit_transactions (user_id, amount, type, description)
    VALUES (NEW.id, 50, 'signup_bonus', 'Welcome bonus');

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile on signup
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Index for faster job lookups
CREATE INDEX idx_jobs_user_id ON public.jobs(user_id);
CREATE INDEX idx_jobs_status ON public.jobs(status);
CREATE INDEX idx_credit_transactions_user_id ON public.credit_transactions(user_id);
