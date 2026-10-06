import type { SectionId } from '@/lib/haccp-pack/methods'

export type VenueType = 'restaurant' | 'coffee_shop' | 'takeaway' | 'bakery'
export const EQUIPMENT_KINDS = ['fridge', 'freezer', 'display_chiller', 'blast_chiller', 'dishwasher', 'probe', 'hot_hold', 'other'] as const
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]
export interface Equipment { kind: EquipmentKind; label: string }
export type AnswerValue = boolean | string | string[] | Equipment[]
export type Answers = Record<string, AnswerValue>

export type Cond =
  | { always: true }
  | { q: string; eq: boolean | string }
  | { q: string; has: string }
  | { equipment: EquipmentKind[] }
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }

export interface Option { value: string; label: string }
export type AnswerSpec =
  | { kind: 'yes_no' }
  | { kind: 'single'; options: Option[] }
  | { kind: 'multi'; options: Option[] }
  | { kind: 'equipment_list' }

export interface Question {
  id: string
  text: string
  why: string
  section: SectionId
  answer: AnswerSpec
  showIf?: Cond
  defaultsByType?: Partial<Record<VenueType, AnswerValue>>
}

export type ItemType = 'tick' | 'temperature' | 'text' | 'yes_no' | 'photo' | 'initials'
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'four_weekly' | 'custom'
export type Tier = 'owner' | 'manager' | 'chef' | 'kitchen_staff' | 'front_of_house'
export type ChecklistSection = SectionId | 'temperature' | 'probes'

export interface LibItem {
  name: string
  item_type: ItemType
  required: boolean
  min_value?: number
  max_value?: number
  unit?: string
  description?: string
}
export interface Ctx { answers: Answers; scotland: boolean }
export interface LibChecklist {
  key: string
  name: string
  description: string
  sfbb_section: ChecklistSection
  frequency: Frequency
  deadline_time?: string
  assigned_roles: Tier[]
  includeIf: Cond
  reason: string
  items: (ctx: Ctx) => LibItem[]
}

export interface PackData {
  toggles: Record<string, boolean>
  texts: Record<string, string>
  files: Record<string, string>
  selects: Record<string, string>
  overrides: Record<string, boolean>
  sources?: Record<string, 'questionnaire'>
}
export type PackValue = boolean | string
export interface FieldRule { fieldId: string; value: (ctx: Ctx) => PackValue | undefined }

export interface DraftChecklist {
  key: string; name: string; description: string; sfbb_section: ChecklistSection
  frequency: Frequency; deadline_time: string | null; assigned_roles: Tier[]
  items: LibItem[]; reason: string
  /** Name of an existing non-library checklist that already covers this; such checklists start unselected. */
  similarTo?: string
}
export interface DraftItemAdd { templateId: string; key: string; templateName: string; item: LibItem }
export type FieldStatus = 'new' | 'kept' | 'manual'
export interface DraftField {
  fieldId: string; methodId: string; label: string; type: 'toggle' | 'text' | 'select'
  value: PackValue; status: FieldStatus; current?: PackValue
}
export interface ExistingTemplate { id: string; library_key: string; name: string; itemNames: string[] }
/** A checklist without a library_key (e.g. the onboarding defaults). */
export interface OtherTemplate { id: string; name: string }
export interface ExistingState {
  templates: ExistingTemplate[]; pack: PackData | null; packUpdatedAt: string | null
  others?: OtherTemplate[]
}
export interface Draft {
  checklists: DraftChecklist[]
  existing: { key: string; name: string }[]
  itemAdds: DraftItemAdd[]
  fields: DraftField[]
  notes: string[]
}
