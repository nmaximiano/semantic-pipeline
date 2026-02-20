-- add_column_to_dataset was an old RPC from migration 006 that is no longer called
DROP FUNCTION IF EXISTS public.add_column_to_dataset(UUID, TEXT, TEXT);
