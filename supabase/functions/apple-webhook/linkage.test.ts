import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { candidateResolution, distinctBusinessIds, safeEventLog } from "../_shared/iap-linkage.ts";

Deno.test("Apple transaction A plus account B is a conflict", () => {
  assertEquals(candidateResolution(distinctBusinessIds(["A"], ["B"])), "conflict");
  assertEquals(candidateResolution(distinctBusinessIds(["A"], ["A"])), "matched");
});

Deno.test("Apple operational output contains no raw identifiers", () => {
  const output = JSON.stringify(safeEventLog({ provider: "apple", eventId: "n1", resolution: "matched", tokenHash: "sha256" }));
  assertEquals(output.includes("original-transaction"), false);
  assertEquals(output.includes("app-account-token"), false);
});
