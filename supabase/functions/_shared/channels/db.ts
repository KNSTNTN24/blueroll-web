// supabase/functions/_shared/channels/db.ts
// Supabase-backed BotDeps. `admin` is a service-role supabase-js client (typed loosely to keep this file import-free).
// Never log raw phone numbers from here — use maskPhone.
import type { BotDeps, FormToken, Identity } from './bot.ts'
import type { SendFn } from './types.ts'
import { maskPhone } from './mask.ts'

const IDENTITY_COLS = 'id, business_id, profile_id, external_id'

/** Hex SHA-256 of a phone number — used as ref_id for link-failure rows so the raw number is never stored there. */
export async function hashExternalId(externalId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(externalId))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// deno-lint-ignore no-explicit-any
export function makeDeps(admin: any, cfg: { send: SendFn; correctiveFlowId: string }): BotDeps {
  // deno-lint-ignore no-explicit-any
  const one = async (q: any) => { const { data, error } = await q; if (error) throw error; return data }

  // Active (not soft-removed) owners/managers — parity with web getManagerIds + soft-remove.
  const activeManagerIds = async (b: string): Promise<string[]> =>
    ((await one(admin.from('profiles').select('id').eq('business_id', b).in('role', ['owner', 'manager']).is('removed_at', null))) ?? [])
      // deno-lint-ignore no-explicit-any
      .map((p: any) => p.id)

  return {
    now: () => new Date(),
    send: cfg.send,
    newToken: () => crypto.randomUUID().replace(/-/g, ''),
    correctiveFlowId: () => cfg.correctiveFlowId,

    findIdentity: async (x) => (await one(admin.from('channel_identities').select(IDENTITY_COLS)
      .eq('channel', 'whatsapp').eq('external_id', x).is('revoked_at', null).maybeSingle())) ?? null,
    touchIdentity: async (id, at) => { await one(admin.from('channel_identities').update({ last_inbound_at: at.toISOString() }).eq('id', id)) },
    revokeIdentity: async (id) => {
      await one(admin.from('channel_identities').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null))
    },

    consumeLinkCode: async (code, externalId, now) => {
      const nowIso = now.toISOString()
      // Atomic claim: only one caller can flip used_at on a live code.
      const claimed = await one(admin.from('channel_link_codes').update({ used_at: nowIso })
        .eq('code', code).is('used_at', null).gt('expires_at', nowIso)
        .select('code, business_id, profile_id, site_id, issued_by'))
      const c = claimed?.[0]
      if (!c) return { ok: false }
      // Give the code back if the team can't use WhatsApp yet (manager can enable it and the worker retries).
      const release = async () => {
        await one(admin.from('channel_link_codes').update({ used_at: null }).eq('code', code).eq('used_at', nowIso))
      }
      let ready: boolean
      try { ready = !!(await one(admin.rpc('whatsapp_ready', { b: c.business_id }))) }
      catch (err) { await release(); throw err }   // transient failure: don't burn the worker's code
      if (!ready) { await release(); return { ok: false } }
      const prof = await one(admin.from('profiles').select('full_name, site_id')
        .eq('id', c.profile_id).eq('business_id', c.business_id).is('removed_at', null).maybeSingle())
      if (!prof) return { ok: false }   // member removed after the code was issued — code stays burnt
      // One active identity per number and per profile: revoke both before linking (two queries, no filter-string interpolation).
      await one(admin.from('channel_identities').update({ revoked_at: nowIso })
        .eq('channel', 'whatsapp').eq('external_id', externalId).is('revoked_at', null))
      await one(admin.from('channel_identities').update({ revoked_at: nowIso })
        .eq('channel', 'whatsapp').eq('profile_id', c.profile_id).is('revoked_at', null))
      const identity: Identity = await one(admin.from('channel_identities').insert({
        business_id: c.business_id, profile_id: c.profile_id, channel: 'whatsapp', external_id: externalId,
        consent_source: 'qr_code', consent_text_version: 1, linked_by: c.issued_by, last_inbound_at: nowIso,
      }).select(IDENTITY_COLS).single())
      const siteId = c.site_id ?? prof.site_id
      const site = siteId
        ? await one(admin.from('sites').select('name').eq('id', siteId).eq('business_id', c.business_id).is('removed_at', null).maybeSingle())
        : null
      console.log('whatsapp linked', maskPhone(externalId))
      return { ok: true, identity, name: (prof.full_name ?? '').split(' ')[0] || 'there', siteName: site?.name ?? 'your team' }
    },

    ready: async (b) => !!(await one(admin.rpc('whatsapp_ready', { b }))),

    person: async (pid) => {
      const p = await one(admin.from('profiles').select('id, business_id, full_name, role, role_id')
        .eq('id', pid).is('removed_at', null).maybeSingle())
      return p && p.business_id
        ? { profile_id: p.id, business_id: p.business_id, full_name: p.full_name ?? '', role: p.role, role_id: p.role_id ?? null }
        : null
    },

    sitesFor: async (pid) => {
      const prof = await one(admin.from('profiles').select('business_id, site_id, is_group_admin').eq('id', pid).is('removed_at', null).maybeSingle())
      if (!prof?.business_id) return []
      const ms = await one(admin.from('member_sites').select('site_id').eq('profile_id', pid))
      // deno-lint-ignore no-explicit-any
      const ids: string[] = (ms ?? []).map((r: any) => r.site_id)
      if (prof.site_id && !ids.includes(prof.site_id)) ids.push(prof.site_id)
      if (!prof.is_group_admin && !ids.length) return []
      let q = admin.from('sites').select('id, name, timezone, status').eq('business_id', prof.business_id).is('removed_at', null)
      if (!prof.is_group_admin) q = q.in('id', ids)
      const rows = await one(q)
      // deno-lint-ignore no-explicit-any
      return (rows ?? []).filter((s: any) => s.status !== 'removed')
        // deno-lint-ignore no-explicit-any
        .map((s: any) => ({ id: s.id, name: s.name, timezone: s.timezone ?? 'Europe/London' }))
    },

    templates: async (b) => ((await one(admin.from('checklist_templates')
      .select('id, business_id, site_id, name, frequency, deadline_time, multi_per_day, min_per_day, assigned_roles, assigned_role_ids, active')
      // deno-lint-ignore no-explicit-any
      .eq('business_id', b).eq('active', true))) ?? []).map((t: any) => ({ ...t, assigned_roles: t.assigned_roles ?? [], assigned_role_ids: t.assigned_role_ids ?? [] })),
    items: async (tid) => (await one(admin.from('checklist_template_items')
      .select('id, name, item_type, required, min_value, max_value, unit, sort_order').eq('template_id', tid))) ?? [],
    completionsSince: async (b, since) => (await one(admin.from('checklist_completions')
      .select('template_id, site_id, completed_at').eq('business_id', b).gte('completed_at', since.toISOString()))) ?? [],
    flowFor: async (tid, sid) => {
      const f = await one(admin.from('channel_flows').select('flow_id, item_ids, status')
        .eq('template_id', tid).eq('site_id', sid).eq('channel', 'whatsapp').maybeSingle())
      return f && f.status === 'published' && f.flow_id ? { flow_id: f.flow_id, item_ids: f.item_ids } : null
    },

    saveToken: async (t: FormToken) => { await one(admin.from('channel_form_tokens').insert(t)) },
    // One atomic UPDATE: only the owner's unused, unexpired token is consumed.
    takeToken: async (token, now, profileId) => {
      const nowIso = now.toISOString()
      const rows = await one(admin.from('channel_form_tokens').update({ used_at: nowIso })
        .eq('token', token).eq('profile_id', profileId).is('used_at', null).gt('expires_at', nowIso)
        .select('token, kind, business_id, profile_id, site_id, template_id, item_ids, response_id, expires_at, used_at'))
      return (rows?.[0] as FormToken | undefined) ?? null
    },

    setCorrective: async (rid, notes) => {
      const r = await one(admin.from('checklist_responses').update({ notes, corrective_status: 'done' })
        .eq('id', rid).eq('corrective_status', 'needed')
        .select('value, item:checklist_template_items(name), completion:checklist_completions(business_id, site_id, completed_by, template:checklist_templates(name))')
        .maybeSingle())
      if (!r || !r.completion) return null
      const site = r.completion.site_id ? await one(admin.from('sites').select('name').eq('id', r.completion.site_id).maybeSingle()) : null
      const by = r.completion.completed_by ? await one(admin.from('profiles').select('full_name').eq('id', r.completion.completed_by).maybeSingle()) : null
      return {
        templateName: r.completion.template?.name ?? '', itemName: r.item?.name ?? '', value: r.value ?? '',
        siteName: site?.name ?? '', byName: by?.full_name ?? '', businessId: r.completion.business_id,
      }
    },

    managerExternalIds: async (b) => {
      const mgr = await activeManagerIds(b)
      if (!mgr.length) return []
      const ids = await one(admin.from('channel_identities').select('external_id')
        .eq('channel', 'whatsapp').eq('business_id', b).is('revoked_at', null).in('profile_id', mgr))
      // deno-lint-ignore no-explicit-any
      return (ids ?? []).map((i: any) => i.external_id)
    },

    log: async (e) => {
      const { error } = await admin.from('channel_messages_log').insert({ ...e, channel: 'whatsapp' })
      if (error) console.error('channel_messages_log insert failed', e.kind, (error.message ?? '').slice(0, 200))
    },

    linkFailures: async (externalId, since) => {
      const { count, error } = await admin.from('channel_messages_log').select('id', { count: 'exact', head: true })
        .eq('kind', 'link_fail').eq('ref_id', await hashExternalId(externalId)).gte('created_at', since.toISOString())
      if (error) throw error
      return count ?? 0
    },
    recordLinkFailure: async (externalId, at) => {
      await one(admin.from('channel_messages_log').insert({
        business_id: null, site_id: null, profile_id: null, channel: 'whatsapp', direction: 'in', kind: 'link_fail',
        billable: false, ref_id: await hashExternalId(externalId), created_at: at.toISOString(),
      }))
    },

    pendingCorrective: async (pid) => {
      const since = new Date(Date.now() - 2 * 86400_000).toISOString()
      const rows = await one(admin.from('checklist_responses')
        .select('id, value, item:checklist_template_items(id, name, item_type, required, min_value, max_value, unit, sort_order), completion:checklist_completions!inner(site_id, template_id, completed_by, completed_at, source)')
        .eq('corrective_status', 'needed').eq('completion.completed_by', pid).eq('completion.source', 'whatsapp')
        .gte('completion.completed_at', since))
      // deno-lint-ignore no-explicit-any
      return ((rows ?? []) as any[])
        .filter((r) => r.item && r.completion?.site_id)
        .sort((a, b) => String(a.completion.completed_at).localeCompare(String(b.completion.completed_at)))
        .map((r) => ({ response_id: r.id, item: r.item, value: r.value ?? '', site_id: r.completion.site_id, template_id: r.completion.template_id }))
    },

    insertCompletion: async (row) => await one(admin.from('checklist_completions').insert(row).select('id').single()),
    insertResponses: async (rows) => (await one(admin.from('checklist_responses').insert(rows).select('id, item_id'))) ?? [],
    managerIds: activeManagerIds,
    insertNotifications: async (rows) => { if (rows.length) await one(admin.from('notifications').insert(rows)) },
  }
}
