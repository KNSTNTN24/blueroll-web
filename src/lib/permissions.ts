import { SquareCheck, Soup, Shield, FileText, Users, type LucideIcon } from 'lucide-react'
import type { UserRole } from './constants'

/**
 * The 14 capabilities a role can grant.
 *
 * Stored verbatim in `roles.capabilities` (text[]). Ordering here is the order
 * the drawer renders them in, so keep it aligned with CAP_GROUPS.
 */
export const CAPS = [
  'complete_checklists', 'view_reports',
  'manage_recipes',
  'manage_checklists', 'sign_off', 'manage_suppliers', 'manage_incidents', 'manage_deliveries',
  'manage_documents', 'view_documents',
  'manage_team', 'manage_roles', 'manage_sites', 'manage_billing',
] as const

export type Cap = (typeof CAPS)[number]

export const CAP_LABEL: Record<Cap, string> = {
  complete_checklists: 'Complete checklists',
  view_reports: 'View reports',
  manage_recipes: 'Manage recipes & menu',
  manage_checklists: 'Manage checklist templates',
  sign_off: 'Sign off completions',
  manage_suppliers: 'Manage suppliers',
  manage_incidents: 'Manage incidents',
  manage_deliveries: 'Manage deliveries',
  manage_documents: 'Add/edit documents',
  view_documents: 'View documents',
  manage_team: 'Manage team & invites',
  manage_roles: 'Manage roles',
  manage_sites: 'Manage sites',
  manage_billing: 'Manage billing',
}

export const CAP_DESC: Record<Cap, string> = {
  complete_checklists: 'Open and complete daily checks',
  view_reports: 'See completion history and exports',
  manage_recipes: 'Create and edit recipes and the menu',
  manage_checklists: 'Build and change checklist templates',
  sign_off: 'Approve and sign off completed checks',
  manage_suppliers: 'Add and manage suppliers',
  manage_incidents: 'Log and resolve incidents',
  manage_deliveries: 'Record and check deliveries',
  manage_documents: 'Upload and edit documents',
  view_documents: 'View documents only',
  manage_team: 'Invite people and manage members',
  manage_roles: 'Create and edit roles',
  manage_sites: 'Add and manage sites',
  manage_billing: 'Manage plan, payment and invoices',
}

export const CAP_GROUPS: { name: string; icon: LucideIcon; caps: Cap[] }[] = [
  { name: 'Daily work', icon: SquareCheck, caps: ['complete_checklists', 'view_reports'] },
  { name: 'Kitchen', icon: Soup, caps: ['manage_recipes'] },
  { name: 'Compliance', icon: Shield, caps: ['manage_checklists', 'sign_off', 'manage_suppliers', 'manage_incidents', 'manage_deliveries'] },
  { name: 'Documents', icon: FileText, caps: ['manage_documents', 'view_documents'] },
  { name: 'People & settings', icon: Users, caps: ['manage_team', 'manage_roles', 'manage_sites', 'manage_billing'] },
]

/**
 * Capability set each preset ships with.
 *
 * These MUST mirror the seed_business_roles() trigger, which is what actually
 * seeds roles.capabilities per business — and those rows are enforced live by
 * has_capability() across the RLS policies. Diverging here hands users a
 * preset that silently grants or removes real access.
 */
const BASE_CAPS: Cap[] = ['complete_checklists', 'view_reports', 'manage_incidents', 'manage_deliveries']

export const PRESET_CAPS: Record<UserRole, Cap[]> = {
  owner: [...CAPS],
  manager: [...BASE_CAPS, 'manage_checklists', 'sign_off', 'manage_recipes', 'manage_documents', 'manage_suppliers', 'manage_team'],
  chef: [...BASE_CAPS, 'manage_recipes'],
  front_of_house: [...BASE_CAPS],
  kitchen_staff: [...BASE_CAPS],
}

export const PRESET_ORDER: UserRole[] = ['owner', 'manager', 'chef', 'front_of_house', 'kitchen_staff']

type Tint = { ink: string; bg: string }

const PRESET_TINT: Record<UserRole, Tint> = {
  owner: { ink: '#1f7a52', bg: '#e9f6ef' },
  manager: { ink: '#3f6bc4', bg: '#e4edfb' },
  chef: { ink: '#b07d1e', bg: '#fbf3e2' },
  front_of_house: { ink: '#6a63d6', bg: '#eeeefb' },
  kitchen_staff: { ink: '#5c6472', bg: '#eef0f2' },
}

/** Cycled for custom roles, which carry no colour of their own in the DB. */
const CUSTOM_PALETTE: Tint[] = [
  { ink: '#2b8f86', bg: '#e0f2ef' },
  { ink: '#c25a8a', bg: '#fbe9f1' },
  { ink: '#d97706', bg: '#fdefdc' },
  { ink: '#3f6bc4', bg: '#e4edfb' },
  { ink: '#6a63d6', bg: '#eeeefb' },
]

/**
 * Presets get their fixed brand tint; custom roles take a palette slot by
 * position, so a role keeps the same colour as long as the list order holds.
 */
export function roleTint(role: { base_tier: string; is_system: boolean }, customIndex: number): Tint {
  if (role.is_system) return PRESET_TINT[role.base_tier as UserRole] ?? PRESET_TINT.kitchen_staff
  return CUSTOM_PALETTE[customIndex % CUSTOM_PALETTE.length]
}

export const monogram = (name: string) => name.trim().slice(0, 2).toUpperCase()

/** One-line "what this role can do" for the role card. */
export function capSummary(caps: string[]): string {
  const on = CAPS.filter((c) => caps.includes(c))
  if (on.length >= CAPS.length) return 'Full access — everything'
  if (on.length === 0) return 'No permissions yet'
  const names = on.map((c) => CAP_LABEL[c])
  return names.slice(0, 3).join(' · ') + (names.length > 3 ? `  +${names.length - 3} more` : '')
}
