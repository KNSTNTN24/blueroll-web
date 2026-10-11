import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideAccess, handlePlanRequest, type HandlerDeps } from "./handler.ts";

const TOKEN = "a".repeat(43);
function deps(over: Partial<HandlerDeps> = {}): HandlerDeps & { bumped: string[] } {
  const bumped: string[] = [];
  return {
    bumped,
    now: () => new Date("2026-10-11T09:00:00Z"),
    sha256Hex: async (s) => `h:${s}`,
    findShare: async () => ({ id: "s1", business_id: "b1", site_id: "site1", kind: "inspector", expires_at: "2026-10-18T09:00:00Z", revoked_at: null }),
    bumpShare: async (id) => { bumped.push(id); },
    getUserId: async (jwt) => (jwt === "good" ? "u1" : null),
    memberAccess: async (_u, site) => (site === "site1" ? { businessId: "b1", canManage: true } : "forbidden"),
    loadBundle: async (b, s) => ({ business: { id: b }, site: { id: s } }),
    ...over,
  };
}

Deno.test("token: valid inspector link returns bundle and counts the view", async () => {
  const d = deps();
  const r = await handlePlanRequest({ method: "GET", token: TOKEN, authorization: null, siteId: null }, d);
  assertEquals(r.status, 200);
  assertEquals((r.body as any).share, { kind: "inspector", expiresAt: "2026-10-18T09:00:00Z" });
  assertEquals((r.body as any).viewer, null);
  assertEquals(d.bumped, ["s1"]);
});

Deno.test("token: pdf tokens count their loads", async () => {
  const d = deps({ findShare: async () => ({ id: "s2", business_id: "b1", site_id: null, kind: "pdf", expires_at: "2026-10-11T09:05:00Z", revoked_at: null }) });
  const r = await handlePlanRequest({ method: "GET", token: TOKEN, authorization: null, siteId: null }, d);
  assertEquals(r.status, 200);
  assertEquals(d.bumped, ["s2"]);
});

Deno.test("token: expired, revoked, unknown and malformed are 404 and load nothing", async () => {
  let loads = 0;
  const base = { loadBundle: async () => { loads++; return {}; } };
  const cases: Partial<HandlerDeps>[] = [
    { ...base, findShare: async () => ({ id: "s", business_id: "b", site_id: null, kind: "inspector", expires_at: "2026-10-11T08:59:59Z", revoked_at: null }) },
    { ...base, findShare: async () => ({ id: "s", business_id: "b", site_id: null, kind: "inspector", expires_at: "2026-10-18T00:00:00Z", revoked_at: "2026-10-10T00:00:00Z" }) },
    { ...base, findShare: async () => null },
  ];
  for (const c of cases) assertEquals((await handlePlanRequest({ method: "GET", token: TOKEN, authorization: null, siteId: null }, deps(c))).status, 404);
  assertEquals((await handlePlanRequest({ method: "GET", token: "short", authorization: null, siteId: null }, deps(base))).status, 404);
  assertEquals(loads, 0);
});

Deno.test("member: 401 without or with a bad JWT, 403 for a site the user cannot see", async () => {
  assertEquals((await handlePlanRequest({ method: "POST", token: null, authorization: null, siteId: "site1" }, deps())).status, 401);
  assertEquals((await handlePlanRequest({ method: "POST", token: null, authorization: "Bearer bad", siteId: "site1" }, deps())).status, 401);
  assertEquals((await handlePlanRequest({ method: "POST", token: null, authorization: "Bearer good", siteId: "other" }, deps())).status, 403);
});

Deno.test("member: ok returns viewer", async () => {
  const r = await handlePlanRequest({ method: "POST", token: null, authorization: "Bearer good", siteId: "site1" }, deps());
  assertEquals(r.status, 200);
  assertEquals((r.body as any).viewer, { canManage: true, userId: "u1" });
  assertEquals((r.body as any).share, null);
});

Deno.test("errors become 500 without leaking", async () => {
  const r = await handlePlanRequest({ method: "POST", token: null, authorization: "Bearer good", siteId: "site1" }, deps({ loadBundle: async () => { throw new Error("db down"); } }));
  assertEquals(r, { status: 500, body: { error: "internal" } });
});

Deno.test("token check mode validates without loading or counting", async () => {
  let loads = 0;
  const d = deps({ loadBundle: async () => { loads++; return {}; } });
  const r = await handlePlanRequest({ method: "GET", token: TOKEN, authorization: null, siteId: null, check: true }, d);
  assertEquals(r, { status: 200, body: { ok: true, kind: "inspector" } });
  assertEquals(loads, 0);
  assertEquals(d.bumped, []);
});

Deno.test("pdf tokens are limited to a few loads", async () => {
  const d = deps({ findShare: async () => ({ id: "p", business_id: "b1", site_id: null, kind: "pdf", expires_at: "2026-10-11T09:05:00Z", revoked_at: null, view_count: 3 }) });
  const r = await handlePlanRequest({ method: "GET", token: TOKEN, authorization: null, siteId: null }, d);
  assertEquals(r.status, 404);
  const ok = deps({ findShare: async () => ({ id: "p", business_id: "b1", site_id: null, kind: "pdf", expires_at: "2026-10-11T09:05:00Z", revoked_at: null, view_count: 0 }) });
  assertEquals((await handlePlanRequest({ method: "GET", token: TOKEN, authorization: null, siteId: null }, ok)).status, 200);
  assertEquals(ok.bumped, ["p"]);
});

Deno.test("decideAccess: site-restricted members cannot use the business-wide (null site) view", () => {
  const base = { business_id: "b1", role: "staff", removed_at: null, is_group_admin: false };
  assertEquals(decideAccess(base, null, ["site-a"]), "forbidden");
  assertEquals(decideAccess(base, null, []), { businessId: "b1", canManage: false });
  assertEquals(decideAccess({ ...base, is_group_admin: true }, null, ["site-a"]), { businessId: "b1", canManage: false });
  assertEquals(decideAccess(base, { id: "site-b", inBusiness: true }, ["site-a"]), "forbidden");
  assertEquals(decideAccess(base, { id: "site-a", inBusiness: true }, ["site-a"]), { businessId: "b1", canManage: false });
  assertEquals(decideAccess({ ...base, role: "manager" }, { id: "x", inBusiness: false }, []), "forbidden");
  assertEquals(decideAccess({ ...base, removed_at: "2026-01-01" }, null, []), "forbidden");
  assertEquals(decideAccess(null, null, []), "forbidden");
});
