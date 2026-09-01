/// <reference lib="deno.ns" />
// upserts.test.ts — pure helper that turns a TemplateRow into the template-insert + items-insert payloads
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { splitTemplateForUpsert } from "./upserts.ts";
Deno.test("splits template row into parent + child item rows keyed by template id", () => {
  const { parent, itemsFor } = splitTemplateForUpsert({ business_id:"b", site_id:"s", name:"Opening",
    frequency:"daily", assigned_roles:["manager"], assigned_role_ids:["r1"],
    items:[{name:"Fridge 1", item_type:"temperature", required:true, sort_order:0, min_value:null, max_value:5, unit:"°C"}] });
  assertEquals(parent.name, "Opening");
  assertEquals(itemsFor("tmpl-123")[0].template_id, "tmpl-123");
});
