CREATE TABLE public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Untitled session',
    history JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own sessions" ON public.sessions FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_sessions_user_id ON public.sessions(user_id);

CREATE TABLE public.session_datasets (
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
    display_order INT NOT NULL DEFAULT 0,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (session_id, dataset_id)
);
ALTER TABLE public.session_datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own session_datasets" ON public.session_datasets FOR ALL
    USING (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_datasets.session_id AND s.user_id = auth.uid()));
CREATE INDEX idx_session_datasets_dataset ON public.session_datasets(dataset_id);
