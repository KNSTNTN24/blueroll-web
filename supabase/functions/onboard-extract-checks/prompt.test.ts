import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildChecksPrompt } from "./prompt.ts";
import { parseDataUrl } from "./_content.ts";

Deno.test("checks prompt constrains item_type + frequency + JSON array", () => {
  const p = buildChecksPrompt();
  for (const t of ["tick", "temperature", "text", "yes_no", "photo", "initials"]) {
    if (!p.includes(t)) throw new Error("missing " + t);
  }
  if (!p.includes("four_weekly")) throw new Error("missing frequency set");
  if (!p.includes('"checklists"')) throw new Error("must return checklists array");
});

Deno.test("parseDataUrl: splits a base64 data URL into media_type + data", () => {
  const out = parseDataUrl("data:image/png;base64,AAAA");
  assertEquals(out, { media_type: "image/png", data: "AAAA" });
});
