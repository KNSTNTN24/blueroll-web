import { normalizeAllergens } from "./allergens.ts";

type Role = { id: string; base_tier: string };
type ExtractedChecklist = {
  name: string;
  frequency?: string;
  assigned_roles?: string[];
  items: {
    name: string;
    item_type: string;
    required?: boolean;
    min_value?: number | null;
    max_value?: number | null;
    unit?: string | null;
  }[];
};
type ExtractedDish = { name: string; category: string; allergens: string[] };
type BuildInput = {
  businessId: string;
  siteId: string;
  roles: Role[];
  checklists: ExtractedChecklist[];
  dishes: ExtractedDish[];
};
type TemplateRow = {
  business_id: string;
  site_id: string;
  name: string;
  frequency: string;
  assigned_roles: string[];
  assigned_role_ids: string[];
  items: {
    name: string;
    item_type: string;
    required: boolean;
    sort_order: number;
    min_value: number | null;
    max_value: number | null;
    unit: string | null;
  }[];
};
type MenuItemRow = {
  business_id: string;
  site_id: string;
  name: string;
  category: string;
  declared_allergens: string[];
  allergen_source: "manual";
  attested_by_name: string;
  attested_at: string;
  active: true;
};

const ITEM_TYPES = new Set(["tick", "temperature", "text", "yes_no", "photo", "initials"]);
const FREQ = new Set(["daily", "weekly", "monthly", "four_weekly", "custom"]);
const ROLE_FALLBACK = ["manager", "kitchen_staff", "front_of_house"];

export function buildPlan(input: BuildInput, nowIso: string): {
  templates: TemplateRow[];
  categories: string[];
  menuItems: MenuItemRow[];
} {
  const idsByTier = (tiers: string[]): string[] =>
    input.roles.filter((r) => tiers.includes(r.base_tier)).map((r) => r.id);

  const templates: TemplateRow[] = input.checklists.map((c) => {
    const roles = c.assigned_roles?.length ? c.assigned_roles : ROLE_FALLBACK;
    return {
      business_id: input.businessId,
      site_id: input.siteId,
      name: c.name.trim(),
      frequency: FREQ.has(c.frequency ?? "") ? c.frequency! : "daily",
      assigned_roles: roles,
      assigned_role_ids: idsByTier(roles),
      items: c.items.map((it, i) => ({
        name: it.name.trim(),
        item_type: ITEM_TYPES.has(it.item_type) ? it.item_type : "text",
        required: it.required ?? true,
        sort_order: i,
        min_value: it.min_value ?? null,
        max_value: it.max_value ?? null,
        unit: it.unit ?? null,
      })),
    };
  });

  const categories = [...new Set(input.dishes.map((d) => d.category.trim()))];

  const menuItems: MenuItemRow[] = input.dishes.map((d) => ({
    business_id: input.businessId,
    site_id: input.siteId,
    name: d.name.trim(),
    category: d.category.trim(),
    declared_allergens: normalizeAllergens(d.allergens),
    allergen_source: "manual",
    attested_by_name: "Imported — pending owner verification",
    attested_at: nowIso,
    active: true,
  }));

  return { templates, categories, menuItems };
}
