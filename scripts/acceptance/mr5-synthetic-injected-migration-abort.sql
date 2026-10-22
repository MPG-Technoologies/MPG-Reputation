-- MR-5I20 -- synthetic-only injected failure for the isolated test migration transaction.
-- Called after the first held candidate migration within psql --single-transaction.
-- NEVER apply this as a Supabase migration; intentional exception always aborts.
DO $mr5i20_abort$
BEGIN
  RAISE EXCEPTION 'MR5I20_SYNTHETIC_ABORT_EXPECTED' USING ERRCODE = 'P0001';
END;
$mr5i20_abort$;
