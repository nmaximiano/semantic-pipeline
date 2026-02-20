ALTER TABLE public.datasets
  ADD COLUMN source_dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL;
