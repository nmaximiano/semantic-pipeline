-- Table for storing individual dataset rows as JSONB
CREATE TABLE public.dataset_rows (
    dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
    row_number INT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (dataset_id, row_number)
);

ALTER TABLE public.dataset_rows ENABLE ROW LEVEL SECURITY;

-- RPC: paginated rows sorted by a JSONB field
CREATE OR REPLACE FUNCTION public.get_sorted_dataset_rows(
    p_dataset_id UUID,
    p_sort_col TEXT,
    p_direction TEXT DEFAULT 'asc',
    p_limit INT DEFAULT 50,
    p_offset INT DEFAULT 0
)
RETURNS TABLE(row_number INT, data JSONB) AS $$
BEGIN
    IF lower(p_direction) = 'desc' THEN
        RETURN QUERY
            SELECT dr.row_number, dr.data
            FROM public.dataset_rows dr
            WHERE dr.dataset_id = p_dataset_id
            ORDER BY dr.data->>p_sort_col DESC NULLS LAST
            LIMIT p_limit OFFSET p_offset;
    ELSE
        RETURN QUERY
            SELECT dr.row_number, dr.data
            FROM public.dataset_rows dr
            WHERE dr.dataset_id = p_dataset_id
            ORDER BY dr.data->>p_sort_col ASC NULLS LAST
            LIMIT p_limit OFFSET p_offset;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: add a column (key) to every row in a dataset
CREATE OR REPLACE FUNCTION public.add_column_to_dataset(
    p_dataset_id UUID,
    p_column_name TEXT,
    p_default_value TEXT DEFAULT '0'
)
RETURNS INT AS $$
DECLARE
    affected INT;
BEGIN
    UPDATE public.dataset_rows
    SET data = data || jsonb_build_object(p_column_name, p_default_value)
    WHERE dataset_id = p_dataset_id;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
