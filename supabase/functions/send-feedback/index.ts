import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "BlueRoll <noreply@blueroll.app>";
const RESEND_FALLBACK_FROM = "BlueRoll <onboarding@resend.dev>";
const FEEDBACK_TO = Deno.env.get("FEEDBACK_TO") ?? "hello@blueroll.app";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const kindLabels = {
  question: "Support question",
  feature: "Feature request",
  bug: "Bug report",
  feedback: "Product feedback",
} as const;

type FeedbackKind = keyof typeof kindLabels;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.slice(7);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json();
    const kind = body.kind as FeedbackKind;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const rating = body.rating == null ? null : Number(body.rating);
    const siteId = body.siteId == null ? null : body.siteId;
    const pageUrl = typeof body.pageUrl === "string" ? body.pageUrl.slice(0, 2000) : null;
    const pagePath = typeof body.pagePath === "string" ? body.pagePath.slice(0, 500) : null;
    const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {};

    if (!(kind in kindLabels)) return json({ error: "Invalid feedback type" }, 400);
    if (message.length < 5 || message.length > 4000) return json({ error: "Message must be between 5 and 4,000 characters" }, 400);
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return json({ error: "Invalid rating" }, 400);
    if (siteId !== null && !validUuid(siteId)) return json({ error: "Invalid site" }, 400);
    if (JSON.stringify(metadata).length > 10_000) return json({ error: "Context is too large" }, 400);

    const userId = authData.user.id;
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count } = await admin
      .from("feedback_requests")
      .select("id", { count: "exact", head: true })
      .eq("created_by", userId)
      .gte("created_at", oneMinuteAgo);
    if ((count ?? 0) >= 5) return json({ error: "Please wait before sending another message" }, 429);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, email, full_name, role, business_id")
      .eq("id", userId)
      .single();
    if (profileError || !profile?.business_id) return json({ error: "Profile not found" }, 403);

    const { data: business } = await admin
      .from("businesses")
      .select("id, name")
      .eq("id", profile.business_id)
      .single();
    if (!business) return json({ error: "Business not found" }, 403);

    let siteName: string | null = null;
    if (siteId) {
      const { data: site } = await admin
        .from("sites")
        .select("id, name, business_id")
        .eq("id", siteId)
        .eq("business_id", business.id)
        .maybeSingle();
      if (!site) return json({ error: "Site not found" }, 403);
      siteName = site.name;
    }

    const { data: requestRow, error: insertError } = await admin
      .from("feedback_requests")
      .insert({
        business_id: business.id,
        site_id: siteId,
        created_by: userId,
        kind,
        message,
        rating: kind === "feedback" ? rating : null,
        page_url: pageUrl,
        page_path: pagePath,
        metadata: { ...metadata, business_name: business.name, site_name: siteName },
      })
      .select("id, created_at")
      .single();
    if (insertError || !requestRow) return json({ error: "Could not save feedback" }, 500);

    const safePath = pagePath?.startsWith("/") && !pagePath.startsWith("//") ? pagePath : "/";
    const appUrl = `https://app.blueroll.app${safePath}`;
    const label = kindLabels[kind];
    const subject = `[Blueroll] ${label} — ${business.name}`;
    const ratingRow = rating === null ? "" : `<tr><td style="padding:6px 14px 6px 0;color:#8a9099">Rating</td><td style="padding:6px 0;font-weight:600">${rating}/5</td></tr>`;
    const siteRow = siteName ? `<tr><td style="padding:6px 14px 6px 0;color:#8a9099">Site</td><td style="padding:6px 0">${escapeHtml(siteName)}</td></tr>` : "";
    const browser = typeof metadata.user_agent === "string" ? metadata.user_agent : "Not provided";
    const viewport = typeof metadata.viewport === "string" ? metadata.viewport : "Not provided";
    const timezone = typeof metadata.timezone === "string" ? metadata.timezone : "Not provided";
    const html = `<!doctype html><html><body style="margin:0;background:#f5f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16181d">
      <div style="max-width:620px;margin:0 auto;padding:32px 18px">
        <div style="font-size:18px;font-weight:750;margin-bottom:18px;color:#1f7a52">Blueroll feedback</div>
        <div style="background:#fff;border:1px solid #e7e9ec;border-radius:16px;overflow:hidden">
          <div style="padding:24px 26px;border-bottom:1px solid #eceef0">
            <div style="display:inline-block;padding:5px 10px;border-radius:20px;background:#e9f4ee;color:#1f7a52;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(label)}</div>
            <h1 style="margin:14px 0 0;font-size:21px;line-height:1.35">${escapeHtml(business.name)}</h1>
          </div>
          <div style="padding:24px 26px">
            <div style="white-space:pre-wrap;font-size:15px;line-height:1.65">${escapeHtml(message)}</div>
            <table style="width:100%;margin-top:24px;padding-top:18px;border-top:1px solid #eceef0;font-size:13px;border-collapse:separate">
              <tr><td style="padding:6px 14px 6px 0;color:#8a9099;width:100px">From</td><td style="padding:6px 0;font-weight:600">${escapeHtml(profile.full_name || profile.email)}</td></tr>
              <tr><td style="padding:6px 14px 6px 0;color:#8a9099">Email</td><td style="padding:6px 0"><a href="mailto:${escapeHtml(profile.email)}" style="color:#1f7a52">${escapeHtml(profile.email)}</a></td></tr>
              <tr><td style="padding:6px 14px 6px 0;color:#8a9099">Role</td><td style="padding:6px 0">${escapeHtml(profile.role)}</td></tr>
              ${siteRow}${ratingRow}
              <tr><td style="padding:6px 14px 6px 0;color:#8a9099">Page</td><td style="padding:6px 0"><a href="${escapeHtml(appUrl)}" style="color:#1f7a52">${escapeHtml(pagePath || "/")}</a></td></tr>
              <tr><td style="padding:6px 14px 6px 0;color:#8a9099">Sent</td><td style="padding:6px 0">${escapeHtml(new Date(requestRow.created_at).toISOString())}</td></tr>
            </table>
          </div>
          <div style="padding:16px 26px;background:#fafbfb;border-top:1px solid #eceef0;font-size:11px;line-height:1.6;color:#8a9099">
            Browser: ${escapeHtml(browser)}<br>Viewport: ${escapeHtml(viewport)} · Timezone: ${escapeHtml(timezone)}
          </div>
        </div>
        <p style="margin:14px 4px 0;color:#9aa0a8;font-size:11px">Reply directly to this email to contact the user.</p>
      </div>
    </body></html>`;
    const text = `${label}\n\n${message}\n\nBusiness: ${business.name}\nSite: ${siteName ?? "All sites"}\nFrom: ${profile.full_name || profile.email} <${profile.email}>\nRole: ${profile.role}\nRating: ${rating ?? "Not provided"}\nPage: ${appUrl}\nRequest: ${requestRow.id}`;

    const send = (from: string, delivery: "primary" | "fallback") => fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `feedback-${requestRow.id}-${delivery}`,
      },
      body: JSON.stringify({
        from,
        to: [FEEDBACK_TO],
        reply_to: profile.email,
        subject,
        html,
        text,
        tags: [{ name: "category", value: "feedback" }, { name: "kind", value: kind }],
      }),
    });

    let resendResponse = await send(RESEND_FROM, "primary");
    let resendData = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok && resendResponse.status === 403 && RESEND_FROM !== RESEND_FALLBACK_FROM) {
      resendResponse = await send(RESEND_FALLBACK_FROM, "fallback");
      resendData = await resendResponse.json().catch(() => ({}));
    }

    if (!resendResponse.ok) {
      const emailError = String(resendData?.message || "Resend error").slice(0, 1000);
      await admin.from("feedback_requests").update({ email_status: "failed", email_error: emailError }).eq("id", requestRow.id);
      return json({ error: "Feedback was saved, but email delivery failed", requestId: requestRow.id }, 502);
    }

    await admin.from("feedback_requests").update({
      email_status: "sent",
      email_provider_id: resendData?.id ?? null,
      emailed_at: new Date().toISOString(),
      email_error: null,
    }).eq("id", requestRow.id);

    return json({ ok: true, requestId: requestRow.id });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Failed to send feedback" }, 500);
  }
});
