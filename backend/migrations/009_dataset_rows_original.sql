-- Immutable copy of original uploaded rows (replaces downloading CSV from Storage for replay)
CREATE TABLE public.dataset_rows_original (
    dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
    row_number INT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (dataset_id, row_number)
);
ALTER TABLE public.dataset_rows_original ENABLE ROW LEVEL SECURITY;

-- Store original column order (JSONB doesn't preserve key order)
ALTER TABLE public.datasets ADD COLUMN IF NOT EXISTS original_columns TEXT[];

-- Backfill existing datasets that have no pipeline steps
INSERT INTO dataset_rows_original (dataset_id, row_number, data)
SELECT dataset_id, row_number, data FROM dataset_rows
WHERE dataset_id IN (
    SELECT id FROM datasets
    WHERE id NOT IN (SELECT DISTINCT dataset_id FROM pipeline_steps)
)
ON CONFLICT DO NOTHING;

-- Set original_columns from current columns for existing datasets
UPDATE datasets SET original_columns = ARRAY(SELECT jsonb_array_elements_text(columns))
WHERE original_columns IS NULL;

-- Also add 'cancelling'/'cancelled' to jobs status constraint (was missing)
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelling', 'cancelled'));
