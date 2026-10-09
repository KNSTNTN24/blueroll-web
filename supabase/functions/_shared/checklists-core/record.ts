// supabase/functions/_shared/checklists-core/record.ts
import type { Answer, Person, Template, TemplateItem } from './types.ts'

export interface CoreDb {
  insertCompletion(row: { template_id: string; business_id: string; site_id: string; completed_by: string; completed_at: string; source: 'whatsapp' | 'telegram' | 'app' }): Promise<{ id: string }>
  insertResponses(rows: { completion_id: string; item_id: string; value: string; notes: string | null; flagged: boolean; corrective_status: 'needed' | null }[]): Promise<{ id: string; item_id: string }[]>
  managerIds(businessId: string): Promise<string[]>
  insertNotifications(rows: { user_id: string; type: string; title: string; message: string; link: string }[]): Promise<void>
}

export async function recordCompletion(db: CoreDb, a: {
  person: Person; siteId: string; template: Template; items: TemplateItem[]; answers: Answer[]; source: 'whatsapp' | 'telegram'; now: Date
}) {
  const { id: completionId } = await db.insertCompletion({
    template_id: a.template.id, business_id: a.person.business_id, site_id: a.siteId,
    completed_by: a.person.profile_id, completed_at: a.now.toISOString(), source: a.source,
  })
  const inserted = await db.insertResponses(a.answers.map((x) => ({
    completion_id: completionId, item_id: x.item_id, value: x.value, notes: null, flagged: x.flagged,
    corrective_status: x.flagged ? 'needed' as const : null,
  })))
  const byItem = new Map(a.items.map((i) => [i.id, i]))
  const flagged = a.answers.filter((x) => x.flagged).map((x) => ({
    responseId: inserted.find((r) => r.item_id === x.item_id)!.id, item: byItem.get(x.item_id)!, value: x.value,
  }))
  if (flagged.length) {
    const managers = await db.managerIds(a.person.business_id)
    await db.insertNotifications(flagged.flatMap((f) => managers.map((user_id) => ({
      user_id, type: 'checklist', title: 'Flagged item', message: `"${f.item.name}" in ${a.template.name} is out of range`, link: '/checklists',
    }))))
  }
  return { completionId, flagged }
}
