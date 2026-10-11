// Request → auth mode → PlanBundle. All I/O is injected so the rules are testable.
//   token mode:  ?t=<43-char token>  → sha256 → haccp_plan_shares (live, not revoked)
//   member mode: Authorization: Bearer <user JWT> + site_id → profile/site visibility check

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** A PDF render token is good for a handful of page loads (Chromium retries), then it is spent. */
export const PDF_MAX_LOADS = 3;

export interface ShareRow {
  id: string;
  business_id: string;
  site_id: string | null;
  kind: "inspector" | "pdf";
  expires_at: string;
  revoked_at: string | null;
  view_count?: number;
}

export interface ProfileRow { business_id: string | null; role: string | null; removed_at: string | null; is_group_admin: boolean | null }

/**
 * Same visibility rule as can_see_site_row(): group admins and members with no
 * member_sites rows see every site; everyone else only their own sites. The
 * business-wide (null site) view is limited to people who can see every site.
 */
export function decideAccess(
  p: ProfileRow | null,
  site: { id: string; inBusiness: boolean } | null,
  memberSiteIds: string[],
): { businessId: string; canManage: boolean } | "forbidden" {
  if (!p || !p.business_id || p.removed_at) return "forbidden";
  const canManage = p.role === "owner" || p.role === "manager";
  const seesAll = !!p.is_group_admin || memberSiteIds.length === 0;
  if (!site) return seesAll ? { businessId: p.business_id, canManage } : "forbidden";
  if (!site.inBusiness) return "forbidden";
  if (!seesAll && !memberSiteIds.includes(site.id)) return "forbidden";
  return { businessId: p.business_id, canManage };
}

export interface HandlerDeps {
  now: () => Date;
  sha256Hex: (s: string) => Promise<string>;
  findShare: (hash: string) => Promise<ShareRow | null>;
  bumpShare: (id: string) => Promise<void>;
  getUserId: (jwt: string) => Promise<string | null>;
  memberAccess: (userId: string, siteId: string | null) => Promise<{ businessId: string; canManage: boolean } | "forbidden">;
  loadBundle: (businessId: string, siteId: string | null) => Promise<Record<string, unknown>>;
}

export type HandlerResult = { status: number; body: unknown };

export async function handlePlanRequest(
  req: { method: string; token: string | null; authorization: string | null; siteId: string | null | undefined; check?: boolean },
  deps: HandlerDeps,
): Promise<HandlerResult> {
  try {
    if (req.token !== null) {
      if (!TOKEN_RE.test(req.token)) return { status: 404, body: { error: "not_found" } };
      const share = await deps.findShare(await deps.sha256Hex(req.token));
      if (!share || share.revoked_at || new Date(share.expires_at).getTime() <= deps.now().getTime()) {
        return { status: 404, body: { error: "expired" } };
      }
      // Validity probe (PDF route pre-check): no data, no view counted.
      if (req.check) return { status: 200, body: { ok: true, kind: share.kind } };
      if (share.kind === "pdf" && (share.view_count ?? 0) >= PDF_MAX_LOADS) return { status: 404, body: { error: "expired" } };
      const bundle = await deps.loadBundle(share.business_id, share.site_id);
      await deps.bumpShare(share.id);
      return { status: 200, body: { ...bundle, share: { kind: share.kind, expiresAt: share.expires_at }, viewer: null } };
    }

    const m = /^Bearer\s+(.+)$/i.exec(req.authorization ?? "");
    if (!m) return { status: 401, body: { error: "unauthorized" } };
    const userId = await deps.getUserId(m[1]);
    if (!userId) return { status: 401, body: { error: "unauthorized" } };
    const access = await deps.memberAccess(userId, req.siteId ?? null);
    if (access === "forbidden") return { status: 403, body: { error: "forbidden" } };
    const bundle = await deps.loadBundle(access.businessId, req.siteId ?? null);
    return { status: 200, body: { ...bundle, share: null, viewer: { canManage: access.canManage, userId } } };
  } catch (e) {
    console.error("[haccp-plan]", e instanceof Error ? e.message : e);
    return { status: 500, body: { error: "internal" } };
  }
}
