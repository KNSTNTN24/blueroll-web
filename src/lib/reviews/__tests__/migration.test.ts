import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const sql = readFileSync(path.resolve(__dirname, '../../../../supabase/migrations/20261015120000_google_reviews.sql'), 'utf8')

describe('google reviews migration', () => {
  it('adds manage_reviews to the catalog, the seed and the existing Owner/Manager presets', () => {
    expect(sql).toMatch(/insert into public\.capability_catalog\(cap\) values \('manage_reviews'\)/)
    expect(sql).toMatch(/'Manager','manager', base \|\| array\[[^\]]*'manage_reviews'/)
    expect(sql).toMatch(/update public\.roles set capabilities = array_append\(capabilities, 'manage_reviews'\)/)
  })
  it('never lets authenticated read vault_secret_id', () => {
    expect(sql).toMatch(/revoke all on public\.google_connections from anon, authenticated;/)
    expect(sql).toMatch(/grant select \(id, business_id, google_email, scopes, status, last_error, connected_by, connected_at, last_sync_at, revoked_at\) on public\.google_connections to authenticated;/)
    expect(sql).toMatch(/grant select \(id, review_id, review_version, draft_version, text, source, author_profile, author_channel, author_name, created_at\) on public\.review_drafts to authenticated;/)
    expect(sql).toMatch(/grant select \(id, review_id, business_id, action, actor_profile, actor_channel, actor_name, at, details\) on public\.review_audit to authenticated;/)
  })
  it('keeps Vault wrappers service-role only', () => {
    for (const fn of ['reviews_store_token(text, text)', 'reviews_read_token(uuid)', 'reviews_delete_token(uuid)', 'profiles_with_capability(uuid, text)']) {
      expect(sql).toContain(`revoke execute on function public.${fn} from public, anon, authenticated;`)
      expect(sql).toContain(`grant execute on function public.${fn} to service_role;`)
    }
  })
  it('accepts the telegram_reviews channel and gates its link codes on manage_reviews', () => {
    expect(sql).toMatch(/check \(channel in \('telegram','whatsapp','telegram_reviews'\)\)/)
    expect(sql).toMatch(/p_channel = 'telegram_reviews' and public\.can_manage_reviews\(v_biz\)/)
  })
  it('has entitlement write gates on every client-writable table, per operation', () => {
    expect(sql).toContain('create policy entitlement_write_gate_upd on public.google_locations as restrictive for update')
    expect(sql).toContain('create policy entitlement_write_gate_ins on public.review_routes as restrictive for insert')
    expect(sql).toContain('create policy entitlement_write_gate_ins on public.review_settings as restrictive for insert')
    expect(sql).toContain('create policy entitlement_write_gate_upd on public.review_settings as restrictive for update')
  })
  it('documents that channel_groups client updates rely on the live guard trigger', () => {
    expect(sql).toMatch(/-- Relies on the existing live trigger trg_guard_channel_groups_update/)
    expect(sql).toMatch(/drop policy if exists "review managers update review groups" on public\.channel_groups;/)
  })
})
