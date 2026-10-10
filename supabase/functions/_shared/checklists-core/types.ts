export type ItemType = 'tick' | 'temperature' | 'text' | 'yes_no' | 'photo' | 'initials'
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'four_weekly' | 'custom'
export interface TemplateItem {
  id: string; name: string; item_type: ItemType; required: boolean
  min_value: number | null; max_value: number | null; unit: string | null; sort_order: number
}
export interface Template {
  id: string; business_id: string; site_id: string | null; name: string; frequency: Frequency
  deadline_time: string | null; multi_per_day: boolean; min_per_day: number | null
  assigned_roles: string[]; assigned_role_ids: string[]; active: boolean
}
export interface Person { profile_id: string; business_id: string; full_name: string; role: string; role_id: string | null }
export interface CompletionLite { template_id: string; site_id: string | null; completed_at: string }
export interface DueChecklist { template: Template; site_id: string; deadline_utc: string | null; period_key: string; overdue: boolean }
export interface Answer { item_id: string; value: string; flagged: boolean }
