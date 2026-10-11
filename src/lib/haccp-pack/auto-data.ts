import { ALLERGEN_LABELS, type EUAllergen } from '@/lib/constants'
import { resolveAllergens, sourceMeta, type Dish } from '@/lib/dishes'

// Auto-fill for the HACCP pack: values derived from recipes, menu, suppliers,
// documents, team and checklists. Pure — the pack page and the HACCP Plan
// document both call it with the same source rows.

export interface RecipeSrc {
  id: string
  name: string
  cooking_method: string | null
  cooking_temp: number | null
  extra_care_flags: string[] | string | null
  reheating_instructions: string | null
  hot_holding_required: boolean | null
  chilling_method: string | null
  freezing_instructions: string | null
  defrosting_instructions: string | null
  haccp_methods: string[] | null
  recipe_ingredients: { ingredient: { name: string; allergens: string[] | null } | null }[] | null
}

export interface SupplierSrc {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  delivery_days: string[] | string | null
}

export interface AutoDataSources {
  recipes: RecipeSrc[]
  dishes: Dish[]
  suppliers: SupplierSrc[]
  templates: { id: string; name: string; frequency: string; sfbb_section: string | null }[]
  documents: { id: string; title: string; category: string | null }[]
  team: { full_name: string | null; role: string | null }[]
}

export const AUTO_SOURCE_LABEL: Record<string, string> = {
  ck_dishes: 'From your recipes', rh_items: 'From your recipes', hh_items: 'From your recipes', cd_method: 'From your recipes',
  fz_method: 'From your recipes', df_method: 'From your recipes', df_products: 'From your recipes', ec_items: 'From your recipes',
  rte_items: 'From your recipes', mc_items: 'From your recipes', sf_raw_products: 'From recipe ingredients',
  fa_allergens_list: 'From your menu', sup_list: 'From your suppliers', sf_delivery_schedule: 'From your suppliers',
  pc_company: 'From your documents', tr_records: 'From your documents', tr_responsible: 'From your team',
  st_method: 'From your checklists', tp_method: 'From your checklists',
}

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

export function computeAutoData(src: AutoDataSources): Record<string, string> {
  const auto: Record<string, string> = {}
  const { recipes, dishes, suppliers, templates, documents, team } = src

  // Recipes-based (driven by the haccp_methods multi-select on each recipe)
  if (recipes.length) {
    // Helper: recipes that declared a given HACCP method
    const withMethod = (methodId: string) =>
      recipes.filter((r) => Array.isArray(r.haccp_methods) && r.haccp_methods.includes(methodId))

    // Helper: format one recipe row with optional trailing detail
    const fmt = (r: RecipeSrc, detail?: string | null) => (detail ? `${r.name}: ${detail}` : r.name)
    const cookParts = (r: RecipeSrc) => [r.cooking_method, r.cooking_temp ? `${r.cooking_temp}°C` : null].filter(Boolean)

    // Cooking Safely → ck_dishes
    const cooking = withMethod('cooking_safely')
    if (cooking.length) {
      auto['ck_dishes'] = cooking
        .map((r) => {
          const parts = cookParts(r)
          return fmt(r, parts.length ? parts.join(' @ ') : null)
        })
        .join('\n')
    }

    // Reheating → rh_items
    const reheating = withMethod('reheating')
    if (reheating.length) auto['rh_items'] = reheating.map((r) => fmt(r, r.reheating_instructions)).join('\n')

    // Hot Holding → hh_items
    const hotHold = withMethod('hot_holding')
    if (hotHold.length) auto['hh_items'] = hotHold.map((r) => r.name).join(', ')

    // Chilling Down Hot Food → cd_method
    const chillingDown = withMethod('chilling_down')
    if (chillingDown.length) auto['cd_method'] = chillingDown.map((r) => fmt(r, r.chilling_method)).join('\n')

    // Freezing → fz_method
    const freezing = withMethod('freezing')
    if (freezing.length) auto['fz_method'] = freezing.map((r) => fmt(r, r.freezing_instructions)).join('\n')

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
    const menuCooking = recipes.filter(
      (r) =>
        Array.isArray(r.haccp_methods) &&
        r.haccp_methods.some((m) => ['cooking_safely', 'reheating', 'hot_holding', 'extra_care'].includes(m)),
    )
    if (menuCooking.length) {
      auto['mc_items'] = menuCooking
        .map((r) => {
          const parts = cookParts(r)
          return parts.length ? `${r.name} — ${parts.join(' @ ')}` : r.name
        })
        .join('\n')
    }

    // ── Ingredient-driven fields ──
    const rawProducts = new Set<string>()
    const allergensPresent = new Set<string>()
    const recipeAllergenMap = new Map<string, Set<string>>()

    for (const r of recipes) {
      const ings = (r.recipe_ingredients ?? []).map((ri) => ri?.ingredient).filter((x): x is NonNullable<typeof x> => !!x)
      for (const ing of ings) {
        const name = (ing.name ?? '').trim()
        if (!name) continue
        const lower = name.toLowerCase()
        const ingAllergens: string[] = Array.isArray(ing.allergens) ? ing.allergens : []

        // Raw detection: by keyword OR by seafood allergen
        const isRaw = RAW_KEYWORDS.some((kw) => lower.includes(kw)) || ingAllergens.some((a) => SEAFOOD_ALLERGENS.has(a))
        if (isRaw) rawProducts.add(name)

        for (const a of ingAllergens) {
          allergensPresent.add(a)
          if (!recipeAllergenMap.has(r.name)) recipeAllergenMap.set(r.name, new Set())
          recipeAllergenMap.get(r.name)!.add(a)
        }
      }
    }

    if (rawProducts.size) auto['sf_raw_products'] = Array.from(rawProducts).sort().join(', ')

    // Allergens are declared per dish, not per recipe: a drink or bought-in
    // item has no recipe but still belongs in the pack. Recipe-backed lines
    // trace to ingredients; declared lines carry who attested and when.
    const dishLines = dishes.map((d) => {
      const al = resolveAllergens(d)
      const list = al.length ? al.map((a) => ALLERGEN_LABELS[a as EUAllergen] ?? a).join(', ') : 'none'
      return `${d.name}: ${list} (${sourceMeta(d)})`
    })
    const dishAllergens = new Set<string>()
    dishes.forEach((d) => resolveAllergens(d).forEach((a) => dishAllergens.add(ALLERGEN_LABELS[a as EUAllergen] ?? a)))

    if (dishLines.length) {
      const header = `Allergens present: ${dishAllergens.size ? Array.from(dishAllergens).sort().join(', ') : 'none declared'}`
      auto['fa_allergens_list'] = `${header}\n\n${dishLines.join('\n')}`
    } else if (allergensPresent.size) {
      // No dishes on the menu yet — fall back to the recipe library.
      const header = `Allergens present: ${Array.from(allergensPresent).sort().join(', ')}`
      const perRecipe = Array.from(recipeAllergenMap.entries())
        .map(([recipeName, set]) => `${recipeName}: ${Array.from(set).sort().join(', ')}`)
        .join('\n')
      auto['fa_allergens_list'] = perRecipe ? `${header}\n\n${perRecipe}` : header
    }
  }

  // Suppliers-based
  if (suppliers.length) {
    auto['sup_list'] = suppliers
      .map((s) => `${s.name}${s.contact_name ? ` (${s.contact_name})` : ''}${s.phone ? ` — ${s.phone}` : ''}${s.email ? ` — ${s.email}` : ''}`)
      .join('\n')

    const deliveryDays = suppliers
      .filter((s) => s.delivery_days)
      .map((s) => `${s.name}: ${Array.isArray(s.delivery_days) ? s.delivery_days.join(', ') : s.delivery_days}`)
    if (deliveryDays.length) auto['sf_delivery_schedule'] = deliveryDays.join('\n')
  }

  // Documents-based
  if (documents.length) {
    const pestDocs = documents.filter((d) => d.category === 'contract' || d.category === 'inspection')
    if (pestDocs.length) auto['pc_company'] = pestDocs.map((d) => d.title).join(', ')

    const trainingDocs = documents.filter((d) => d.category === 'training' || d.category === 'certificate')
    if (trainingDocs.length) auto['tr_records'] = trainingDocs.map((d) => d.title).join(', ')
  }

  // Team-based
  if (team.length) {
    const responsible = team.filter((p) => p.role === 'owner' || p.role === 'manager')
    if (responsible.length) auto['tr_responsible'] = responsible.map((p) => `${p.full_name ?? 'Unnamed'} (${p.role})`).join(', ')
  }

  // Checklists-based
  if (templates.length) {
    const tempChecklist = templates.find((c) => c.sfbb_section === 'temperature' || c.name?.toLowerCase().includes('temperature'))
    if (tempChecklist) auto['st_method'] = `Using checklist: ${tempChecklist.name} (${tempChecklist.frequency})`

    const probeChecklist = templates.find(
      (c) => c.sfbb_section === 'probes' || c.name?.toLowerCase().includes('probe') || c.name?.toLowerCase().includes('calibrat'),
    )
    if (probeChecklist) auto['tp_method'] = `Using checklist: ${probeChecklist.name} (${probeChecklist.frequency})`
  }

  return auto
}
