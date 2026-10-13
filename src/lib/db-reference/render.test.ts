import { describe, it, expect } from 'vitest'
import { renderDbReference, type DbSnapshot } from './render'

const snap: DbSnapshot = {
  project: 'proj',
  generatedAt: '2026-10-13',
  tables: [
    { name: 'sites', comment: 'One premises', rls: true },
    { name: 'businesses', comment: null, rls: true },
  ],
  columns: [
    { table: 'sites', name: 'id', type: 'uuid', nullable: false, default: 'gen_random_uuid()', comment: null },
    { table: 'sites', name: 'business_id', type: 'uuid', nullable: false, default: null, comment: 'Owner business' },
    { table: 'businesses', name: 'id', type: 'uuid', nullable: false, default: null, comment: null },
  ],
  constraints: [
    { table: 'sites', name: 'sites_business_id_fkey', type: 'f', def: 'FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE' },
    { table: 'sites', name: 'sites_status_check', type: 'c', def: "CHECK (status = ANY (ARRAY['active'::text]))" },
  ],
  indexes: [{ table: 'sites', name: 'sites_pkey', def: 'CREATE UNIQUE INDEX sites_pkey ON public.sites USING btree (id)' }],
  policies: [
    { schema: 'public', table: 'sites', name: 'sites_select', cmd: 'SELECT', permissive: 'PERMISSIVE', roles: '{authenticated}', using: 'can_list_site(id)', check: null },
  ],
  triggers: [{ table: 'sites', name: 'trg_x', timing: 'AFTER', events: 'INSERT/DELETE', action: 'EXECUTE FUNCTION sites_sync_quantity()' }],
  functions: [
    { name: 'has_capability', args: 'cap text', returns: 'boolean', language: 'sql', securityDefiner: true, volatility: 's', anonExec: false, authExec: true },
  ],
  cron: [{ name: 'nightly', schedule: '10 1 * * *', active: true }],
  buckets: [{ id: 'documents', public: false, sizeLimit: null, mimeTypes: null }],
  views: [],
}

describe('renderDbReference', () => {
  it('renders tables alphabetically with columns, constraints, indexes, policies and triggers', () => {
    const md = renderDbReference(snap)
    expect(md.indexOf('### `businesses`')).toBeLessThan(md.indexOf('### `sites`'))
    expect(md).toContain('| `business_id` | uuid | no |  | Owner business |')
    expect(md).toContain('FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE')
    expect(md).toContain('`sites_select`')
    expect(md).toContain('can_list_site(id)')
    expect(md).toContain('trg_x')
    expect(md).toContain('One premises')
  })
  it('lists functions with security and grants but never their bodies', () => {
    const md = renderDbReference(snap)
    expect(md).toContain('| `has_capability(cap text)` | boolean | sql | definer | stable | no | yes |')
  })
  it('lists cron jobs by name and schedule only, never the command', () => {
    const withCommand = { ...snap, cron: [{ name: 'nightly', schedule: '10 1 * * *', active: true, command: "select x('secret-value')" }] }
    const md = renderDbReference(withCommand as DbSnapshot)
    expect(md).toContain('| `nightly` | `10 1 * * *` | yes |')
    expect(md).not.toContain('secret-value')
  })
  it('is deterministic (same input, same output) and carries the regenerate note', () => {
    expect(renderDbReference(snap)).toBe(renderDbReference(snap))
    expect(renderDbReference(snap)).toContain('scripts/gen-db-reference.ts')
  })
})
