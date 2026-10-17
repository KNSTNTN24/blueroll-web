import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { candidateResolution, distinctBusinessIds, safeEventLog } from "../_shared/iap-linkage.ts";

Deno.test("Google token A plus profile B is a conflict", () => {
  assertEquals(candidateResolution(distinctBusinessIds(["A"], ["B"])), "conflict");
  assertEquals(candidateResolution(distinctBusinessIds(["A"], ["A"])), "matched");
});

Deno.test("Google operational output contains no raw token", () => {
  const output = JSON.stringify(safeEventLog({ provider: "google", eventId: "m1", resolution: "unmatched", tokenHash: "sha256" }));
  assertEquals(output.includes("raw-play-token"), false);
});
