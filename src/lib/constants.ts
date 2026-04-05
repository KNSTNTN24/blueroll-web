export const EU_ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const

export type EUAllergen = (typeof EU_ALLERGENS)[number]

export const ALLERGEN_LABELS: Record<EUAllergen, string> = {
  gluten: 'Gluten',
  crustaceans: 'Crustaceans',
  eggs: 'Eggs',
  fish: 'Fish',
  peanuts: 'Peanuts',
  soybeans: 'Soybeans',
  milk: 'Milk',
  nuts: 'Tree Nuts',
  celery: 'Celery',
  mustard: 'Mustard',
  sesame: 'Sesame',
  sulphites: 'Sulphites',
  lupin: 'Lupin',
  molluscs: 'Molluscs',
}

export const ALLERGEN_EMOJI: Record<EUAllergen, string> = {
  gluten: '🌾',
  crustaceans: '🦐',
  eggs: '🥚',
  fish: '🐟',
  peanuts: '🥜',
  soybeans: '🫘',
  milk: '🥛',
  nuts: '🌰',
  celery: '🥬',
  mustard: '🟡',
  sesame: '⚪',
  sulphites: '🟣',
  lupin: '🌸',
  molluscs: '🐚',
}

export const USER_ROLES = [
  'owner',
  'manager',
  'chef',
  'kitchen_staff',
  'front_of_house',
] as const

export type UserRole = (typeof USER_ROLES)[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  chef: 'Chef',
  kitchen_staff: 'Kitchen Staff',
  front_of_house: 'Front of House',
}

export const CHECKLIST_FREQUENCIES = [
  'daily',
  'weekly',
  'monthly',
  'four_weekly',
  'custom',
] as const

export const CHECKLIST_ITEM_TYPES = [
  'tick',
  'temperature',
  'text',
  'yes_no',
  'photo',
] as const

export const RECIPE_CATEGORIES = [
  'starter',
  'main',
  'dessert',
  'side',
  'sauce',
  'drink',
  'cocktail',
  'beverage',
  'other',
] as const

export const RECIPE_CATEGORY_LABELS: Record<string, string> = {
  starter: 'Starters',
  main: 'Mains',
  dessert: 'Desserts',
  side: 'Sides',
  sauce: 'Sauces',
  drink: 'Drinks',
  cocktail: 'Cocktails',
  beverage: 'Beverages',
  other: 'Other',
}

export const DOCUMENT_CATEGORIES = [
  'certificate',
  'license',
  'policy',
  'instruction',
  'contract',
  'inspection',
  'training',
  'other',
] as const

export const INCIDENT_TYPES = ['complaint', 'incident'] as const

export const MOOD_EMOJIS = ['😊', '🔥', '😴', '💪', '🤒', '😎'] as const

export const PAIN_POINTS = [
  'Paper records take too long',
  'Worried about EHO inspections',
  'Staff don\'t follow procedures',
  'Allergen tracking is a nightmare',
  'No visibility of what\'s happening',
  'Training records are a mess',
] as const
