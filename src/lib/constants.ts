// ── EU 14 Allergens ──
export const EU_ALLERGENS = [
  'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans',
  'milk', 'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs',
] as const
export type EUAllergen = (typeof EU_ALLERGENS)[number]

export const ALLERGEN_LABELS: Record<EUAllergen, string> = {
  gluten: 'Gluten', crustaceans: 'Crustaceans', eggs: 'Eggs', fish: 'Fish',
  peanuts: 'Peanuts', soybeans: 'Soybeans', milk: 'Milk', nuts: 'Tree Nuts',
  celery: 'Celery', mustard: 'Mustard', sesame: 'Sesame', sulphites: 'Sulphites',
  lupin: 'Lupin', molluscs: 'Molluscs',
}

// ── Roles ──
export const USER_ROLES = ['owner', 'manager', 'chef', 'kitchen_staff', 'front_of_house'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner', manager: 'Manager', chef: 'Chef',
  kitchen_staff: 'Kitchen Staff', front_of_house: 'Front of House',
}

export const ROLE_COLORS: Record<UserRole, string> = {
  owner: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  manager: 'bg-blue-50 text-blue-700 border-blue-200',
  chef: 'bg-amber-50 text-amber-700 border-amber-200',
  kitchen_staff: 'bg-gray-50 text-gray-600 border-gray-200',
  front_of_house: 'bg-purple-50 text-purple-700 border-purple-200',
}

// ── Checklist ──
export const CHECKLIST_FREQUENCIES = ['daily', 'weekly', 'monthly', 'four_weekly', 'custom'] as const
export const CHECKLIST_ITEM_TYPES = ['tick', 'temperature', 'text', 'yes_no', 'photo'] as const

export const CHECKLIST_TYPES = [
  { id: 'opening', label: 'Opening', icon: '🌅', description: 'Start-of-day checks' },
  { id: 'closing', label: 'Closing', icon: '🌙', description: 'End-of-day checks' },
  { id: 'temperature_log', label: 'Temperature Log', icon: '🌡️', description: 'Fridge & freezer temps' },
  { id: 'cleaning', label: 'Cleaning', icon: '🧹', description: 'Cleaning schedule' },
  { id: 'haccp_review', label: 'HACCP Review', icon: '📋', description: 'Periodic safety review' },
  { id: 'custom', label: 'Custom', icon: '✏️', description: 'Describe your own' },
] as const

// ── Kitchen Equipment ──
export const DEFAULT_EQUIPMENT = [
  'Fridge', 'Fridge 2', 'Fridge 3', 'Walk-in fridge',
  'Freezer', 'Freezer 2', 'Walk-in freezer',
  'Deep fryer', 'Oven', 'Combi oven', 'Grill',
  'Bain-marie', 'Blast chiller', 'Hot holding unit',
  'Dishwasher', 'Ice machine', 'Probe thermometer',
] as const

// ── Recipe ──
export const RECIPE_CATEGORIES = [
  'starter', 'main', 'dessert', 'side', 'sauce', 'drink', 'cocktail', 'beverage', 'other',
] as const

export const RECIPE_CATEGORY_LABELS: Record<string, string> = {
  starter: 'Starters', main: 'Mains', dessert: 'Desserts', side: 'Sides',
  sauce: 'Sauces', drink: 'Drinks', cocktail: 'Cocktails', beverage: 'Beverages', other: 'Other',
}

// ── Document ──
export const DOCUMENT_CATEGORIES = [
  'certificate', 'license', 'policy', 'instruction', 'contract', 'inspection', 'training', 'other',
] as const

// ── Incident ──
export const INCIDENT_TYPES = ['complaint', 'incident'] as const

// ── Check-in ──
export const MOOD_EMOJIS = ['😊', '🔥', '😴', '💪', '🤒', '😎'] as const

// ── HACCP Pack ──
export const HACCP_SECTIONS = [
  { id: 'cross', name: 'Cross-Contamination', shortName: 'Cross-C.', color: '#DC2626' },
  { id: 'cleaning', name: 'Cleaning', shortName: 'Cleaning', color: '#7C3AED' },
  { id: 'chilling', name: 'Chilling', shortName: 'Chilling', color: '#0891B2' },
  { id: 'cooking', name: 'Cooking', shortName: 'Cooking', color: '#EA580C' },
  { id: 'management', name: 'Management', shortName: 'Manage', color: '#A21CAF' },
] as const

export const HACCP_LEVELS = [
  { name: 'Kitchen Starter', min: 0 },
  { name: 'Safety Aware', min: 100 },
  { name: 'Hygiene Pro', min: 300 },
  { name: 'Compliance Expert', min: 600 },
  { name: 'HACCP Master', min: 1000 },
] as const

// ── Subscription ──
export const PAYWALL_FEATURES = [
  { title: 'Digital HACCP checklists', subtitle: 'Replace paper records forever' },
  { title: 'AI recipe import', subtitle: 'Photo, text, or PDF — instant digitisation' },
  { title: 'Allergen matrix', subtitle: 'Auto-generated from your recipes' },
  { title: 'Compliance reports', subtitle: 'One-tap PDF for EHO inspections' },
  { title: 'Team management', subtitle: 'Check-ins, tasks, and incident tracking' },
  { title: 'Document storage', subtitle: 'Certificates, licences — expiry alerts' },
] as const
