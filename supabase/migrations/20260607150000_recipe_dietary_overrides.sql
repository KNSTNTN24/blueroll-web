-- Dietary tri-state overrides (spec 2026-06-07 v-next, item 1).
-- NULL = auto-compute from ingredient allergens (current behaviour);
-- true/false = explicit user override. Resolution: effective = override ?? computed.
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS vegan_override        boolean,
  ADD COLUMN IF NOT EXISTS vegetarian_override   boolean,
  ADD COLUMN IF NOT EXISTS gluten_free_override  boolean,
  ADD COLUMN IF NOT EXISTS dairy_free_override   boolean;
