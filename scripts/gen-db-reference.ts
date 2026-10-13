// scripts/gen-db-reference.ts
// Regenerates docs/reference/db.md from the live database structure (read-only catalog queries).
// Usage: SUPABASE_ACCESS_TOKEN=<personal access token> npx tsx scripts/gen-db-reference.ts
// Optional: SUPABASE_PROJECT_REF (default rszrggreuarvodcqeqrj), OUT (default docs/reference/db.md).
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { renderDbReference, type DbSnapshot } from '../src/lib/db-reference/render'

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const REF = process.env.SUPABASE_PROJECT_REF ?? 'rszrggreuarvodcqeqrj'
const OUT = process.env.OUT ?? 'docs/reference/db.md'
if (!TOKEN) {
  console.error('Set SUPABASE_ACCESS_TOKEN (Supabase personal access token).')
  process.exit(1)
}

async function q<T>(sql: string): Promise<T[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (!r.ok) throw new Error(`query failed: HTTP ${r.status}`)
  return (await r.json()) as T[]
}

// Objects created by extensions (pg_cron, pgcrypto…) are not ours; leave them out.
const NOT_EXT = `not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`

async function main() {
  const [tables, columns, constraints, indexes, policies, triggers, functions, cron, buckets, views] = await Promise.all([
    q<DbSnapshot['tables'][number]>(`
      select c.relname as name, obj_description(c.oid) as comment, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`),
    q<DbSnapshot['columns'][number]>(`
      select k.table_name as table, k.column_name as name,
             case when k.data_type = 'ARRAY' then substr(k.udt_name, 2) || '[]'
                  when k.data_type = 'USER-DEFINED' then k.udt_name else k.data_type end as type,
             (k.is_nullable = 'YES') as nullable, k.column_default as default,
             col_description(format('public.%I', k.table_name)::regclass, k.ordinal_position) as comment
      from information_schema.columns k
      join pg_class c on c.relname = k.table_name and c.relkind = 'r'
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where k.table_schema = 'public'
      order by k.table_name, k.ordinal_position`),
    q<DbSnapshot['constraints'][number]>(`
      select conrelid::regclass::text as table, conname as name, contype as type, pg_get_constraintdef(oid) as def
      from pg_constraint where connamespace = 'public'::regnamespace and contype in ('p','u','f','c','x')`),
    q<DbSnapshot['indexes'][number]>(`
      select tablename as table, indexname as name, indexdef as def from pg_indexes where schemaname = 'public'`),
    q<DbSnapshot['policies'][number]>(`
      select schemaname as schema, tablename as table, policyname as name, cmd, permissive,
             roles::text as roles, qual as using, with_check as check
      from pg_policies where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')`),
    q<DbSnapshot['triggers'][number]>(`
      select event_object_table as table, trigger_name as name, action_timing as timing,
             string_agg(event_manipulation, '/' order by event_manipulation) as events, action_statement as action
      from information_schema.triggers where event_object_schema = 'public'
      group by 1, 2, 3, 5`),
    q<DbSnapshot['functions'][number]>(`
      select p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
             pg_get_function_result(p.oid) as returns, l.lanname as language,
             p.prosecdef as "securityDefiner", p.provolatile as volatility,
             has_function_privilege('anon', p.oid, 'execute') as "anonExec",
             has_function_privilege('authenticated', p.oid, 'execute') as "authExec"
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
      where n.nspname = 'public' and p.prokind in ('f','p') and ${NOT_EXT}`),
    // Never select cron.job.command: it can contain secrets.
    q<DbSnapshot['cron'][number]>(`select jobname as name, schedule, active from cron.job`),
    q<DbSnapshot['buckets'][number]>(`
      select id, public, file_size_limit as "sizeLimit", allowed_mime_types as "mimeTypes" from storage.buckets`),
    q<DbSnapshot['views'][number]>(`
      select c.relname as name, obj_description(c.oid) as comment
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v','m')`),
  ])

  const md = renderDbReference({
    project: REF,
    generatedAt: new Date().toISOString().slice(0, 10),
    tables, columns, constraints, indexes, policies, triggers, functions, cron, buckets, views,
  })
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, md + '\n')
  console.log(`wrote ${OUT}: ${tables.length} tables, ${functions.length} functions, ${cron.length} cron jobs`)
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
