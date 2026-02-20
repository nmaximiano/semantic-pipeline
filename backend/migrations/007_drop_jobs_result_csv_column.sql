-- The result_csv column stored inline CSV output for the old /jobs/{id}/download endpoint.
-- That endpoint has been removed; results now live in dataset_rows and the datasets storage bucket.
ALTER TABLE public.jobs DROP COLUMN IF EXISTS result_csv;
