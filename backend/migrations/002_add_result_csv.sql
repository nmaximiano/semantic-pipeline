-- Add result_csv column to persist output CSVs for background job downloads
ALTER TABLE public.jobs ADD COLUMN result_csv TEXT;
