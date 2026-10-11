import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planDocuments, planTeam, buildCorrective } from "./scope.ts";
import { periodFor } from "./aggregate.ts";

Deno.test("only documents open to everyone reach the plan", () => {
  const rows = [
    { id: "1", title: "Pest contract", category: "contract", access_level: "all" },
    { id: "2", title: "Disciplinary — J. Smith", category: "contract", access_level: "owner_only" },
    { id: "3", title: "Manager notes", category: "policy", access_level: "managers_only" },
    { id: "4", title: "Custom", category: "policy", access_level: "custom" },
    { id: "5", title: "Legacy", category: "training", access_level: null },
  ];
  assertEquals(planDocuments(rows), [
    { id: "1", title: "Pest contract", category: "contract" },
    { id: "5", title: "Legacy", category: "training" },
  ]);
});

Deno.test("only owners and managers reach the plan's team list", () => {
  assertEquals(planTeam([
    { id: "a", full_name: "Emma", role: "owner" },
    { id: "b", full_name: "Sam", role: "staff" },
    { id: "c", full_name: "Tom", role: "manager" },
  ]), [{ id: "a", full_name: "Emma", role: "owner" }, { id: "c", full_name: "Tom", role: "manager" }]);
});

Deno.test("corrective log keeps only flagged responses inside the 28-day period, newest first, max 20", () => {
  const tz = "Europe/London";
  const p = periodFor(new Date("2026-10-11T09:00:00Z"), tz);
  const c = (at: string, flagged: boolean) => ({
    template_id: "t", completed_at: at, completed_by_profile: { full_name: "Tom" },
    responses: [{ flagged, corrective_status: "done", value: "9", notes: null, item: { name: "Fridge" } }],
  });
  const out = buildCorrective([
    c("2026-10-11T07:00:00Z", true),  // today — outside period
    c("2026-10-10T07:00:00Z", true),
    c("2026-10-09T07:00:00Z", false),
    c("2026-09-12T07:00:00Z", true),  // before period
    c("2026-09-13T07:00:00Z", true),
  ], new Map([["t", "Fridge temps"]]), p.dates, tz);
  assertEquals(out.map((x) => x.at), ["2026-10-10T07:00:00Z", "2026-09-13T07:00:00Z"]);
  assertEquals(out[0], { at: "2026-10-10T07:00:00Z", template: "Fridge temps", item: "Fridge", value: "9", notes: null, status: "done", by: "Tom" });
  const many = Array.from({ length: 30 }, (_, i) => c(`2026-10-0${(i % 9) + 1}T07:${String(i).padStart(2, "0")}:00Z`, true));
  assertEquals(buildCorrective(many, new Map(), p.dates, tz).length, 20);
});

Deno.test("haccp-plan is deployed without gateway JWT verification", async () => {
  const toml = await Deno.readTextFile(new URL("../../../config.toml", import.meta.url));
  const block = toml.split("[functions.haccp-plan]")[1] ?? "";
  assertEquals(/^\s*verify_jwt\s*=\s*false/m.test(block.split("[")[0]), true);
});
