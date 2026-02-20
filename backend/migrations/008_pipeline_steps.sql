CREATE TABLE public.pipeline_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
    step_number INT NOT NULL,
    operation TEXT NOT NULL,
    params JSONB NOT NULL DEFAULT '{}',
    result_summary TEXT,
    column_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(dataset_id, step_number)
);
ALTER TABLE public.pipeline_steps ENABLE ROW LEVEL SECURITY;
