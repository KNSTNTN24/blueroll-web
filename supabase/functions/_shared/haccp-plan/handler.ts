// Request → auth mode → PlanBundle. All I/O is injected so the rules are testable.
//   token mode:  ?t=<43-char token>  → sha256 → haccp_plan_shares (live, not revoked)
//   member mode: Authorization: Bearer <user JWT> + site_id → profile/site visibility check

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface ShareRow {
  id: string;
  business_id: string;
  site_id: string | null;
  kind: "inspector" | "pdf";
  expires_at: string;
  revoked_at: string | null;
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
  req: { method: string; token: string | null; authorization: string | null; siteId: string | null | undefined },
  deps: HandlerDeps,
): Promise<HandlerResult> {
  try {
    if (req.token !== null) {
      if (!TOKEN_RE.test(req.token)) return { status: 404, body: { error: "not_found" } };
      const share = await deps.findShare(await deps.sha256Hex(req.token));
      if (!share || share.revoked_at || new Date(share.expires_at).getTime() <= deps.now().getTime()) {
        return { status: 404, body: { error: "expired" } };
      }
      const bundle = await deps.loadBundle(share.business_id, share.site_id);
      if (share.kind === "inspector") await deps.bumpShare(share.id);
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
