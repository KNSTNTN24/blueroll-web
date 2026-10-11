// Web client for Telegram groups (Settings → Messaging). Writes go through RLS: managers may map checklists, flip
// `alerts` and unlink (a DB trigger blocks every other column). The bot links groups; the cron removes an unlinked
// group's lists within 10 minutes (the web app can't call the Bot API).
import { supabase } from '@/lib/supabase'

export interface TelegramGroup { id: string; title: string; alerts: boolean; linked_at: string; template_ids: string[] }
export interface ChecklistOption { id: string; name: string; site_id: string | null }

export const LINK_CODE_TTL_SEC = 900

export const GROUP_LINK_STEPS = (code: string) => [
  'Open the staff group in Telegram (for example “Kitchen”), or create one.',
  'Add @BluerollChecksBot to the group.',
  `Send this message in the group: /link@BluerollChecksBot ${code}`,
  'In the group settings → Permissions, turn off “Add members” for members.',
]

export function mappingDiff(current: string[], next: string[]) {
  const cur = new Set(current)
  const nxt = new Set(next)
  return { add: [...nxt].filter((x) => !cur.has(x)), remove: [...cur].filter((x) => !nxt.has(x)) }
}

export const checklistLabel = (o: ChecklistOption, siteNames: Map<string, string>) =>
  o.site_id ? `${o.name} · ${siteNames.get(o.site_id) ?? 'other site'}` : o.name

export async function listGroups(businessId: string): Promise<TelegramGroup[]> {
  const { data, error } = await supabase.from('channel_groups')
    .select('id, title, alerts, linked_at, channel_group_checklists(template_id)')
    .eq('business_id', businessId).eq('channel', 'telegram').is('unlinked_at', null).order('linked_at')
  if (error) throw error
  return ((data ?? []) as unknown as { id: string; title: string | null; alerts: boolean; linked_at: string; channel_group_checklists: { template_id: string }[] | null }[])
    .map((g) => ({ id: g.id, title: g.title || 'Telegram group', alerts: !!g.alerts, linked_at: g.linked_at, template_ids: (g.channel_group_checklists ?? []).map((m) => m.template_id) }))
}

export async function listChecklistOptions(businessId: string): Promise<ChecklistOption[]> {
  const { data, error } = await supabase.from('checklist_templates').select('id, name, site_id')
    .eq('business_id', businessId).eq('active', true).order('name')
  if (error) throw error
  return (data ?? []) as ChecklistOption[]
}

/** Server-generated 6-digit code for the caller's business (15 min, one use). */
export async function issueGroupLinkCode(): Promise<string> {
  const { data, error } = await supabase.rpc('issue_group_link_code', { p_channel: 'telegram' })
  if (error) throw error
  return data as string
}

export async function saveGroupChecklists(groupId: string, current: string[], next: string[]): Promise<void> {
  const { add, remove } = mappingDiff(current, next)
  if (remove.length) {
    const { error } = await supabase.from('channel_group_checklists').delete().eq('group_id', groupId).in('template_id', remove)
    if (error) throw error
  }
  if (add.length) {
    const { error } = await supabase.from('channel_group_checklists').insert(add.map((template_id) => ({ group_id: groupId, template_id })))
    if (error) throw error
  }
}

export async function setGroupAlerts(groupId: string, alerts: boolean): Promise<void> {
  const { error } = await supabase.from('channel_groups').update({ alerts }).eq('id', groupId)
  if (error) throw error
}

export async function unlinkGroup(groupId: string): Promise<void> {
  // The DB trigger stamps the real time; the value sent only needs to be non-null.
  const { error } = await supabase.from('channel_groups').update({ unlinked_at: new Date().toISOString() }).eq('id', groupId)
  if (error) throw error
}
