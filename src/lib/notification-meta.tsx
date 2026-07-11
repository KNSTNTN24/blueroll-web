import { AlertTriangle, ClipboardCheck, FileText, CircleCheck, Truck, User, ChefHat, Users } from 'lucide-react'
import type { ComponentType } from 'react'

export interface NotifRow {
  id: string
  type: string
  title: string
  message: string | null
  read: boolean
  link: string | null
  created_at: string
}

export interface NotifMeta { bg: string; fg: string; Icon: ComponentType<{ className?: string; strokeWidth?: number }>; action?: string; group: 'incident' | 'team' | 'other' }

const INCIDENT: NotifMeta = { bg: '#fbf1e1', fg: '#b07d1e', Icon: AlertTriangle, action: 'View incident', group: 'incident' }
const RESOLVED: NotifMeta = { bg: '#e9f2ec', fg: '#1f7a52', Icon: CircleCheck, action: 'View incident', group: 'incident' }
const TASK: NotifMeta = { bg: '#fbf1e1', fg: '#b07d1e', Icon: ClipboardCheck, action: 'Open task', group: 'other' }
const DOC: NotifMeta = { bg: '#fbf1e1', fg: '#b07d1e', Icon: FileText, action: 'View document', group: 'other' }
const DELIVERY: NotifMeta = { bg: '#eef2f6', fg: '#4e6e81', Icon: Truck, group: 'other' }
const RECIPE: NotifMeta = { bg: '#f1f0f4', fg: '#6b6580', Icon: ChefHat, action: 'View recipe', group: 'other' }
const CHECKIN: NotifMeta = { bg: '#f1f2f4', fg: '#6b7280', Icon: User, group: 'team' }
const TEAM: NotifMeta = { bg: '#f1f2f4', fg: '#6b7280', Icon: Users, group: 'team' }

/** Map a stored notification (type + title) to its icon-tile colour + icon. */
export function notifMeta(type: string, title: string | null): NotifMeta {
  const t = (type || '').toLowerCase()
  const resolved = /resolv|closed|signed off/i.test(title || '')
  if (t === 'incident') return resolved ? RESOLVED : INCIDENT
  if (t === 'checklist' || t === 'task' || t === 'checklist_missed') return TASK
  if (t === 'document' || t === 'doc') return DOC
  if (t === 'delivery') return DELIVERY
  if (t === 'recipe') return RECIPE
  if (t === 'team') return TEAM
  return CHECKIN
}
