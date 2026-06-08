-- Atomic recipe + ingredients creation (spec 2026-06-07 v-next, item 6).
-- Replaces the clients' fragile 3-step save (recipe insert -> per-ingredient
-- find-or-create -> join rows): a mid-sequence failure used to leave a
-- half-created recipe and surface an error. All-or-nothing here.
-- SECURITY DEFINER; caller is validated the same way the "Chefs can manage
-- recipes" RLS policy does (owner/manager/chef of their own business).
CREATE OR REPLACE FUNCTION public.create_recipe_with_ingredients(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_business uuid;
  v_role text;
  v_recipe_id uuid;
  v_ing record;
  v_ing_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT business_id, role INTO v_business, v_role
    FROM public.profiles WHERE id = v_user;
  IF v_business IS NULL THEN
    RAISE EXCEPTION 'User has no business';
  END IF;
  IF v_role NOT IN ('owner','manager','chef') THEN
    RAISE EXCEPTION 'Only owner/manager/chef can create recipes';
  END IF;
  IF COALESCE(p->'recipe'->>'name','') = '' THEN
    RAISE EXCEPTION 'Recipe name is required';
  END IF;

  INSERT INTO public.recipes (
    business_id, created_by, name, description, category, instructions,
    cooking_method, cooking_temp, cooking_time, cooking_time_unit,
    reheating_instructions, hot_holding_required, chilling_method,
    freezing_instructions, defrosting_instructions, haccp_methods,
    vegan_override, vegetarian_override, gluten_free_override, dairy_free_override
  ) VALUES (
    v_business, v_user,
    p->'recipe'->>'name',
    p->'recipe'->>'description',
    COALESCE(p->'recipe'->>'category', 'other'),
    COALESCE(p->'recipe'->>'instructions', ''),
    p->'recipe'->>'cooking_method',
    (p->'recipe'->>'cooking_temp')::numeric,
    (p->'recipe'->>'cooking_time')::numeric,
    p->'recipe'->>'cooking_time_unit',
    p->'recipe'->>'reheating_instructions',
    COALESCE((p->'recipe'->>'hot_holding_required')::boolean, false),
    p->'recipe'->>'chilling_method',
    p->'recipe'->>'freezing_instructions',
    p->'recipe'->>'defrosting_instructions',
    COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(
        COALESCE(p->'recipe'->'haccp_methods', '[]'::jsonb)) x), '{}'),
    (p->'recipe'->>'vegan_override')::boolean,
    (p->'recipe'->>'vegetarian_override')::boolean,
    (p->'recipe'->>'gluten_free_override')::boolean,
    (p->'recipe'->>'dairy_free_override')::boolean
  ) RETURNING id INTO v_recipe_id;

  FOR v_ing IN
    SELECT * FROM jsonb_to_recordset(COALESCE(p->'ingredients', '[]'::jsonb))
      AS t(name text, allergens text[], quantity text, unit text, notes text)
  LOOP
    CONTINUE WHEN COALESCE(v_ing.name, '') = '';
    SELECT id INTO v_ing_id FROM public.ingredients
     WHERE business_id = v_business AND lower(name) = lower(v_ing.name)
     LIMIT 1;
    IF v_ing_id IS NULL THEN
      INSERT INTO public.ingredients (business_id, name, allergens)
      VALUES (v_business, v_ing.name, COALESCE(v_ing.allergens, '{}'))
      RETURNING id INTO v_ing_id;
    END IF;
    INSERT INTO public.recipe_ingredients (recipe_id, ingredient_id, quantity, unit, notes)
    VALUES (v_recipe_id, v_ing_id, v_ing.quantity, v_ing.unit, v_ing.notes);
    v_ing_id := NULL;
  END LOOP;

  RETURN jsonb_build_object('recipe_id', v_recipe_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_recipe_with_ingredients(jsonb) TO authenticated;
