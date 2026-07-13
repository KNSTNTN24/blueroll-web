import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BRANDFETCH_CLIENT_ID = Deno.env.get("BRANDFETCH_CLIENT_ID");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeDomain(value: unknown) {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return domain && domain.length <= 253 ? domain : null;
}

function buildLogoUrl(icon: string) {
  try {
    const url = new URL(icon);
    if (url.hostname !== "cdn.brandfetch.io") return icon;
    const brandId = url.pathname.split("/").filter(Boolean)[0];
    const clientId = url.searchParams.get("c");
    if (!brandId || !clientId) return icon;
    return `https://cdn.brandfetch.io/${brandId}/w/256/h/128/fallback/404/logo.webp?c=${encodeURIComponent(clientId)}`;
  } catch {
    return icon;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!BRANDFETCH_CLIENT_ID) return json({ error: "Brand search is not configured" }, 503);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(authorization.slice(7));
  if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await admin
    .from("profiles")
    .select("business_id")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (!profile?.business_id) return json({ error: "Profile not found" }, 403);

  try {
    const body = await req.json();
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (query.length < 2 || query.length > 100) return json({ error: "Search must be between 2 and 100 characters" }, 400);

    const response = await fetch(
      `https://api.brandfetch.io/v2/search/${encodeURIComponent(query)}?c=${encodeURIComponent(BRANDFETCH_CLIENT_ID)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return json({ error: "Brand search is temporarily unavailable" }, response.status === 429 ? 429 : 502);

    const data = await response.json();
    const results = (Array.isArray(data) ? data : [])
      .map((item: Record<string, unknown>) => {
        const domain = normalizeDomain(item.domain);
        if (!domain) return null;
        const icon = typeof item.icon === "string" && item.icon.startsWith("https://") ? item.icon : null;
        if (!icon) return null;
        return {
          brandId: typeof item.brandId === "string" ? item.brandId : null,
          name: typeof item.name === "string" ? item.name : domain,
          domain,
          icon,
          logo: buildLogoUrl(icon),
          claimed: item.claimed === true,
        };
      })
      .filter(Boolean)
      .slice(0, 6);

    return json({ results });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Brand search failed" }, 500);
  }
});
