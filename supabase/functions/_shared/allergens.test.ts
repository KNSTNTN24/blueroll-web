/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeAllergens, EU_ALLERGENS } from "./allergens.ts";
Deno.test("maps guide labels to canonical keys", () => {
  assertEquals(normalizeAllergens(["Soya","Cereals containing gluten","Sulphite"]), ["gluten","soybeans","sulphites"]);
});
Deno.test("drops unknowns, dedupes, orders canonically", () => {
  assertEquals(normalizeAllergens(["Nuts","banana","nuts","Milk"]), ["milk","nuts"]);
});
Deno.test("has exactly 14 allergens", () => { assertEquals(EU_ALLERGENS.length, 14); });
