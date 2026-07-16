-- Promote menu_items to a first-class Dish.
--
-- Until now a menu item was a pure projection of a recipe (recipe_id NOT NULL,
-- name read through the join). Real kitchens put drinks, bought-in items and
-- daily specials on the menu that have no recipe, yet still must declare
-- allergens to guests and to an EHO.
--
-- A dish is now either:
--   allergen_source = 'recipe'  → allergens derived live from the recipe's
--                                 ingredients, fully traceable
--   allergen_source = 'manual'  → allergens declared by hand and attested by a
--                                 named user (the due-diligence record)
--
-- Effective allergens are resolved at read time and never denormalised onto the
-- dish for the recipe case, so editing a recipe updates every dish built from it.

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS allergen_source text NOT NULL DEFAULT 'recipe',
  ADD COLUMN IF NOT EXISTS declared_allergens text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS may_contain text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dietary text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS attested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attested_by_name text,
  ADD COLUMN IF NOT EXISTS attested_at timestamptz,
  ADD COLUMN IF NOT EXISTS price numeric,
  ADD COLUMN IF NOT EXISTS site_ids uuid[] NOT NULL DEFAULT '{}';

-- Backfill: every pre-existing row is a recipe projection (idempotent).
UPDATE public.menu_items m
   SET name = r.name
  FROM public.recipes r
 WHERE r.id = m.recipe_id
   AND m.name IS NULL;

-- Any row whose recipe vanished would block the NOT NULL below; none exist
-- today (the FK cascaded), but stay defensive rather than fail the migration.
UPDATE public.menu_items SET name = 'Untitled dish' WHERE name IS NULL;

ALTER TABLE public.menu_items ALTER COLUMN name SET NOT NULL;

-- A dish may now exist without a recipe.
ALTER TABLE public.menu_items ALTER COLUMN recipe_id DROP NOT NULL;

-- Deleting a recipe must not silently strip a dish off the menu: the spec calls
-- for blocking the delete and offering to convert affected dishes to 'manual'.
ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_recipe_id_fkey;
ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_recipe_id_fkey
  FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE RESTRICT;

ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_allergen_source_check;
ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_allergen_source_check
  CHECK (allergen_source IN ('recipe', 'manual'));

-- A recipe-backed dish must point at a recipe.
ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_recipe_source_check;
ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_recipe_source_check
  CHECK (allergen_source <> 'recipe' OR recipe_id IS NOT NULL);

-- A declared dish is worthless as evidence without a named attester: hard block.
ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_attestation_check;
ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_attestation_check
  CHECK (allergen_source <> 'manual' OR (attested_by_name IS NOT NULL AND attested_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_menu_items_business_source ON public.menu_items (business_id, allergen_source);
CREATE INDEX IF NOT EXISTS idx_menu_items_recipe ON public.menu_items (recipe_id);
