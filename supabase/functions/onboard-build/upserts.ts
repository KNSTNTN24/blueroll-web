// upserts.ts — pure shaping helpers for onboard-build's DB writes.
// No I/O here; index.ts does the actual selects/inserts/updates using these shapes.

type TemplateItemInput = {
  name: string;
  item_type: string;
  required: boolean;
  sort_order: number;
  min_value: number | null;
  max_value: number | null;
  unit: string | null;
};

type TemplateRowInput = {
  business_id: string;
  site_id: string;
  name: string;
  frequency: string;
  assigned_roles: string[];
  assigned_role_ids: string[];
  items: TemplateItemInput[];
};

export type TemplateParentRow = {
  business_id: string;
  site_id: string;
  name: string;
  frequency: string;
  assigned_roles: string[];
  assigned_role_ids: string[];
  active: true;
};

export type TemplateItemRow = TemplateItemInput & { template_id: string };

/**
 * Splits a buildPlan TemplateRow into:
 *  - `parent`: the columns to write to checklist_templates (sans `items`, plus `active:true`)
 *  - `itemsFor(templateId)`: maps `items` to checklist_template_items rows keyed by template_id
 */
export function splitTemplateForUpsert(
  row: TemplateRowInput,
): { parent: TemplateParentRow; itemsFor: (templateId: string) => TemplateItemRow[] } {
  const { items, ...parentFields } = row;
  const parent: TemplateParentRow = { ...parentFields, active: true };
  const itemsFor = (templateId: string): TemplateItemRow[] =>
    items.map((it) => ({ ...it, template_id: templateId }));
  return { parent, itemsFor };
}

type MenuItemRowInput = {
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

export type MenuItemInsertRow = Omit<MenuItemRowInput, "category" | "site_id"> & {
  category: string;
  attested_by: null;
  site_categories: Record<string, string>;
};

/**
 * Shapes a buildPlan MenuItemRow into the menu_items insert payload, replacing the
 * bare `category` string with the per-site category-id map (`site_categories`) while
 * keeping the legacy `category` column populated for backwards compatibility.
 */
export function shapeMenuItemForUpsert(
  row: MenuItemRowInput,
  categoryIdBySiteId: Record<string, string>,
): MenuItemInsertRow {
  const { site_id: _siteId, ...rest } = row;
  return {
    ...rest,
    category: row.category,
    attested_by: null,
    site_categories: categoryIdBySiteId,
  };
}
