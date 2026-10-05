import { supabase } from '@/lib/supabase'
import type { Answers, Equipment, ExistingState, PackData } from './types'
import type { ApplyPayload } from './apply'
import { QUESTIONNAIRE_VERSION } from './content/questions'

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
  const { data, error: insErr } = await supabase
    .from('haccp_setup_sessions')
    .insert({ business_id: businessId, site_id: siteId, questionnaire_version: QUESTIONNAIRE_VERSION })
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
  const [tpl, pack] = await Promise.all([
    supabase.from('checklist_templates')
      .select('id, library_key, name, checklist_template_items(name)')
      .eq('business_id', businessId).eq('site_id', siteId).not('library_key', 'is', null),
    supabase.from('haccp_pack_data').select('data, updated_at').eq('business_id', businessId).maybeSingle(),
  ])
  if (tpl.error) throw tpl.error
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
  const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/haccp-assistant`, {
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
  return (await resp.json()) as T
}

export async function assistantParseEquipment(text: string): Promise<Equipment[]> {
  const r = await callAssistant<{ equipment: Equipment[] }>({ action: 'parse_equipment', text })
  return r.equipment
}

export async function assistantAnswer(question: string, venueType: string | undefined) {
  return callAssistant<{ answer: string; sources: { title: string; source: string }[] }>({ action: 'answer', question, venue_type: venueType })
}
