import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { periodFor, localDate, initials, aggregateTemplates, aggregateDeliveries } from "./aggregate.ts";

const TZ = "Europe/London";

Deno.test("period is the 28 local days ending yesterday", () => {
  const p = periodFor(new Date("2026-10-11T09:00:00Z"), TZ);
  assertEquals(p.dates.length, 28);
  assertEquals(p.start, "2026-09-13");
  assertEquals(p.end, "2026-10-10");
});

Deno.test("local dates respect BST and the 25 Oct 2026 change to GMT", () => {
  assertEquals(localDate("2026-10-24T23:30:00Z", TZ), "2026-10-25"); // BST: 00:30 next day
  assertEquals(localDate("2026-10-25T23:30:00Z", TZ), "2026-10-25"); // GMT after the change
  assertEquals(localDate("2026-09-30T23:10:00Z", TZ), "2026-10-01");
});

Deno.test("initials", () => {
  assertEquals(initials("Tom Achton"), "TA");
  assertEquals(initials("priya"), "P");
  assertEquals(initials(null), null);
});

Deno.test("day status precedence and counts", () => {
  const p = periodFor(new Date("2026-10-11T09:00:00Z"), TZ);
  const t = [{ id: "t1", name: "Fridge", library_key: "fridge_temps", sfbb_section: "temperature", frequency: "daily" }];
  const c = [
    { template_id: "t1", completed_at: "2026-10-10T07:30:00Z", by_name: "Tom Achton", responses: [{ flagged: false, corrective_status: null, item_type: "temperature" }] },
    { template_id: "t1", completed_at: "2026-10-09T07:30:00Z", by_name: "Priya Kaur", responses: [{ flagged: true, corrective_status: "done", item_type: "temperature" }] },
    { template_id: "t1", completed_at: "2026-10-08T07:30:00Z", by_name: "Tom Achton", responses: [{ flagged: true, corrective_status: "needed", item_type: "temperature" }, { flagged: false, corrective_status: null, item_type: "yes_no" }] },
  ];
  const inst = [{ template_id: "t1", due_date: "2026-10-07", status: "missed" }];
  const [r] = aggregateTemplates(t, c, inst, p.dates, TZ);
  assertEquals(r.days.slice(-4), ["missed", "flagged", "corrected", "ok"]);
  assertEquals([r.completions, r.flagged, r.corrected, r.readings], [3, 2, 1, 3]);
  assertEquals(r.initials, ["TA", "PK"]);
  assertEquals(r.lastCompletedAt, "2026-10-10T07:30:00Z");
});

Deno.test("deliveries out of range: chilled > 5, frozen > -15", () => {
  const p = periodFor(new Date("2026-10-11T09:00:00Z"), TZ);
  const d = aggregateDeliveries([
    { received_at: "2026-10-10T08:15:00Z", product_temperature: 3.8, frozen: false },
    { received_at: "2026-10-10T10:05:00Z", product_temperature: 9.2, frozen: false },
    { received_at: "2026-10-09T10:05:00Z", product_temperature: -12, frozen: true },
    { received_at: "2026-10-08T10:05:00Z", product_temperature: null, frozen: false },
  ], p.dates, TZ);
  assertEquals([d.count, d.outOfRange], [4, 2]);
  assertEquals(d.days.slice(-3), ["ok", "flagged", "flagged"]);
});
