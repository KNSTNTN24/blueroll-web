-- Placeholder for prod migration 20260713110523 (sites_soft_delete_removed_at).
-- It was applied directly in prod (dashboard / MCP) and its SQL was not recorded in
-- supabase_migrations.schema_migrations, so it cannot be recovered here. The objects it
-- created exist in prod. This file keeps the local migration list aligned with prod so
-- "supabase db push" and "supabase migration list" work. Intentionally a no-op.
select 1;
