import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPlan } from "../_shared/build-plan.ts";
import { shapeMenuItemForUpsert, splitTemplateForUpsert } from "./upserts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "BlueRoll <noreply@blueroll.app>";
const RESEND_FALLBACK_FROM = "BlueRoll <onboarding@resend.dev>";
const FEEDBACK_TO = Deno.env.get("FEEDBACK_TO") ?? "hello@blueroll.app";

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

// deno-lint-ignore no-explicit-any
type AdminClient = any;

/** Idempotently writes one checklist template + its items, keyed by (business_id, name). */
async function upsertTemplate(
  admin: AdminClient,
  businessId: string,
  templateRow: Parameters<typeof splitTemplateForUpsert>[0],
): Promise<void> {
  const { parent, itemsFor } = splitTemplateForUpsert(templateRow);

  const { data: existing, error: existingError } = await admin
    .from("checklist_templates")
    .select("id")
    .eq("business_id", businessId)
    .eq("name", parent.name)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Failed to look up template "${parent.name}": ${existingError.message}`);
  }

  let templateId: string;
  if (existing?.id) {
    templateId = existing.id;
    const { error: updateError } = await admin
      .from("checklist_templates")
      .update(parent)
      .eq("id", templateId);
    if (updateError) throw new Error(`Failed to update template "${parent.name}": ${updateError.message}`);

    const { error: deleteItemsError } = await admin
      .from("checklist_template_items")
      .delete()
      .eq("template_id", templateId);
    if (deleteItemsError) {
      throw new Error(`Failed to clear items for template "${parent.name}": ${deleteItemsError.message}`);
    }
  } else {
    const { data: inserted, error: insertError } = await admin
      .from("checklist_templates")
      .insert(parent)
      .select("id")
      .single();
    if (insertError || !inserted) {
      throw new Error(`Failed to insert template "${parent.name}": ${insertError?.message ?? "unknown error"}`);
    }
    templateId = inserted.id;
  }

  const items = itemsFor(templateId);
  if (items.length === 0) return;
  const { error: insertItemsError } = await admin.from("checklist_template_items").insert(items);
  if (insertItemsError) {
    throw new Error(`Failed to insert items for template "${parent.name}": ${insertItemsError.message}`);
  }
}

/** Idempotently resolves-or-creates a menu_categories row keyed by (site_id, lower(name)). */
async function resolveMenuCategoryId(admin: AdminClient, businessId: string, siteId: string, name: string): Promise<string> {
  const { data: existing, error: existingError } = await admin
    .from("menu_categories")
    .select("id")
    .eq("site_id", siteId)
    .ilike("name", name)
    .maybeSingle();
  if (existingError) throw new Error(`Failed to look up menu category "${name}": ${existingError.message}`);
  if (existing?.id) return existing.id;

  const { data: inserted, error } = await admin
    .from("menu_categories")
    .insert({ business_id: businessId, site_id: siteId, name })
    .select("id")
    .single();
  if (error || !inserted) throw new Error(`Failed to create menu category "${name}": ${error?.message ?? "unknown error"}`);
  return inserted.id;
}

/** Idempotently writes one menu item, keyed by (business_id, name). */
async function upsertMenuItem(
  admin: AdminClient,
  businessId: string,
  menuItemRow: Parameters<typeof shapeMenuItemForUpsert>[0],
  categoryIdBySiteId: Record<string, string>,
): Promise<void> {
  const row = shapeMenuItemForUpsert(menuItemRow, categoryIdBySiteId);

  const { data: existing, error: existingError } = await admin
    .from("menu_items")
    .select("id, site_categories")
    .eq("business_id", businessId)
    .eq("name", row.name)
    .maybeSingle();
  if (existingError) throw new Error(`Failed to look up menu item "${row.name}": ${existingError.message}`);

  if (existing?.id) {
    const mergedSiteCategories = { ...(existing.site_categories ?? {}), ...categoryIdBySiteId };
    const { error } = await admin
      .from("menu_items")
      .update({ ...row, site_categories: mergedSiteCategories })
      .eq("id", existing.id);
    if (error) throw new Error(`Failed to update menu item "${row.name}": ${error.message}`);
    return;
  }

  const { error } = await admin.from("menu_items").insert(row);
  if (error) throw new Error(`Failed to insert menu item "${row.name}": ${error.message}`);
}

async function notify(businessName: string, templateCount: number, dishCount: number): Promise<void> {
  const subject = `[Blueroll] Onboarding build complete — ${businessName}`;
  const html = `<!doctype html><html><body style="font-family:sans-serif">
    <p><strong>${businessName}</strong> completed the onboarding assistant build.</p>
    <ul>
      <li>${templateCount} checklist template(s) built</li>
      <li>${dishCount} dish(es) imported</li>
    </ul>
    <p><a href="https://app.blueroll.app">Open Blueroll</a></p>
  </body></html>`;
  const text = `${businessName} completed the onboarding assistant build.\n${templateCount} checklist template(s) built\n${dishCount} dish(es) imported\nhttps://app.blueroll.app`;

  const send = (from: string) => fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [FEEDBACK_TO], subject, html, text }),
  });

  let res = await send(RESEND_FROM);
  if (!res.ok && res.status === 403 && RESEND_FROM !== RESEND_FALLBACK_FROM) {
    res = await send(RESEND_FALLBACK_FROM);
  }
  if (!res.ok) {
    console.error("onboard-build: notify email failed", res.status, await res.text().catch(() => ""));
  }
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
    const body = await req.json().catch(() => ({}));
    const checklists = Array.isArray(body.checklists) ? body.checklists : [];
    const dishes = Array.isArray(body.dishes) ? body.dishes : [];

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, business_id, site_id")
      .eq("id", authData.user.id)
      .single();
    if (profileError || !profile?.business_id) return json({ error: "Profile or business not found" }, 400);

    const businessId: string = profile.business_id;
    let resolvedSiteId: string | null = profile.site_id ?? null;
    if (!resolvedSiteId) {
      const { data: earliestSite, error: siteError } = await admin
        .from("sites")
        .select("id")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (siteError || !earliestSite) return json({ error: "No site found for business" }, 400);
      resolvedSiteId = earliestSite.id as string;
    }
    const siteId: string = resolvedSiteId;

    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("id, name")
      .eq("id", businessId)
      .single();
    if (businessError || !business) return json({ error: "Business not found" }, 400);

    const { data: roles, error: rolesError } = await admin
      .from("roles")
      .select("id, base_tier")
      .eq("business_id", businessId);
    if (rolesError) return json({ error: "Failed to load roles" }, 500);

    const plan = buildPlan(
      { businessId, siteId, roles: roles ?? [], checklists, dishes },
      new Date().toISOString(),
    );

    for (const templateRow of plan.templates) {
      await upsertTemplate(admin, businessId, templateRow);
    }

    // Phase 2 — unexercised in v1 (dishes always sent as []): resolve/create menu
    // categories, then upsert menu items keyed by (business_id, name).
    const categoryIdByName: Record<string, string> = {};
    for (const categoryName of plan.categories) {
      categoryIdByName[categoryName.toLowerCase()] = await resolveMenuCategoryId(
        admin,
        businessId,
        siteId,
        categoryName,
      );
    }
    for (const menuItemRow of plan.menuItems) {
      const categoryId = categoryIdByName[menuItemRow.category.toLowerCase()];
      const categoryIdBySiteId = categoryId ? { [siteId]: categoryId } : {};
      await upsertMenuItem(admin, businessId, menuItemRow, categoryIdBySiteId);
    }

    try {
      await notify(business.name, plan.templates.length, plan.menuItems.length);
    } catch (notifyError) {
      console.error("onboard-build: notify threw", notifyError);
    }

    return json({ templates: plan.templates.length, dishes: plan.menuItems.length });
  } catch (error) {
    console.error("onboard-build error", error);
    return json({ error: error instanceof Error ? error.message : "Failed to build onboarding plan" }, 500);
  }
});
