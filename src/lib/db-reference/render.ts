// Renders docs/reference/db.md from a snapshot of the live database's structure.
// Pure: the snapshot is fetched by scripts/gen-db-reference.ts. Structure only — never function bodies,
// cron commands (they can hold secrets) or row data.

export interface DbSnapshot {
  project: string
  generatedAt: string
  tables: { name: string; comment: string | null; rls: boolean }[]
  columns: { table: string; name: string; type: string; nullable: boolean; default: string | null; comment: string | null }[]
  constraints: { table: string; name: string; type: 'p' | 'u' | 'f' | 'c' | string; def: string }[]
  indexes: { table: string; name: string; def: string }[]
  policies: { schema: string; table: string; name: string; cmd: string; permissive: string; roles: string; using: string | null; check: string | null }[]
  triggers: { table: string; name: string; timing: string; events: string; action: string }[]
  functions: { name: string; args: string; returns: string; language: string; securityDefiner: boolean; volatility: string; anonExec: boolean; authExec: boolean }[]
  cron: { name: string; schedule: string; active: boolean }[]
  buckets: { id: string; public: boolean; sizeLimit: number | null; mimeTypes: string[] | null }[]
  views: { name: string; comment: string | null }[]
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)
const cell = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
const yn = (b: boolean) => (b ? 'yes' : 'no')
const VOL: Record<string, string> = { i: 'immutable', s: 'stable', v: 'volatile' }
const CON: Record<string, string> = { p: 'primary key', u: 'unique', f: 'foreign key', c: 'check', x: 'exclusion' }

function policiesTable(rows: DbSnapshot['policies']): string[] {
  if (!rows.length) return ['_No policies._', '']
  return [
    '| Policy | Command | Kind | Roles | USING | WITH CHECK |',
    '|---|---|---|---|---|---|',
    ...[...rows].sort(byName).map((p) =>
      `| \`${p.name}\` | ${p.cmd} | ${p.permissive.toLowerCase()} | ${cell(p.roles)} | ${cell(p.using)} | ${cell(p.check)} |`),
    '',
  ]
}

export function renderDbReference(s: DbSnapshot): string {
  const out: string[] = [
    '# Database reference (generated)',
    '',
    `> Generated from the live Supabase project \`${s.project}\` on ${s.generatedAt}. **Do not edit by hand** —`,
    '> run `SUPABASE_ACCESS_TOKEN=… npx tsx scripts/gen-db-reference.ts`. Structure only: no row data, function bodies or',
    '> cron commands. What things *mean* is in [`docs/domain/`](../domain/README.md).',
    '',
    `Tables: ${s.tables.length} · Functions: ${s.functions.length} · Cron jobs: ${s.cron.length} · Storage buckets: ${s.buckets.length}`,
    '',
    '## Tables',
    '',
    [...s.tables].sort(byName).map((t) => `[\`${t.name}\`](#${t.name.replace(/_/g, '_')})`).join(' · '),
    '',
  ]

  for (const t of [...s.tables].sort(byName)) {
    out.push(`### \`${t.name}\``, '')
    if (t.comment) out.push(cell(t.comment), '')
    out.push(`RLS: ${t.rls ? 'enabled' : '**disabled**'}`, '')
    const cols = s.columns.filter((c) => c.table === t.name)
    out.push('| Column | Type | Null | Default | Comment |', '|---|---|---|---|---|')
    for (const c of cols) out.push(`| \`${c.name}\` | ${cell(c.type)} | ${yn(c.nullable)} | ${cell(c.default)} | ${cell(c.comment)} |`)
    out.push('')
    const cons = s.constraints.filter((c) => c.table === t.name).sort(byName)
    if (cons.length) {
      out.push('**Constraints**', '')
      for (const c of cons) out.push(`- \`${c.name}\` (${CON[c.type] ?? c.type}): ${cell(c.def)}`)
      out.push('')
    }
    const idx = s.indexes.filter((i) => i.table === t.name).sort(byName)
    if (idx.length) {
      out.push('**Indexes**', '')
      for (const i of idx) out.push(`- \`${i.name}\`: ${cell(i.def)}`)
      out.push('')
    }
    out.push('**Policies**', '', ...policiesTable(s.policies.filter((p) => p.schema === 'public' && p.table === t.name)))
    const trg = s.triggers.filter((x) => x.table === t.name).sort(byName)
    if (trg.length) {
      out.push('**Triggers**', '')
      for (const x of trg) out.push(`- \`${x.name}\` ${x.timing} ${x.events}: ${cell(x.action)}`)
      out.push('')
    }
  }

  if (s.views.length) {
    out.push('## Views', '')
    for (const v of [...s.views].sort(byName)) out.push(`- \`${v.name}\`${v.comment ? ` — ${cell(v.comment)}` : ''}`)
    out.push('')
  }

  out.push(
    '## Functions (`public`)',
    '',
    'Signatures and security only. "anon"/"authenticated" = may the role execute it.',
    '',
    '| Function | Returns | Language | Security | Volatility | anon | authenticated |',
    '|---|---|---|---|---|---|---|',
    ...[...s.functions]
      .sort((a, b) => a.name.localeCompare(b.name) || a.args.localeCompare(b.args))
      .map((f) => `| \`${f.name}(${cell(f.args)})\` | ${cell(f.returns)} | ${f.language} | ${f.securityDefiner ? 'definer' : 'invoker'} | ${VOL[f.volatility] ?? f.volatility} | ${yn(f.anonExec)} | ${yn(f.authExec)} |`),
    '',
    '## Cron jobs (`pg_cron`)',
    '',
    'Name and schedule only — commands are not reproduced (they can contain secrets).',
    '',
    '| Job | Schedule (UTC) | Active |',
    '|---|---|---|',
    ...[...s.cron].sort(byName).map((c) => `| \`${c.name}\` | \`${c.schedule}\` | ${yn(c.active)} |`),
    '',
    '## Storage',
    '',
    '| Bucket | Public | Size limit | Allowed types |',
    '|---|---|---|---|',
    ...[...s.buckets].sort((a, b) => a.id.localeCompare(b.id)).map((b) =>
      `| \`${b.id}\` | ${yn(b.public)} | ${b.sizeLimit ?? ''} | ${(b.mimeTypes ?? []).join(', ')} |`),
    '',
    '### Storage policies (`storage.objects`)',
    '',
    ...policiesTable(s.policies.filter((p) => p.schema === 'storage')),
  )
  return out.join('\n')
}
