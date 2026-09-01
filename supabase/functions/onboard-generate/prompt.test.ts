import { buildGeneratePrompt } from "./prompt.ts";
Deno.test("generate prompt constrains item_type, frequency, one-temp-per-unit, JSON array", () => {
  const p = buildGeneratePrompt();
  for (const t of ["tick","temperature","text","yes_no","photo","initials"]) if (!p.includes(t)) throw new Error("missing "+t);
  if (!p.includes("four_weekly")) throw new Error("missing frequency set");
  if (!p.includes('"checklists"')) throw new Error("must return checklists array");
  if (!p.toLowerCase().includes("one temperature")) throw new Error("missing one-temp-per-unit rule");
});
