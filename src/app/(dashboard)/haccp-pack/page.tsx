'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { HACCP_SECTIONS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Download, ChevronDown, FileText, X, Eye, Link2 } from 'lucide-react'
import { DocumentPickerModal, type PickedDocument } from '@/components/shared/document-picker-modal'
import { SiteSignoff } from './site-signoff'
import { AllSitesDashboard } from './all-sites-dashboard'

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

type FieldType = 'toggle' | 'text' | 'file' | 'select'
type SectionId = 'cross' | 'cleaning' | 'chilling' | 'cooking' | 'management'

interface HaccpField {
  id: string
  label: string
  type: FieldType
  options?: string[] // for select
  autoSource?: string // description of auto-fill source
}

interface HaccpMethod {
  id: string
  name: string
  section: SectionId
  fields: HaccpField[]
}

interface HaccpPackRow {
  id?: string
  business_id: string
  toggles: Record<string, boolean>
  texts: Record<string, string>
  files: Record<string, string>
  selects: Record<string, string>
  overrides: Record<string, boolean>
  updated_at?: string
}

// ═══════════════════════════════════════════════════════════════
// XP constants
// ═══════════════════════════════════════════════════════════════

const XP_MAP: Record<FieldType, number> = { toggle: 10, text: 20, file: 50, select: 20 }

// ═══════════════════════════════════════════════════════════════
// All 26 HACCP methods with their fields
// ═══════════════════════════════════════════════════════════════

const HACCP_METHODS: HaccpMethod[] = [
  // ── Cross-Contamination (6 methods) ──
  {
    id: 'personal_hygiene', name: 'Personal Hygiene', section: 'cross',
    fields: [
      { id: 'ph_uniform', label: 'Staff wear clean uniform / protective clothing', type: 'toggle' },
      { id: 'ph_hair', label: 'Hair tied back and covered where required', type: 'toggle' },
      { id: 'ph_jewellery', label: 'No jewellery except plain wedding band', type: 'toggle' },
      { id: 'ph_nails', label: 'Nails are short, clean and free of polish', type: 'toggle' },
      { id: 'ph_illness', label: 'Staff report illness / sickness / diarrhoea to manager', type: 'toggle' },
      { id: 'ph_cuts', label: 'Cuts and sores covered with blue waterproof plaster', type: 'toggle' },
      { id: 'ph_changing', label: 'Describe your staff changing and locker arrangements', type: 'text' },
      { id: 'ph_clothing', label: 'Describe how uniforms / protective clothing are provided', type: 'text' },
    ],
  },
  {
    id: 'cloths', name: 'Cloths', section: 'cross',
    fields: [
      { id: 'cl_single_use', label: 'Single-use cloths or paper towels for cleaning', type: 'toggle' },
      { id: 'cl_colour_coded', label: 'Colour-coded cloths in use (red, blue, green, yellow)', type: 'toggle' },
      { id: 'cl_laundry', label: 'Reusable cloths washed at 90\u00b0C or above', type: 'toggle' },
      { id: 'cl_stored', label: 'Cloths stored in sanitiser solution between uses', type: 'toggle' },
      { id: 'cl_method', label: 'Describe your cloth management system', type: 'text' },
    ],
  },
  {
    id: 'separating_foods', name: 'Separating Foods', section: 'cross',
    fields: [
      { id: 'sf_raw_separate', label: 'Raw and ready-to-eat foods stored separately', type: 'toggle' },
      { id: 'sf_colour_boards', label: 'Colour-coded chopping boards used', type: 'toggle' },
      { id: 'sf_equipment', label: 'Separate utensils for raw and cooked foods', type: 'toggle' },
      { id: 'sf_raw_products', label: 'List raw products handled (meat, poultry, fish, etc.)', type: 'text', autoSource: 'Recipes: raw meat/fish/poultry ingredients' },
      { id: 'sf_delivery_schedule', label: 'Delivery schedule for raw products', type: 'text', autoSource: 'Suppliers: delivery_days' },
      { id: 'sf_storage', label: 'Describe how raw and RTE foods are separated in storage', type: 'text' },
    ],
  },
  {
    id: 'food_allergies', name: 'Food Allergies', section: 'cross',
    fields: [
      { id: 'fa_aware', label: 'All staff trained on 14 EU allergens', type: 'toggle' },
      { id: 'fa_matrix', label: 'Allergen matrix / chart available and up to date', type: 'toggle' },
      { id: 'fa_communication', label: 'System for customers to declare allergies', type: 'toggle' },
      { id: 'fa_allergens_list', label: 'List allergens present in your menu items', type: 'text', autoSource: 'Recipes: allergens from ingredients' },
      { id: 'fa_procedure', label: 'Describe your allergen management procedure', type: 'text' },
      { id: 'fa_matrix_file', label: 'Upload allergen matrix document', type: 'file' },
    ],
  },
  {
    id: 'contamination_prevention', name: 'Contamination Prevention', section: 'cross',
    fields: [
      { id: 'cp_chemicals', label: 'Chemicals stored separately from food', type: 'toggle' },
      { id: 'cp_glass', label: 'Glass and brittle items policy in place', type: 'toggle' },
      { id: 'cp_physical', label: 'Steps taken to prevent physical contamination', type: 'toggle' },
      { id: 'cp_describe', label: 'Describe physical contamination prevention measures', type: 'text' },
      { id: 'cp_chemicals_desc', label: 'Describe chemical storage arrangements', type: 'text' },
    ],
  },
  {
    id: 'pest_control', name: 'Pest Control', section: 'cross',
    fields: [
      { id: 'pc_contract', label: 'Pest control contract in place', type: 'toggle' },
      { id: 'pc_proofing', label: 'Building proofed against pest entry', type: 'toggle' },
      { id: 'pc_company', label: 'Pest control company and visit frequency', type: 'text', autoSource: 'Documents: pest control contract' },
      { id: 'pc_measures', label: 'Describe pest prevention measures in place', type: 'text' },
      { id: 'pc_contract_file', label: 'Upload pest control contract', type: 'file', autoSource: 'Documents: category=contract' },
    ],
  },

  // ── Cleaning (4 methods) ──
  {
    id: 'handwashing', name: 'Handwashing', section: 'cleaning',
    fields: [
      { id: 'hw_basin', label: 'Dedicated handwash basin available', type: 'toggle' },
      { id: 'hw_soap', label: 'Antibacterial soap provided', type: 'toggle' },
      { id: 'hw_towels', label: 'Disposable paper towels or air dryer available', type: 'toggle' },
      { id: 'hw_signs', label: 'Handwashing signs displayed', type: 'toggle' },
      { id: 'hw_when', label: 'Staff know when to wash hands (before handling food, after breaks, etc.)', type: 'toggle' },
    ],
  },
  {
    id: 'cleaning_effectively', name: 'Cleaning Effectively', section: 'cleaning',
    fields: [
      { id: 'ce_2stage', label: 'Two-stage clean-and-sanitise method used', type: 'toggle' },
      { id: 'ce_sanitiser', label: 'Correct sanitiser concentration used', type: 'toggle' },
      { id: 'ce_contact', label: 'Contact time for sanitiser followed', type: 'toggle' },
      { id: 'ce_surfaces', label: 'All food contact surfaces cleaned between tasks', type: 'toggle' },
    ],
  },
  {
    id: 'clear_clean', name: 'Clear & Clean As You Go', section: 'cleaning',
    fields: [
      { id: 'cc_clear', label: 'Work surfaces cleared immediately after use', type: 'toggle' },
      { id: 'cc_spills', label: 'Spills cleaned up immediately', type: 'toggle' },
      { id: 'cc_waste', label: 'Waste disposed of regularly', type: 'toggle' },
      { id: 'cc_method', label: 'Describe your clean-as-you-go procedure', type: 'text' },
    ],
  },
  {
    id: 'cleaning_schedule', name: 'Cleaning Schedule', section: 'cleaning',
    fields: [
      { id: 'cs_schedule', label: 'Cleaning schedule in place and followed', type: 'toggle' },
      { id: 'cs_file', label: 'Upload cleaning schedule document', type: 'file', autoSource: 'Checklists: cleaning template + Documents: category=policy' },
    ],
  },

  // ── Chilling (4 methods) ──
  {
    id: 'chilled_storage', name: 'Chilled Storage', section: 'chilling',
    fields: [
      { id: 'st_temp', label: 'Fridge temperature checked daily (0\u20135\u00b0C)', type: 'toggle' },
      { id: 'st_records', label: 'Temperature records maintained', type: 'toggle' },
      { id: 'st_rotation', label: 'Stock rotation (FIFO) followed', type: 'toggle' },
      { id: 'st_labelled', label: 'All items labelled with date of preparation/opening', type: 'toggle' },
      { id: 'st_method', label: 'Describe temperature monitoring method', type: 'text', autoSource: 'Checklists: temperature checking template' },
      { id: 'st_check_method', label: 'How fridges are checked', type: 'select', options: ['Digital thermometer', 'Fridge display', 'Dial thermometer', 'Data logger'], autoSource: 'Checklists: temperature probe type' },
    ],
  },
  {
    id: 'chilling_down', name: 'Chilling Down Hot Food', section: 'chilling',
    fields: [
      { id: 'cd_90min', label: 'Hot food cooled to room temp within 90 minutes', type: 'toggle' },
      { id: 'cd_fridge', label: 'Then refrigerated immediately', type: 'toggle' },
      { id: 'cd_portions', label: 'Large batches divided into smaller portions', type: 'toggle' },
      { id: 'cd_method', label: 'Describe chilling methods used for hot food', type: 'text', autoSource: 'Recipes: chilling_method' },
    ],
  },
  {
    id: 'defrosting', name: 'Defrosting', section: 'chilling',
    fields: [
      { id: 'df_fridge', label: 'Food defrosted in fridge (preferred method)', type: 'toggle' },
      { id: 'df_microwave', label: 'Microwave defrost used for immediate cooking', type: 'toggle' },
      { id: 'df_not_refreeze', label: 'Defrosted food not refrozen', type: 'toggle' },
      { id: 'df_method', label: 'Describe defrosting procedures for different products', type: 'text', autoSource: 'Recipes: defrosting_instructions' },
      { id: 'df_products', label: 'List products that require defrosting', type: 'text', autoSource: 'Recipes: defrosting_instructions' },
    ],
  },
  {
    id: 'freezing', name: 'Freezing', section: 'chilling',
    fields: [
      { id: 'fz_temp', label: 'Freezer operating at -18\u00b0C or below', type: 'toggle' },
      { id: 'fz_labelled', label: 'Frozen items labelled with date of freezing', type: 'toggle' },
      { id: 'fz_suitable', label: 'Only suitable food items frozen', type: 'toggle' },
      { id: 'fz_method', label: 'Describe freezing procedures', type: 'text', autoSource: 'Recipes: freezing_instructions' },
    ],
  },

  // ── Cooking (6 methods) ──
  {
    id: 'cooking_safely', name: 'Cooking Safely', section: 'cooking',
    fields: [
      { id: 'ck_75c', label: 'Food cooked to 75\u00b0C core temperature', type: 'toggle' },
      { id: 'ck_probe', label: 'Probe thermometer used to check cooking temperatures', type: 'toggle' },
      { id: 'ck_visual', label: 'Visual checks: piping hot, steam, no pink (where applicable)', type: 'toggle' },
      { id: 'ck_dishes', label: 'List main dishes and cooking methods', type: 'text', autoSource: 'Recipes: cooking_method + cooking_temp' },
    ],
  },
  {
    id: 'extra_care', name: 'Extra Care Foods', section: 'cooking',
    fields: [
      { id: 'ec_eggs', label: 'Eggs: cooked until yolk and white are solid (or pasteurised)', type: 'toggle' },
      { id: 'ec_rice', label: 'Rice: served immediately or cooled within 1 hour', type: 'toggle' },
      { id: 'ec_pulses', label: 'Pulses: soaked and boiled properly', type: 'toggle' },
      { id: 'ec_shellfish', label: 'Shellfish: from reputable supplier, cooked thoroughly', type: 'toggle' },
      { id: 'ec_items', label: 'List extra care food items on your menu', type: 'text', autoSource: 'Recipes: extra_care_flags' },
      { id: 'ec_procedure', label: 'Describe extra care handling procedures', type: 'text' },
    ],
  },
  {
    id: 'reheating', name: 'Reheating', section: 'cooking',
    fields: [
      { id: 'rh_75c', label: 'Food reheated to 75\u00b0C core temperature', type: 'toggle' },
      { id: 'rh_once', label: 'Food only reheated once', type: 'toggle' },
      { id: 'rh_check', label: 'Temperature checked with probe thermometer', type: 'toggle' },
      { id: 'rh_items', label: 'List items that are reheated and how', type: 'text', autoSource: 'Recipes: reheating_instructions' },
      { id: 'rh_procedure', label: 'Describe your reheating procedure', type: 'text' },
    ],
  },
  {
    id: 'menu_checks', name: 'Menu Checks', section: 'cooking',
    fields: [
      { id: 'mc_items', label: 'List key menu items and their cooking verification methods', type: 'text', autoSource: 'Recipes: cooking method + verification' },
      { id: 'mc_new_dishes', label: 'Describe process for introducing new dishes to the menu', type: 'text' },
    ],
  },
  {
    id: 'hot_holding', name: 'Hot Holding', section: 'cooking',
    fields: [
      { id: 'hh_63c', label: 'Hot food held at 63\u00b0C or above', type: 'toggle' },
      { id: 'hh_check', label: 'Temperature of hot-held food checked regularly', type: 'toggle' },
      { id: 'hh_2hr', label: 'Food not held hot for more than 2 hours', type: 'toggle' },
      { id: 'hh_items', label: 'List items that are hot-held and equipment used', type: 'text', autoSource: 'Recipes: hot_holding_required' },
    ],
  },
  {
    id: 'ready_to_eat', name: 'Ready-to-Eat', section: 'cooking',
    fields: [
      { id: 'rte_separate', label: 'Ready-to-eat food kept separate from raw', type: 'toggle' },
      { id: 'rte_utensils', label: 'Separate utensils used for RTE food', type: 'toggle' },
      { id: 'rte_stored', label: 'RTE food stored above raw in fridge', type: 'toggle' },
      { id: 'rte_items', label: 'List ready-to-eat products', type: 'text', autoSource: 'Recipes: ready-to-eat ingredients' },
    ],
  },

  // ── Management (6 methods) ──
  {
    id: 'opening_closing', name: 'Opening & Closing Checks', section: 'management',
    fields: [
      { id: 'oc_opening', label: 'Opening checks completed daily', type: 'toggle' },
      { id: 'oc_closing', label: 'Closing checks completed daily', type: 'toggle' },
      { id: 'oc_recorded', label: 'Checks recorded and signed off', type: 'toggle' },
      { id: 'oc_file', label: 'Upload opening / closing checklist', type: 'file', autoSource: 'Checklists: opening/closing templates' },
    ],
  },
  {
    id: 'suppliers', name: 'Suppliers', section: 'management',
    fields: [
      { id: 'sup_list', label: 'List your food suppliers and contact details', type: 'text', autoSource: 'Suppliers: name + contact' },
      { id: 'sup_approved', label: 'Describe how you ensure suppliers are reputable', type: 'text' },
      { id: 'sup_file', label: 'Upload supplier list or approved supplier document', type: 'file', autoSource: 'Suppliers table' },
    ],
  },
  {
    id: 'stock_control', name: 'Stock Control', section: 'management',
    fields: [
      { id: 'sc_fifo', label: 'First In, First Out (FIFO) stock rotation used', type: 'toggle' },
      { id: 'sc_dates', label: 'Use-by and best-before dates checked on delivery', type: 'toggle' },
      { id: 'sc_reject', label: 'Out-of-date stock removed and disposed of', type: 'toggle' },
      { id: 'sc_delivery', label: 'Delivery checks carried out (temperature, condition)', type: 'toggle' },
    ],
  },
  {
    id: 'training', name: 'Training', section: 'management',
    fields: [
      { id: 'tr_induction', label: 'All new staff receive food safety induction', type: 'toggle' },
      { id: 'tr_responsible', label: 'Named person responsible for food safety training', type: 'text', autoSource: 'Team: profiles with manager/owner role' },
      { id: 'tr_records', label: 'Describe training records and certificates held', type: 'text', autoSource: 'Documents: category=training' },
      { id: 'tr_file', label: 'Upload training records / certificates', type: 'file', autoSource: 'Documents: category=training' },
    ],
  },
  {
    id: 'temperature_probes', name: 'Temperature Probes', section: 'management',
    fields: [
      { id: 'tp_calibrated', label: 'Probe thermometer calibrated regularly', type: 'toggle' },
      { id: 'tp_sanitised', label: 'Probe cleaned and sanitised between uses', type: 'toggle' },
      { id: 'tp_boil_ice', label: 'Boiling water and ice used to check accuracy', type: 'toggle' },
      { id: 'tp_method', label: 'Describe probe calibration procedure and frequency', type: 'text', autoSource: 'Checklists: probe calibration template' },
    ],
  },
  {
    id: 'daily_diary', name: 'Daily Diary', section: 'management',
    fields: [
      { id: 'dd_kept', label: 'Daily diary maintained', type: 'toggle' },
      { id: 'dd_file', label: 'Upload daily diary template or sample', type: 'file', autoSource: 'Checklists: daily diary template' },
    ],
  },
]

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function getSectionMethods(sectionId: SectionId) {
  return HACCP_METHODS.filter((m) => m.section === sectionId)
}

function isFieldFilled(
  field: HaccpField,
  data: HaccpPackRow,
  autoData: Record<string, string>,
  autoFill: boolean,
): boolean {
  const fid = field.id
  switch (field.type) {
    case 'toggle':
      return data.toggles[fid] === true
    case 'text': {
      if (data.texts[fid] && data.texts[fid].trim().length > 0) return true
      if (autoFill && field.autoSource && autoData[fid] && !data.overrides[fid]) return true
      return false
    }
    case 'file':
      return !!data.files[fid]
    case 'select': {
      if (data.selects[fid]) return true
      if (autoFill && field.autoSource && autoData[fid] && !data.overrides[fid]) return true
      return false
    }
    default:
      return false
  }
}

function computeSectionProgress(
  sectionId: SectionId,
  data: HaccpPackRow,
  autoData: Record<string, string>,
  autoFill: boolean,
) {
  const methods = getSectionMethods(sectionId)
  let filled = 0
  let total = 0
  let xp = 0
  for (const method of methods) {
    for (const field of method.fields) {
      total++
      if (isFieldFilled(field, data, autoData, autoFill)) {
        filled++
        xp += XP_MAP[field.type]
      }
    }
  }
  return { filled, total, pct: total > 0 ? Math.round((filled / total) * 100) : 0, xp }
}

function computeTotalProgress(data: HaccpPackRow, autoData: Record<string, string>, autoFill: boolean) {
  let filled = 0
  let total = 0
  let xp = 0
  for (const method of HACCP_METHODS) {
    for (const field of method.fields) {
      total++
      if (isFieldFilled(field, data, autoData, autoFill)) {
        filled++
        xp += XP_MAP[field.type]
      }
    }
  }
  return { filled, total, pct: total > 0 ? Math.round((filled / total) * 100) : 0, xp }
}

const EMPTY_DATA: HaccpPackRow = {
  business_id: '',
  toggles: {},
  texts: {},
  files: {},
  selects: {},
  overrides: {},
}

// ═══════════════════════════════════════════════════════════════
// Main Page Component
// ═══════════════════════════════════════════════════════════════

export default function HaccpPackPage() {
  const { business, profile } = useAuthStore()
  const sites = useAuthStore((s) => s.sites)
  const currentSiteId = useAuthStore((s) => s.currentSiteId)
  // Scope "All sites" on a multi-site group → group dashboard instead of the pack.
  const isAllSites = sites.length > 1 && !currentSiteId
  const queryClient = useQueryClient()

  const [activeSection, setActiveSection] = useState<SectionId>('cross')
  const [expandedMethods, setExpandedMethods] = useState<Record<string, boolean>>({})
  const [tabsStuck, setTabsStuck] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const businessId = business?.id ?? ''
  const autoFillEnabled = business?.haccp_auto_fill ?? true

  // ── Fetch HACCP pack data ──
  const { data: packData } = useQuery({
    queryKey: ['haccp-pack', businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('haccp_pack_data')
        .select('*')
        .eq('business_id', businessId)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      if (!data) return { ...EMPTY_DATA, business_id: businessId }
      // DB stores {data: {toggles, texts, ...}} — unpack into flat HaccpPackRow
      const inner = data.data as any ?? {}
      return {
        id: data.id,
        business_id: data.business_id,
        toggles: inner.toggles ?? {},
        texts: inner.texts ?? {},
        files: inner.files ?? {},
        selects: inner.selects ?? {},
        overrides: inner.overrides ?? {},
        updated_at: data.updated_at,
      } as HaccpPackRow
    },
    enabled: !!businessId,
  })

  const localData = packData ?? { ...EMPTY_DATA, business_id: businessId }

  // ── Fetch auto-fill source data ──
  const { data: recipes } = useQuery({
    queryKey: ['haccp-recipes', businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipes')
        .select(
          `id, name, cooking_method, cooking_temp, extra_care_flags,
           reheating_instructions, hot_holding_required, chilling_method,
           freezing_instructions, defrosting_instructions, haccp_methods,
           recipe_ingredients(ingredient:ingredients(name, allergens))`,
        )
        .eq('business_id', businessId)
      if (error) console.error('[haccp-pack] recipes query error:', error)
      return data ?? []
    },
    enabled: !!businessId && autoFillEnabled,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  const { data: suppliersData } = useQuery({
    queryKey: ['haccp-suppliers', businessId],
    queryFn: async () => {
      const { data } = await supabase
        .from('suppliers')
        .select('id, name, contact_name, phone, email, delivery_days')
        .eq('business_id', businessId)
      return data ?? []
    },
    enabled: !!businessId && autoFillEnabled,
  })

  const { data: checklistTemplates } = useQuery({
    queryKey: ['haccp-checklists', businessId],
    queryFn: async () => {
      const { data } = await supabase
        .from('checklist_templates')
        .select('id, name, frequency, sfbb_section')
        .eq('business_id', businessId)
      return data ?? []
    },
    enabled: !!businessId && autoFillEnabled,
  })

  const { data: documents } = useQuery({
    queryKey: ['haccp-documents', businessId],
    queryFn: async () => {
      const { data } = await supabase
        .from('documents')
        .select('id, name, category, file_url')
        .eq('business_id', businessId)
      return data ?? []
    },
    enabled: !!businessId && autoFillEnabled,
  })

  const { data: teamProfiles } = useQuery({
    queryKey: ['haccp-team', businessId],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('business_id', businessId)
      return data ?? []
    },
    enabled: !!businessId && autoFillEnabled,
  })

  // ── Compute auto-fill values ──
  const autoData = useMemo<Record<string, string>>(() => {
    if (!autoFillEnabled) return {}
    const auto: Record<string, string> = {}

    // Recipes-based (driven by the haccp_methods multi-select on each recipe)
    if (recipes?.length) {
      // Helper: recipes that declared a given HACCP method
      const withMethod = (methodId: string) =>
        (recipes as any[]).filter((r) => Array.isArray(r.haccp_methods) && r.haccp_methods.includes(methodId))

      // Helper: format one recipe row with optional trailing detail
      const fmt = (r: any, detail?: string | null) =>
        detail ? `${r.name}: ${detail}` : r.name

      // Cooking Safely → ck_dishes
      const cooking = withMethod('cooking_safely')
      if (cooking.length) {
        auto['ck_dishes'] = cooking
          .map((r) => {
            const parts = [r.cooking_method, r.cooking_temp ? `${r.cooking_temp}°C` : null].filter(Boolean)
            return fmt(r, parts.length ? parts.join(' @ ') : null)
          })
          .join('\n')
      }

      // Reheating → rh_items
      const reheating = withMethod('reheating')
      if (reheating.length) {
        auto['rh_items'] = reheating.map((r) => fmt(r, r.reheating_instructions)).join('\n')
      }

      // Hot Holding → hh_items
      const hotHold = withMethod('hot_holding')
      if (hotHold.length) auto['hh_items'] = hotHold.map((r) => r.name).join(', ')

      // Chilling Down Hot Food → cd_method
      const chillingDown = withMethod('chilling_down')
      if (chillingDown.length) {
        auto['cd_method'] = chillingDown.map((r) => fmt(r, r.chilling_method)).join('\n')
      }

      // Freezing → fz_method
      const freezing = withMethod('freezing')
      if (freezing.length) {
        auto['fz_method'] = freezing.map((r) => fmt(r, r.freezing_instructions)).join('\n')
      }

      // Defrosting → df_method + df_products
      const defrosting = withMethod('defrosting')
      if (defrosting.length) {
        auto['df_method'] = defrosting.map((r) => fmt(r, r.defrosting_instructions)).join('\n')
        auto['df_products'] = defrosting.map((r) => r.name).join(', ')
      }

      // Extra Care Foods → ec_items
      const extraCare = withMethod('extra_care')
      if (extraCare.length) {
        auto['ec_items'] = extraCare
          .map((r) => {
            const flags = Array.isArray(r.extra_care_flags) ? r.extra_care_flags.join(', ') : r.extra_care_flags
            return fmt(r, flags || null)
          })
          .join('\n')
      }

      // Ready-to-Eat → rte_items
      const rte = withMethod('ready_to_eat')
      if (rte.length) auto['rte_items'] = rte.map((r) => r.name).join(', ')

      // Menu Checks → mc_items (all recipes that have any cooking-side method)
      const menuCooking = (recipes as any[]).filter(
        (r) =>
          Array.isArray(r.haccp_methods) &&
          r.haccp_methods.some((m: string) =>
            ['cooking_safely', 'reheating', 'hot_holding', 'extra_care'].includes(m),
          ),
      )
      if (menuCooking.length) {
        auto['mc_items'] = menuCooking
          .map((r) => {
            const parts = [r.cooking_method, r.cooking_temp ? `${r.cooking_temp}°C` : null].filter(Boolean)
            return parts.length ? `${r.name} — ${parts.join(' @ ')}` : r.name
          })
          .join('\n')
      }

      // ── Ingredient-driven fields ──
      // Keywords for raw meat / poultry / fish / offal. Lowercase substrings.
      const RAW_KEYWORDS = [
        'chicken', 'beef', 'pork', 'lamb', 'mutton', 'veal', 'turkey', 'duck', 'goose', 'rabbit', 'venison',
        'mince', 'sausage', 'bacon', 'ham', 'gammon', 'chorizo', 'steak', 'brisket', 'ribeye', 'sirloin',
        'liver', 'kidney', 'offal',
        'fish', 'salmon', 'tuna', 'cod', 'haddock', 'mackerel', 'trout', 'seabass', 'sea bass', 'anchov', 'sardine', 'plaice', 'pollock',
        'prawn', 'shrimp', 'lobster', 'crab', 'crayfish', 'langoustine',
        'mussel', 'oyster', 'clam', 'scallop', 'squid', 'octopus', 'cockle', 'whelk',
      ]
      // Allergens that always imply a raw protein product to handle as "raw"
      const SEAFOOD_ALLERGENS = new Set(['fish', 'crustaceans', 'molluscs'])

      const rawProducts = new Set<string>()
      const allergensPresent = new Set<string>()
      const recipeAllergenMap = new Map<string, Set<string>>()

      for (const r of recipes as any[]) {
        const ings: Array<{ name?: string; allergens?: string[] }> = (r.recipe_ingredients ?? [])
          .map((ri: any) => ri?.ingredient)
          .filter(Boolean)

        for (const ing of ings) {
          const name = (ing.name ?? '').trim()
          if (!name) continue
          const lower = name.toLowerCase()
          const ingAllergens: string[] = Array.isArray(ing.allergens) ? ing.allergens : []

          // Raw detection: by keyword OR by seafood allergen
          const isRaw =
            RAW_KEYWORDS.some((kw) => lower.includes(kw)) ||
            ingAllergens.some((a) => SEAFOOD_ALLERGENS.has(a))
          if (isRaw) rawProducts.add(name)

          // Collect allergens
          for (const a of ingAllergens) {
            allergensPresent.add(a)
            if (!recipeAllergenMap.has(r.name)) recipeAllergenMap.set(r.name, new Set())
            recipeAllergenMap.get(r.name)!.add(a)
          }
        }
      }

      if (rawProducts.size) {
        auto['sf_raw_products'] = Array.from(rawProducts).sort().join(', ')
      }

      if (allergensPresent.size) {
        const header = `Allergens present: ${Array.from(allergensPresent).sort().join(', ')}`
        const perRecipe = Array.from(recipeAllergenMap.entries())
          .map(([recipeName, set]) => `${recipeName}: ${Array.from(set).sort().join(', ')}`)
          .join('\n')
        auto['fa_allergens_list'] = perRecipe ? `${header}\n\n${perRecipe}` : header
      }
    }

    // Suppliers-based
    if (suppliersData?.length) {
      auto['sup_list'] = suppliersData.map((s: any) => `${s.name}${s.contact_name ? ` (${s.contact_name})` : ''}${s.phone ? ` \u2014 ${s.phone}` : ''}${s.email ? ` \u2014 ${s.email}` : ''}`).join('\n')

      const deliveryDays = suppliersData
        .filter((s: any) => s.delivery_days)
        .map((s: any) => `${s.name}: ${Array.isArray(s.delivery_days) ? s.delivery_days.join(', ') : s.delivery_days}`)
      if (deliveryDays.length) auto['sf_delivery_schedule'] = deliveryDays.join('\n')
    }

    // Documents-based
    if (documents?.length) {
      const pestDocs = documents.filter((d: any) => d.category === 'contract' || d.category === 'inspection')
      if (pestDocs.length) auto['pc_company'] = pestDocs.map((d: any) => d.name).join(', ')

      const trainingDocs = documents.filter((d: any) => d.category === 'training' || d.category === 'certificate')
      if (trainingDocs.length) auto['tr_records'] = trainingDocs.map((d: any) => d.name).join(', ')
    }

    // Team-based
    if (teamProfiles?.length) {
      const responsible = teamProfiles.filter((p: any) => p.role === 'owner' || p.role === 'manager')
      if (responsible.length) auto['tr_responsible'] = responsible.map((p: any) => `${p.full_name ?? 'Unnamed'} (${p.role})`).join(', ')
    }

    // Checklists-based
    if (checklistTemplates?.length) {
      const tempChecklist = checklistTemplates.find((c: any) => c.sfbb_section === 'temperature' || c.name?.toLowerCase().includes('temperature'))
      if (tempChecklist) auto['st_method'] = `Using checklist: ${tempChecklist.name} (${tempChecklist.frequency})`

      const probeChecklist = checklistTemplates.find((c: any) => c.sfbb_section === 'probes' || c.name?.toLowerCase().includes('probe') || c.name?.toLowerCase().includes('calibrat'))
      if (probeChecklist) auto['tp_method'] = `Using checklist: ${probeChecklist.name} (${probeChecklist.frequency})`
    }

    return auto
  }, [autoFillEnabled, recipes, suppliersData, documents, teamProfiles, checklistTemplates])

  // ── Save mutation ──
  const saveMutation = useMutation({
    mutationFn: async (newData: HaccpPackRow) => {
      const payload = {
        business_id: businessId,
        data: {
          toggles: newData.toggles,
          texts: newData.texts,
          files: newData.files,
          selects: newData.selects,
          overrides: newData.overrides,
        },
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase
        .from('haccp_pack_data')
        .upsert(payload, { onConflict: 'business_id' })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['haccp-pack', businessId] })
    },
    onError: () => {
      toast.error('Failed to save HACCP Pack data')
    },
  })

  const debouncedSave = useCallback(
    (newData: HaccpPackRow) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        saveMutation.mutate(newData)
      }, 800)
    },
    [saveMutation],
  )

  // ── Update helpers ──
  function updateField(fieldId: string, type: FieldType, value: any) {
    const updated = { ...localData }
    switch (type) {
      case 'toggle':
        updated.toggles = { ...updated.toggles, [fieldId]: value as boolean }
        break
      case 'text':
        updated.texts = { ...updated.texts, [fieldId]: value as string }
        updated.overrides = { ...updated.overrides, [fieldId]: true }
        break
      case 'file':
        updated.files = { ...updated.files, [fieldId]: value as string }
        break
      case 'select':
        updated.selects = { ...updated.selects, [fieldId]: value as string }
        updated.overrides = { ...updated.overrides, [fieldId]: true }
        break
    }
    queryClient.setQueryData(['haccp-pack', businessId], updated)
    debouncedSave(updated)
  }

  // ── Toggle auto-fill ──
  const toggleAutoFill = useMutation({
    mutationFn: async () => {
      const newVal = !autoFillEnabled
      const { error } = await supabase
        .from('businesses')
        .update({ haccp_auto_fill: newVal })
        .eq('id', businessId)
      if (error) throw error
      return newVal
    },
    onSuccess: (newVal) => {
      useAuthStore.getState().setBusiness({ ...business!, haccp_auto_fill: newVal })
      toast.success(newVal ? 'Auto-fill enabled' : 'Auto-fill disabled')
    },
  })

  // ── Section progress ──
  const sectionProgress = useMemo(() => {
    const result: Record<SectionId, { filled: number; total: number; pct: number; xp: number }> = {} as any
    for (const s of HACCP_SECTIONS) {
      result[s.id as SectionId] = computeSectionProgress(s.id as SectionId, localData, autoData, autoFillEnabled)
    }
    return result
  }, [localData, autoData, autoFillEnabled])

  const totalProgress = useMemo(
    () => computeTotalProgress(localData, autoData, autoFillEnabled),
    [localData, autoData, autoFillEnabled],
  )

  // ── 4-week review ──
  const reviewInfo = useMemo(() => {
    const lastReviewed = business?.haccp_last_reviewed_at
    if (!lastReviewed) return { overdue: true, label: 'Never reviewed', daysSince: null }
    const last = new Date(lastReviewed)
    const diff = Math.floor((Date.now() - last.getTime()) / (1000 * 60 * 60 * 24))
    const overdue = diff > 28
    return {
      overdue,
      label: overdue
        ? `Review overdue \u2014 due ${new Date(last.getTime() + 28 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
        : `Last reviewed: ${last.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      daysSince: diff,
    }
  }, [business?.haccp_last_reviewed_at])

  // ── Toggle method expand ──
  function toggleMethod(methodId: string) {
    setExpandedMethods((prev) => ({ ...prev, [methodId]: !prev[methodId] }))
  }

  const activeSectionInfo = HACCP_SECTIONS.find((s) => s.id === activeSection)!
  const activeMethods = getSectionMethods(activeSection)

  // ── Tab sliding indicator ──
  const moveIndicator = useCallback(() => {
    const tabs = tabsRef.current
    const ind = indicatorRef.current
    if (!tabs || !ind) return
    const active = tabs.querySelector<HTMLElement>('[data-tab][data-active="true"]')
    if (!active) return
    const tabsRect = tabs.getBoundingClientRect()
    const rect = active.getBoundingClientRect()
    ind.style.width = `${rect.width}px`
    ind.style.transform = `translateX(${rect.left - tabsRect.left - 4}px)`
  }, [])

  useLayoutEffect(() => {
    moveIndicator()
  }, [activeSection, moveIndicator])

  useEffect(() => {
    const handler = () => moveIndicator()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [moveIndicator])

  // ── Detect "stuck" state for sticky tabs ──
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => setTabsStuck(!entry.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  function handleExportPDF() {
    let html = `<!DOCTYPE html><html><head><title>${business?.name ?? 'Blueroll'} — HACCP Pack</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 11px; color: #1a1a1a; padding: 24px; }
      h1 { font-size: 20px; font-weight: 700; margin-bottom: 2px; }
      .subtitle { font-size: 11px; color: #6b7280; margin-bottom: 20px; }
      h2 { font-size: 14px; font-weight: 700; margin: 20px 0 8px; padding: 6px 10px; border-radius: 4px; color: white; }
      h3 { font-size: 12px; font-weight: 600; margin: 12px 0 6px; color: #1a1a1a; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
      .field { margin: 4px 0; padding: 3px 0; }
      .field-label { font-size: 10px; color: #6b7280; margin-bottom: 2px; }
      .field-value { font-size: 11px; }
      .check { color: #047857; font-weight: 600; }
      .uncheck { color: #d1d5db; }
      .text-val { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 3px; padding: 4px 6px; min-height: 20px; font-size: 10px; }
      .empty { color: #d1d5db; font-style: italic; font-size: 10px; }
      .section-summary { font-size: 10px; color: #6b7280; margin-bottom: 8px; }
      .footer { margin-top: 24px; font-size: 9px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 8px; }
      @media print { body { padding: 12px; } h2 { break-before: auto; } }
    </style></head><body>`

    html += `<h1>${business?.name ?? ''} — HACCP Pack</h1>`
    html += `<div class="subtitle">Safer Food, Better Business · Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>`

    for (const section of HACCP_SECTIONS) {
      const methods = getSectionMethods(section.id as SectionId)
      const stats = sectionProgress[section.id as SectionId]
      html += `<h2 style="background:#066E4F">${section.name} — ${stats.pct}% complete</h2>`

      for (const method of methods) {
        html += `<h3>${method.name}</h3>`
        for (const field of method.fields) {
          const key = field.id
          if (field.type === 'toggle') {
            const checked = localData.toggles[key] === true
            html += `<div class="field"><span class="${checked ? 'check' : 'uncheck'}">${checked ? '☑' : '☐'}</span> ${field.label}</div>`
          } else if (field.type === 'text') {
            const val = localData.texts[key] || ''
            html += `<div class="field"><div class="field-label">${field.label}</div><div class="${val ? 'text-val' : 'empty'}">${val || 'Not filled'}</div></div>`
          } else if (field.type === 'select') {
            const val = localData.selects[key] || ''
            html += `<div class="field"><div class="field-label">${field.label}</div><div class="${val ? 'field-value' : 'empty'}">${val || 'Not selected'}</div></div>`
          } else if (field.type === 'file') {
            const val = localData.files[key] || ''
            html += `<div class="field"><div class="field-label">${field.label}</div><div class="${val ? 'field-value' : 'empty'}">${val ? '📎 ' + val : 'No file uploaded'}</div></div>`
          }
        }
      }
    }

    html += `<div class="footer">Generated by Blueroll · blueroll.app · ${totalProgress.filled} of ${totalProgress.total} fields complete (${totalProgress.pct}%)</div></body></html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  // \u2500\u2500 "All sites" scope: group dashboard, no pack form (pick a site to edit it) \u2500\u2500
  if (isAllSites) {
    return (
      <AllSitesDashboard
        sectionProgress={sectionProgress}
        totalProgress={totalProgress}
        reviewLabel={reviewInfo.label}
        reviewOverdue={reviewInfo.overdue}
        onExportPDF={handleExportPDF}
      />
    )
  }

  return (
    <div className="space-y-5">
      {/* \u2500\u2500 Page header \u2500\u2500 */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">HACCP Pack</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Safer Food, Better Business documentation for EHO inspections.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Review status pill */}
          <span
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] font-medium transition-colors',
              reviewInfo.overdue
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-border bg-card text-foreground',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                reviewInfo.overdue ? 'bg-rose-500' : 'bg-primary',
              )}
            />
            {reviewInfo.label}
          </span>

          {/* Auto-fill switch */}
          <button
            onClick={() => toggleAutoFill.mutate()}
            disabled={toggleAutoFill.isPending}
            className="flex h-8 items-center gap-2 rounded-full border border-border bg-card pl-3.5 pr-2 text-[12px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-60"
          >
            <span>Auto-fill</span>
            <span
              className={cn(
                'relative block h-4 w-7 shrink-0 rounded-full transition-colors',
                autoFillEnabled ? 'bg-primary' : 'bg-zinc-300',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 block h-3 w-3 rounded-full bg-white shadow-sm transition-[left] duration-200',
                  autoFillEnabled ? 'left-3.5' : 'left-0.5',
                )}
              />
            </span>
          </button>

          {/* Export PDF */}
          <button
            onClick={handleExportPDF}
            className="inline-flex h-8 items-center gap-2 rounded-lg bg-foreground px-3.5 text-[12px] font-medium text-background transition-colors hover:bg-foreground/90"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
            Export PDF
          </button>
        </div>
      </div>

      {/* \u2500\u2500 Progress strip \u2500\u2500 */}
      <div className="flex items-center gap-4">
        <span className="whitespace-nowrap text-[12px] text-muted-foreground">
          <b className="font-semibold tabular-nums text-foreground">{totalProgress.filled}</b> of{' '}
          <b className="font-semibold tabular-nums text-foreground">{totalProgress.total}</b> fields complete
          <span className="ml-1.5 font-semibold tabular-nums text-emerald-600">
            {'\u00b7'} {totalProgress.pct}%
          </span>
        </span>
        <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-accent">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${totalProgress.pct}%` }}
          />
        </span>
      </div>

      {/* Per-site sign-off (multi-site groups only) */}
      <SiteSignoff />

      {/* Sticky tabs + sentinel for stuck detection */}
      <div className="-mt-[9px]">
        <div ref={sentinelRef} aria-hidden className="h-px" />
        <div
          className={cn(
            'sticky top-0 z-20 -mx-6 px-6 py-2 transition-[background-color,border-color,backdrop-filter] duration-200',
            tabsStuck
              ? 'border-b border-border/60 bg-background/75 backdrop-blur-md'
              : 'border-b border-transparent',
          )}
        >
        <div
          ref={tabsRef}
          className="relative flex gap-0.5 rounded-xl border border-border bg-card p-1 shadow-[0_1px_2px_rgba(24,24,27,0.04)]"
        >
          <span
            ref={indicatorRef}
            aria-hidden
            className="pointer-events-none absolute left-1 top-1 z-0 h-[calc(100%-8px)] rounded-lg bg-primary transition-[transform,width] duration-[380ms] will-change-[transform,width]"
            style={{ transitionTimingFunction: 'cubic-bezier(.28,.85,.34,1)' }}
          />
        {HACCP_SECTIONS.map((section) => {
          const sp = sectionProgress[section.id as SectionId]
          const isActive = section.id === activeSection
          return (
            <button
              key={section.id}
              data-tab
              data-active={isActive ? 'true' : undefined}
              onClick={() => setActiveSection(section.id as SectionId)}
              className={cn(
                'relative z-10 flex flex-1 flex-col items-start gap-1 rounded-xl px-3.5 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40',
                !isActive && 'hover:bg-white/60',
              )}
            >
              <span
                className={cn(
                  'text-[12.5px] leading-tight tracking-tight transition-colors duration-200',
                  isActive ? 'font-semibold text-white' : 'font-medium text-zinc-500',
                )}
              >
                {section.name}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-2 font-mono text-[10.5px] leading-none tabular-nums transition-colors',
                  isActive ? 'text-emerald-50' : 'text-zinc-500',
                )}
              >
                <span
                  className={cn(
                    'relative block h-[3px] w-9 overflow-hidden rounded-full',
                    isActive ? 'bg-emerald-800/40' : 'bg-zinc-300',
                  )}
                >
                  <span
                    className={cn(
                      'absolute inset-y-0 left-0 rounded-full',
                      isActive ? 'bg-white' : 'bg-primary',
                    )}
                    style={{ width: `${sp?.pct ?? 0}%` }}
                  />
                </span>
                {sp?.filled ?? 0} / {sp?.total ?? 0}
              </span>
            </button>
          )
        })}
        </div>
        </div>
      </div>

      {/* \u2500\u2500 Methods list \u2500\u2500 */}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {activeMethods.map((method, idx) => {
          const methodFilled = method.fields.filter((f) =>
            isFieldFilled(f, localData, autoData, autoFillEnabled),
          ).length
          const methodTotal = method.fields.length
          const methodPct = methodTotal > 0 ? Math.round((methodFilled / methodTotal) * 100) : 0
          const isDone = methodPct === 100
          const isExpanded = expandedMethods[method.id] === true

          return (
            <div key={method.id}>
              <button
                onClick={() => toggleMethod(method.id)}
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-zinc-50/60"
              >
                <span className="inline-flex items-center gap-3.5">
                  {isDone ? (
                    <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-primary">
                      <svg
                        viewBox="0 0 14 14"
                        className="h-[15px] w-[15px] text-white"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 7 L5.6 9.6 L11 4.2" />
                      </svg>
                    </span>
                  ) : (
                    <span
                      className="h-[26px] w-[26px] rounded-full"
                      style={{
                        background:
                          methodPct > 0
                            ? `conic-gradient(rgb(5 150 105) ${methodPct}%, rgb(212 212 216) 0)`
                            : 'rgb(212 212 216)',
                        WebkitMask: 'radial-gradient(circle, transparent 9px, #000 9.5px)',
                        mask: 'radial-gradient(circle, transparent 9px, #000 9.5px)',
                      }}
                    />
                  )}
                  <span className="text-[14px] font-medium tracking-tight text-foreground">
                    {method.name}
                  </span>
                </span>

                <span className="inline-flex items-center gap-2.5 font-mono text-[12px] tabular-nums text-muted-foreground">
                  {methodFilled} of {methodTotal}
                  <span className="block h-[3px] w-12 overflow-hidden rounded-full bg-zinc-200">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${methodPct}%` }}
                    />
                  </span>
                </span>

                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform duration-200',
                    isExpanded && 'rotate-180',
                  )}
                  strokeWidth={1.7}
                />
              </button>

              {/* Smooth grid-based accordion */}
              <div
                className="grid transition-[grid-template-rows] duration-[380ms]"
                style={{
                  transitionTimingFunction: 'cubic-bezier(.4,0,.2,1)',
                  gridTemplateRows: isExpanded ? '1fr' : '0fr',
                }}
              >
                <div className="min-h-0 overflow-hidden">
                  <div
                    className={cn(
                      'space-y-2 border-t border-border bg-zinc-50/60 pb-6 pl-[56px] pr-[56px] pt-3 transition-[opacity,transform] duration-200 ease-out',
                      isExpanded ? 'translate-y-0 opacity-100 delay-[80ms]' : '-translate-y-1 opacity-0',
                    )}
                  >
                    {method.fields.map((field) => (
                      <FieldRenderer
                        key={field.id}
                        field={field}
                        data={localData}
                        autoData={autoData}
                        autoFill={autoFillEnabled}
                        onUpdate={updateField}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// File field helpers
// ═══════════════════════════════════════════════════════════════

function parseFileRef(raw: string | undefined): PickedDocument | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.id && parsed?.title) return parsed
  } catch {
    // Old placeholder format — treat as unknown
  }
  return null
}

function serializeFileRef(doc: PickedDocument): string {
  return JSON.stringify({ id: doc.id, title: doc.title })
}

async function viewDocument(docId: string) {
  const { data: doc, error } = await supabase
    .from('documents')
    .select('file_url')
    .eq('id', docId)
    .single()
  if (error || !doc?.file_url) {
    toast.error('Document not found')
    return
  }
  const { data: signed, error: urlError } = await supabase.storage
    .from('documents')
    .createSignedUrl(doc.file_url, 3600)
  if (urlError || !signed) {
    toast.error('Failed to generate link')
    return
  }
  window.open(signed.signedUrl, '_blank')
}

// ═══════════════════════════════════════════════════════════════
// Field Renderer
// ═══════════════════════════════════════════════════════════════

function FieldRenderer({
  field,
  data,
  autoData,
  autoFill,
  onUpdate,
}: {
  field: HaccpField
  data: HaccpPackRow
  autoData: Record<string, string>
  autoFill: boolean
  onUpdate: (fieldId: string, type: FieldType, value: any) => void
}) {
  const hasAutoValue = autoFill && !!field.autoSource && !!autoData[field.id]
  const isOverridden = data.overrides[field.id]
  const showAuto = hasAutoValue && !isOverridden
  const isChecked = data.toggles[field.id] ?? false

  switch (field.type) {
    case 'toggle':
      return (
        <label className="flex cursor-pointer items-center gap-3 border-b border-border/40 py-3 last:border-b-0">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => onUpdate(field.id, 'toggle', e.target.checked)}
            className="peer sr-only"
          />
          <span
            className={cn(
              'relative inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full border-[1.5px] bg-card transition-[background,border-color,transform] duration-200',
              isChecked
                ? 'border-emerald-600 bg-primary [animation:haccp-check-pop_.35s_cubic-bezier(.5,1.5,.4,1)]'
                : 'border-zinc-300',
            )}
          >
            <svg
              viewBox="0 0 14 14"
              className="h-[13px] w-[13px]"
              fill="none"
              stroke="white"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: 12,
                strokeDashoffset: isChecked ? 0 : 12,
                transition: 'stroke-dashoffset .32s .07s cubic-bezier(.6,.15,.3,1)',
              }}
            >
              <path d="M3 7 L5.6 9.6 L11 4.2" />
            </svg>
          </span>
          <span
            className={cn(
              'text-[13.5px] leading-relaxed transition-colors',
              isChecked ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {field.label}
          </span>
        </label>
      )

    case 'text':
      return (
        <div className="space-y-2 py-3">
          <label className="block text-[13px] font-medium text-foreground">{field.label}</label>

          {showAuto ? (
            <div
              onClick={() => onUpdate(field.id, 'text', autoData[field.id])}
              className="cursor-text rounded-[10px] bg-emerald-50 px-4 py-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[.08em] text-emerald-600">
                  <span className="h-[5px] w-[5px] rounded-full bg-primary" />
                  Auto-filled
                  {field.autoSource && (
                    <span className="text-[11.5px] font-medium normal-case tracking-normal text-emerald-600/70">
                      &middot; {field.autoSource}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="flex-shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium text-emerald-600 hover:bg-emerald-100"
                >
                  Edit / override
                </button>
              </div>
              <p className="whitespace-pre-wrap text-[13.5px] leading-[1.55] tracking-[-.003em] text-foreground">
                {autoData[field.id]}
              </p>
            </div>
          ) : (
            <textarea
              value={data.texts[field.id] ?? ''}
              onChange={(e) => onUpdate(field.id, 'text', e.target.value)}
              placeholder={hasAutoValue ? 'Auto-fill available - type to override' : 'Enter details...'}
              rows={3}
              className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-600 focus:outline-none focus:ring-4 focus:ring-emerald-600/15"
            />
          )}

          {!showAuto && isOverridden && hasAutoValue && (
            <button
              type="button"
              onClick={() => {
                const updated = { ...data }
                updated.overrides = { ...updated.overrides }
                delete updated.overrides[field.id]
                updated.texts = { ...updated.texts }
                delete updated.texts[field.id]
                onUpdate(field.id, 'text', '')
              }}
              className="text-[11px] text-muted-foreground underline decoration-zinc-300 underline-offset-2 hover:text-foreground"
            >
              Revert to auto-fill
            </button>
          )}

          {!showAuto && field.autoSource && !hasAutoValue && (
            <p className="text-[11px] text-muted-foreground">Source: {field.autoSource}</p>
          )}
        </div>
      )

    case 'file': {
      const fileRef = parseFileRef(data.files[field.id])
      return (
        <div className="py-3">
          <FileFieldRenderer field={field} fileRef={fileRef} onUpdate={onUpdate} />
        </div>
      )
    }

    case 'select':
      return (
        <div className="space-y-2 py-3">
          <label className="block text-[13px] font-medium text-foreground">{field.label}</label>
          <select
            value={showAuto ? autoData[field.id] : (data.selects[field.id] ?? '')}
            onChange={(e) => onUpdate(field.id, 'select', e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-[13.5px] text-foreground focus:border-emerald-600 focus:outline-none focus:ring-4 focus:ring-emerald-600/15"
          >
            <option value="">Select...</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {field.autoSource && (
            <p className="text-[11px] text-muted-foreground">Source: {field.autoSource}</p>
          )}
        </div>
      )

    default:
      return null
  }
}

// ═══════════════════════════════════════════════════════════════
// File field with document picker (needs own state for modal)
// ═══════════════════════════════════════════════════════════════

function FileFieldRenderer({
  field,
  fileRef,
  onUpdate,
}: {
  field: HaccpField
  fileRef: PickedDocument | null
  onUpdate: (fieldId: string, type: FieldType, value: any) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <div className="space-y-1.5">
      <label className="text-[13px] font-medium">{field.label}</label>
      {fileRef ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-gray-50 px-3 py-2">
          <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-[13px] font-medium">{fileRef.title}</span>
          <button
            onClick={() => viewDocument(fileRef.id)}
            className="text-emerald-600 hover:text-emerald-600"
            title="View document"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onUpdate(field.id, 'file', '')}
            className="text-muted-foreground hover:text-foreground"
            title="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setPickerOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border py-3 text-[13px] text-muted-foreground hover:border-emerald-300 hover:text-foreground transition-colors"
        >
          <Link2 className="h-4 w-4" />
          Choose or upload document
        </button>
      )}
      {field.autoSource && (
        <p className="text-[11px] text-muted-foreground">Source: {field.autoSource}</p>
      )}
      <DocumentPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(doc) => onUpdate(field.id, 'file', serializeFileRef(doc))}
        label={field.label}
      />
    </div>
  )
}
