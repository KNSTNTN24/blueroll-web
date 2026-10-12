import type { SectionId } from '@/lib/haccp-pack/methods'
import type { AutoDataSources } from '@/lib/haccp-pack/auto-data'

export type DayStatus = 'ok' | 'flagged' | 'corrected' | 'missed' | 'none'
export interface PackData {
  toggles: Record<string, boolean>; texts: Record<string, string>; files: Record<string, string>
  selects: Record<string, string>; overrides: Record<string, boolean>; sources: Record<string, 'questionnaire'>
}
export interface TemplateProof {
  templateId: string; name: string; libraryKey: string | null; sfbbSection: string | null; frequency: string
  days: DayStatus[]            // length 28, oldest first, index 27 = yesterday
  completions: number; flagged: number; corrected: number; readings: number
  initials: string[]; lastCompletedAt: string | null
}
export interface DeliveryProof { count: number; outOfRange: number; days: DayStatus[] }
export interface CorrectiveEntry { at: string; template: string; item: string; value: string | null; notes: string | null; status: 'needed' | 'done' | null; by: string | null }
export interface PlanBundle {
  generatedAt: string; periodStart: string; periodEnd: string   // YYYY-MM-DD site-local, inclusive
  business: { id: string; name: string; address: string | null; postCode: string | null; fsaRating: string | null; autoFill: boolean; lastReviewedAt: string | null }
  site: { id: string; name: string; address: string | null; postcode: string | null; fsaRating: string | null; timezone: string } | null
  pack: { data: PackData; updatedAt: string | null }
  signoff: { signedByName: string | null; signedAt: string } | null
  sources: AutoDataSources
  proof: { templates: TemplateProof[]; deliveries: DeliveryProof; corrective: CorrectiveEntry[]; lastReview: { at: string; by: string | null } | null }
  people: { operator: string | null; siteManager: string | null }
  share: { kind: 'inspector' | 'pdf'; expiresAt: string } | null
  viewer: { canManage: boolean; userId: string } | null
}
export type InfographicKey = 'tempScale' | 'cookCombos' | 'panToPass' | 'twoStageClean' | 'cleaningFrequency' | 'allergenMatrix'
export interface MethodProof { title: string; days: DayStatus[]; stats: { value: string; label: string; tone: 'default' | 'amber' }[]; sourceNames: string[] }
export interface PlanAnswer { label: string; value: string; autoLabel: string | null }
export interface PlanMethod {
  id: string; ref: string; name: string; section: SectionId; sectionName: string
  safetyPoint: string; why: string; infographic: InfographicKey[]
  inPlace: number; toggleTotal: number; status: 'in_place' | 'partial' | 'open'
  doList: string[]; answers: PlanAnswer[]; attachments: { title: string }[]
  open: { ref: string; label: string }[]; proof: MethodProof | null
}
export interface PlanSection { id: SectionId; num: number; name: string; filled: number; total: number; pct: number; methods: PlanMethod[] }
export interface PlanDoc {
  businessName: string; siteName: string | null; address: string | null; fsaRating: string | null
  generatedAt: string; periodStart: string; periodEnd: string
  filled: number; total: number; pct: number; inspectionReady: boolean
  /** The menu has at least one active dish with allergens on this site — the matrix is built from it. */
  menuHasAllergens: boolean
  sections: PlanSection[]
  stats: { value: string; label: string; sub: string; tone: 'default' | 'amber' }[]
  people: { role: string; name: string }[]
  openPoints: { ref: string; method: string; label: string }[]
  corrective: CorrectiveEntry[]
  review: { lastAt: string | null; lastBy: string | null; nextDue: string | null; overdue: boolean }
  signoff: { name: string; at: string; editedAfter: boolean } | null
  dishes: { name: string; allergens: string[]; mayContain: string[] }[]
  cleaningFrequency: { label: string; count: number; items: string[] }[]
  footerLabel: string; fileName: string
}
