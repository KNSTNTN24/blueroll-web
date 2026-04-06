import { supabase } from '@/lib/supabase'

async function getManagerIds(businessId: string): Promise<string[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('business_id', businessId)
    .in('role', ['owner', 'manager'])
  return (data ?? []).map((p: { id: string }) => p.id)
}

async function getRoleIds(businessId: string, roles: string[]): Promise<string[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('business_id', businessId)
    .in('role', roles)
  return (data ?? []).map((p: { id: string }) => p.id)
}

async function notify(userIds: string[], type: string, title: string, message: string, link?: string) {
  if (userIds.length === 0) return
  const rows = userIds.map((uid) => ({ user_id: uid, type, title, message, link }))
  await supabase.from('notifications').insert(rows)
}

export async function notifyCheckIn(businessId: string, staffName: string) {
  const ids = await getManagerIds(businessId)
  await notify(ids, 'checkin', 'Staff checked in', `${staffName} has checked in`, '/dashboard')
}

export async function notifyCheckOut(businessId: string, staffName: string) {
  const ids = await getManagerIds(businessId)
  await notify(ids, 'checkin', 'Staff checked out', `${staffName} has checked out`, '/dashboard')
}

export async function notifyNewIncident(businessId: string, description: string) {
  const ids = await getManagerIds(businessId)
  await notify(ids, 'incident', 'New incident reported', description, '/incidents')
}

export async function notifyIncidentResolved(userId: string, description: string) {
  await notify([userId], 'incident', 'Incident resolved', description, '/incidents')
}

export async function notifyOverdueChecklist(businessId: string, checklistName: string, roles: string[]) {
  const managerIds = await getManagerIds(businessId)
  const roleIds = await getRoleIds(businessId, roles)
  const allIds = [...new Set([...managerIds, ...roleIds])]
  await notify(allIds, 'checklist', 'Overdue checklist', `"${checklistName}" has not been completed`, '/checklists')
}

export async function notifyFlaggedItem(businessId: string, checklistName: string, itemName: string) {
  const ids = await getManagerIds(businessId)
  await notify(ids, 'checklist', 'Flagged item', `"${itemName}" in ${checklistName} is out of range`, '/checklists')
}

export async function notifySignOffRequired(businessId: string, checklistName: string, supervisorRole: string) {
  const ids = await getRoleIds(businessId, [supervisorRole])
  await notify(ids, 'checklist', 'Sign-off required', `"${checklistName}" needs your sign-off`, '/checklists')
}

export async function notifyExpiringDocument(businessId: string, docTitle: string, daysLeft: number) {
  const ids = await getManagerIds(businessId)
  const msg = daysLeft <= 0 ? `"${docTitle}" has expired` : `"${docTitle}" expires in ${daysLeft} days`
  await notify(ids, 'document', 'Document expiring', msg, '/documents')
}

export async function notifyNewMember(businessId: string, memberName: string) {
  const ids = await getManagerIds(businessId)
  await notify(ids, 'team', 'New team member', `${memberName} has joined the team`, '/team')
}

export async function notifyHACCPReviewOverdue(businessId: string) {
  const ids = await getManagerIds(businessId)
  await notify(ids, 'haccp', 'HACCP review overdue', 'Your 4-weekly HACCP Pack review is overdue', '/haccp-pack')
}
