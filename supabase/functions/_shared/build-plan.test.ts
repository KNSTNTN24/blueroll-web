/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPlan } from "./build-plan.ts";
const roles = [
  { id:"r-mgr", base_tier:"manager" }, { id:"r-kit", base_tier:"kitchen_staff" },
  { id:"r-foh", base_tier:"front_of_house" }, { id:"r-chef", base_tier:"chef" }, { id:"r-own", base_tier:"owner" },
];
Deno.test("template: empty roles → fallback + role_id backfill from base_tier", () => {
  const out = buildPlan({ businessId:"b1", siteId:"s1", roles, dishes:[],
    checklists:[{ name:"Opening", assigned_roles:[], items:[{name:"Fridge 1", item_type:"temperature", max_value:5, unit:"°C"}] }] }, "2026-01-01T00:00:00Z");
  const t = out.templates[0];
  assertEquals(t.assigned_roles, ["manager","kitchen_staff","front_of_house"]);
  assertEquals(new Set(t.assigned_role_ids), new Set(["r-mgr","r-kit","r-foh"]));
  assertEquals(t.items[0].sort_order, 0);
});
Deno.test("item_type: unknown coerced to 'text'", () => {
  const out = buildPlan({ businessId:"b1", siteId:"s1", roles, dishes:[],
    checklists:[{ name:"X", assigned_roles:["manager"], items:[{name:"note", item_type:"dropdown"}] }] }, "2026-01-01T00:00:00Z");
  assertEquals(out.templates[0].items[0].item_type, "text");
});
Deno.test("menu item: allergens normalized + pending attestation", () => {
  const out = buildPlan({ businessId:"b1", siteId:"s1", roles, checklists:[],
    dishes:[{ name:"Prawn Crackers", category:"Small Plates", allergens:["Crustaceans","Soya"] }] }, "2026-01-01T00:00:00Z");
  const m = out.menuItems[0];
  assertEquals(m.declared_allergens, ["crustaceans","soybeans"]);
  assertEquals(m.allergen_source, "manual");
  assertEquals(m.attested_by_name, "Imported — pending owner verification");
  assertEquals(out.categories, ["Small Plates"]);
});
