import { supabase } from '@/lib/supabase'
import type { Answers, Equipment, ExistingState, PackData } from './types'
import type { ApplyPayload } from './apply'
import { QUESTIONNAIRE_VERSION } from './content/questions'
import type { AutoDataSources } from '@/lib/haccp-pack/auto-data'
import { buildSetupContext, type SetupContext } from './context'

export interface SetupSession {
  id: string; business_id: string; site_id: string; questionnaire_version: number; answers: Answers; status: string
}

export async function loadOrCreateSession(businessId: string, siteId: string): Promise<SetupSession> {
  const { data: found, error } = await supabase
    .from('haccp_setup_sessions')
    .select('id, business_id, site_id, questionnaire_version, answers, status')
    .eq('business_id', businessId).eq('site_id', siteId).eq('status', 'in_progress')
    .order('created_at', { ascending: false }).limit(1)
  if (error) throw error
  if (found?.length) return found[0] as SetupSession
  // Re-run: start from the answers of the last applied setup for this site, so the owner only edits what changed.
  const { data: last, error: lastErr } = await supabase
    .from('haccp_setup_sessions')
    .select('answers')
    .eq('business_id', businessId).eq('site_id', siteId).eq('status', 'applied')
    .order('applied_at', { ascending: false }).limit(1)
  if (lastErr) throw lastErr
  const seed = (last?.[0]?.answers ?? {}) as Answers
  const { data, error: insErr } = await supabase
    .from('haccp_setup_sessions')
    .insert({ business_id: businessId, site_id: siteId, questionnaire_version: QUESTIONNAIRE_VERSION, answers: seed })
    .select('id, business_id, site_id, questionnaire_version, answers, status')
    .single()
  if (insErr) throw insErr
  return data as SetupSession
}

export async function saveAnswers(sessionId: string, answers: Answers): Promise<void> {
  const { error } = await supabase.from('haccp_setup_sessions')
    .update({ answers, updated_at: new Date().toISOString() }).eq('id', sessionId)
  if (error) throw error
}

export async function abandonSession(sessionId: string): Promise<void> {
  const { error } = await supabase.from('haccp_setup_sessions').update({ status: 'abandoned' }).eq('id', sessionId)
  if (error) throw error
}

export async function loadExisting(businessId: string, siteId: string): Promise<ExistingState> {
  const [tpl, others, pack] = await Promise.all([
    supabase.from('checklist_templates')
      .select('id, library_key, name, checklist_template_items(name)')
      .eq('business_id', businessId).eq('site_id', siteId).not('library_key', 'is', null),
    // Non-library checklists of this site or business-wide (onboarding defaults are inserted without site_id).
    supabase.from('checklist_templates')
      .select('id, name')
      .eq('business_id', businessId).is('library_key', null)
      .or(`site_id.eq.${siteId},site_id.is.null`),
    // The pack is per site (UNIQUE business_id + site_id).
    supabase.from('haccp_pack_data').select('data, updated_at').eq('business_id', businessId).eq('site_id', siteId).maybeSingle(),
  ])
  if (tpl.error) throw tpl.error
  if (others.error) throw others.error
  if (pack.error) throw pack.error
  const inner = (pack.data?.data ?? null) as Partial<PackData> | null
  return {
    templates: (tpl.data ?? []).map((t: any) => ({
      id: t.id, library_key: t.library_key, name: t.name,
      itemNames: (t.checklist_template_items ?? []).map((i: { name: string }) => i.name),
    })),
    pack: inner ? {
      toggles: inner.toggles ?? {}, texts: inner.texts ?? {}, files: inner.files ?? {},
      selects: inner.selects ?? {}, overrides: inner.overrides ?? {}, sources: inner.sources ?? {},
    } : null,
    // Pass back EXACTLY the string PostgREST returned (never via Date: microseconds would be lost).
    packUpdatedAt: pack.data?.updated_at ?? null,
    others: (others.data ?? []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })),
  }
}

export async function applySetup(sessionId: string, payload: ApplyPayload) {
  const { data, error } = await supabase.rpc('apply_haccp_setup', { p_session: sessionId, p_payload: payload })
  if (error) throw new Error(error.message)
  return data as { created: number; items_added: number }
}

export class AssistantError extends Error {
  constructor(public code: 'limit' | 'unavailable' | 'forbidden', msg: string) { super(msg) }
}

async function callAssistant<T>(body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new AssistantError('forbidden', 'Not signed in')
  // NEXT_PUBLIC_HACCP_ASSISTANT_URL lets local dev point at a locally served function.
  const fnUrl = process.env.NEXT_PUBLIC_HACCP_ASSISTANT_URL ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/haccp-assistant`
  const resp = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null)
  if (!resp) throw new AssistantError('unavailable', 'The assistant is not reachable right now.')
  if (resp.status === 429) throw new AssistantError('limit', "You've reached today's limit of 30 assistant questions. Try again tomorrow.")
  if (resp.status === 401 || resp.status === 403) throw new AssistantError('forbidden', 'Only owners and managers can use the assistant.')
  if (!resp.ok) throw new AssistantError('unavailable', 'The assistant is not available right now.')
  try {
    return (await resp.json()) as T
  } catch {
    throw new AssistantError('unavailable', 'The assistant is not available right now.')
  }
}

export async function assistantParseEquipment(text: string): Promise<Equipment[]> {
  const r = await callAssistant<{ equipment: Equipment[] }>({ action: 'parse_equipment', text })
  return r.equipment
}

export async function assistantAnswer(question: string, venueType: string | undefined) {
  return callAssistant<{ answer: string; sources: { title: string; source: string }[] }>({ action: 'answer', question, venue_type: venueType })
}

/** Everything the questionnaire can confirm instead of asking, read with the user's RLS (same sources as the pack page). */
export async function loadSetupContext(businessId: string, siteId: string): Promise<SetupContext> {
  const [business, recipes, dishes, suppliers, templates, documents, team] = await Promise.all([
    supabase.from('businesses').select('haccp_auto_fill').eq('id', businessId).maybeSingle(),
    supabase.from('recipes').select(
      `id, name, cooking_method, cooking_temp, extra_care_flags, reheating_instructions, hot_holding_required,
       chilling_method, freezing_instructions, defrosting_instructions, haccp_methods,
       recipe_ingredients(ingredient:ingredients(name, allergens))`,
    ).eq('business_id', businessId),
    supabase.from('menu_items').select(
      'id, name, category, active, allergen_source, recipe_id, declared_allergens, may_contain, dietary, attested_by_name, attested_at, site_ids, recipe:recipes(id, name, recipe_ingredients(ingredient:ingredients(name, allergens)))',
    ).eq('business_id', businessId).order('name'),
    supabase.from('suppliers').select('id, name, contact_name, phone, email, delivery_days').eq('business_id', businessId),
    supabase.from('checklist_templates').select('id, name, frequency, sfbb_section, library_key, active, site_id').eq('business_id', businessId),
    supabase.from('documents').select('id, title, category').eq('business_id', businessId).order('title'),
    supabase.from('profiles').select('full_name, role').eq('business_id', businessId).is('removed_at', null),
  ])
  for (const r of [business, recipes, dishes, suppliers, templates, documents, team]) if (r.error) throw r.error
  const liveTemplates = (templates.data ?? []).filter((t) => t.active !== false && (!t.site_id || t.site_id === siteId))
  const sources: AutoDataSources = {
    recipes: (recipes.data ?? []) as unknown as AutoDataSources['recipes'],
    dishes: (dishes.data ?? []) as unknown as AutoDataSources['dishes'],
    suppliers: (suppliers.data ?? []) as AutoDataSources['suppliers'],
    templates: liveTemplates as AutoDataSources['templates'],
    documents: (documents.data ?? []) as AutoDataSources['documents'],
    team: (team.data ?? []) as AutoDataSources['team'],
  }
  return buildSetupContext(sources, siteId, sources.documents, { autoFill: business.data?.haccp_auto_fill ?? true })
}

/** The site's current setup for the pack page panel: the open session, else the last applied one, else none. Read-only (never creates a session). */
export async function loadSessionSummary(businessId: string, siteId: string): Promise<{ status: string; answers: Answers | null } | null> {
  const { data, error } = await supabase
    .from('haccp_setup_sessions')
    .select('status, answers, created_at')
    .eq('business_id', businessId).eq('site_id', siteId).in('status', ['in_progress', 'applied'])
    .order('created_at', { ascending: false }).limit(5)
  if (error) throw error
  const rows = (data ?? []) as { status: string; answers: Answers | null }[]
  return rows.find((r) => r.status === 'in_progress') ?? rows.find((r) => r.status === 'applied') ?? null
}
