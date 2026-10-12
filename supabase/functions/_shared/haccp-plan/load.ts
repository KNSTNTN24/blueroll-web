// Loads everything the HACCP Plan document needs for one business + site, with the
// service-role client. Callers have already authorised access (handler.ts).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  aggregateDeliveries,
  aggregateTemplates,
  type CompletionRow,
  type InstanceRow,
  periodFor,
  type TemplateRow,
} from "./aggregate.ts";
import { buildCorrective, planDocuments, planTeam } from "./scope.ts";

const PAGE = 1000;
const FROZEN_GUESS_MAX = -5; // deliveries have no frozen flag: a reading at or below −5 °C is a frozen product

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function must<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

const shiftDate = (d: string, days: number) => new Date(Date.parse(d + "T00:00:00Z") + days * 86_400_000).toISOString();

export async function loadBundle(client: SupabaseClient, businessId: string, siteId: string | null, now: Date) {
  // PostgREST builder generics blow up tsc's instantiation depth on chained selects; rows are typed by hand below.
  // deno-lint-ignore no-explicit-any
  const admin: any = client;
  const business = must(await admin.from("businesses")
    .select("id, name, address, post_code, fsa_rating, haccp_auto_fill, haccp_last_reviewed_at")
    .eq("id", businessId).is("deleted_at", null).maybeSingle()) as Row | null;
  if (!business) throw new Error("business not found");

  let site: Row | null = null;
  if (siteId) {
    site = must(await admin.from("sites").select("id, name, address, postcode, fsa_rating, timezone, manager_id")
      .eq("id", siteId).eq("business_id", businessId).maybeSingle()) as Row | null;
    if (!site) throw new Error("site not in business");
  }
  const tz: string = site?.timezone || "Europe/London";
  const period = periodFor(now, tz);
  const fromIso = shiftDate(period.start, -1);
  const toIso = shiftDate(period.end, 2);
  // deno-lint-ignore no-explicit-any
  const bySite = (q: any) => (siteId ? q.eq("site_id", siteId) : q);

  let packQ = admin.from("haccp_pack_data").select("data, updated_at").eq("business_id", businessId);
  packQ = siteId ? packQ.eq("site_id", siteId) : packQ.is("site_id", null);
  const packRow = must(await packQ.maybeSingle()) as Row | null;
  const inner = (packRow?.data ?? {}) as Row;

  const signoff = siteId
    ? must(await admin.from("haccp_signoffs").select("signed_by_name, signed_at")
      .eq("business_id", businessId).eq("site_id", siteId).maybeSingle()) as Row | null
    : null;

  const [recipes, dishes, suppliers, templatesAll, documents, team] = await Promise.all([
    fetchAll((a, b) => admin.from("recipes").select(
      `id, name, cooking_method, cooking_temp, extra_care_flags, reheating_instructions, hot_holding_required,
       chilling_method, freezing_instructions, defrosting_instructions, haccp_methods,
       recipe_ingredients(ingredient:ingredients(name, allergens))`,
    ).eq("business_id", businessId).range(a, b)),
    fetchAll((a, b) => admin.from("menu_items").select(
      "id, name, category, active, allergen_source, recipe_id, declared_allergens, may_contain, dietary, attested_by_name, attested_at, site_ids, recipe:recipes(id, name, recipe_ingredients(ingredient:ingredients(name, allergens)))",
    ).eq("business_id", businessId).order("name").range(a, b)),
    fetchAll((a, b) => admin.from("suppliers").select("id, name, contact_name, phone, email, delivery_days").eq("business_id", businessId).range(a, b)),
    fetchAll((a, b) => admin.from("checklist_templates").select("id, name, frequency, sfbb_section, library_key, site_id, active").eq("business_id", businessId).range(a, b)),
    fetchAll((a, b) => admin.from("documents").select("id, title, category, access_level").eq("business_id", businessId).order("id").range(a, b)),
    fetchAll((a, b) => admin.from("profiles").select("id, full_name, role").eq("business_id", businessId).is("removed_at", null).range(a, b)),
  ]);

  const templates = templatesAll.filter((t) => t.active !== false && (!t.site_id || !siteId || t.site_id === siteId));
  const templateIds = templates.map((t) => t.id as string);
  const nameById = new Map(templates.map((t) => [t.id as string, t.name as string]));

  const [completions, instances, deliveries] = templateIds.length
    ? await Promise.all([
      fetchAll((a, b) => bySite(admin.from("checklist_completions").select(
        `id, template_id, completed_at,
         completed_by_profile:profiles!checklist_completions_completed_by_fkey(full_name),
         responses:checklist_responses(value, notes, flagged, corrective_status, item:checklist_template_items(name, item_type))`,
      ).eq("business_id", businessId).in("template_id", templateIds).gte("completed_at", fromIso).lt("completed_at", toIso))
        .order("completed_at", { ascending: false }).range(a, b)),
      fetchAll((a, b) => bySite(admin.from("checklist_instances").select("template_id, due_date, status")
        .eq("business_id", businessId).in("template_id", templateIds).gte("due_date", period.start).lte("due_date", period.end))
        .range(a, b)),
      fetchAll((a, b) => bySite(admin.from("deliveries").select("received_at, product_temperature")
        .eq("business_id", businessId).gte("received_at", fromIso).lt("received_at", toIso)).range(a, b)),
    ])
    : [[], [], await fetchAll((a, b) => bySite(admin.from("deliveries").select("received_at, product_temperature")
      .eq("business_id", businessId).gte("received_at", fromIso).lt("received_at", toIso)).range(a, b))];

  const completionRows: CompletionRow[] = completions.map((c) => ({
    template_id: c.template_id,
    completed_at: c.completed_at,
    by_name: c.completed_by_profile?.full_name ?? null,
    responses: (c.responses ?? []).map((r: Row) => ({ flagged: r.flagged, corrective_status: r.corrective_status, item_type: r.item?.item_type ?? null })),
  }));
  const templateRows: TemplateRow[] = templates.map((t) => ({
    id: t.id, name: t.name, library_key: t.library_key ?? null, sfbb_section: t.sfbb_section ?? null, frequency: t.frequency,
  }));

  const corrective = buildCorrective(completions as never[], nameById, period.dates, tz);

  const reviewIds = templates.filter((t) => t.library_key === "haccp_review" || /4.?weekly|haccp review/i.test(t.name)).map((t) => t.id);
  let lastReview: { at: string; by: string | null } | null = null;
  if (reviewIds.length) {
    const r = must(await bySite(admin.from("checklist_completions")
      .select("completed_at, completed_by_profile:profiles!checklist_completions_completed_by_fkey(full_name)")
      .eq("business_id", businessId).in("template_id", reviewIds))
      .order("completed_at", { ascending: false }).limit(1).maybeSingle()) as Row | null;
    if (r) lastReview = { at: r.completed_at, by: r.completed_by_profile?.full_name ?? null };
  }

  const owner = team.find((p) => p.role === "owner");
  const manager = site?.manager_id ? team.find((p) => p.id === site!.manager_id) : null;

  return {
    generatedAt: now.toISOString(),
    periodStart: period.start,
    periodEnd: period.end,
    business: {
      id: business.id, name: business.name, address: business.address ?? null, postCode: business.post_code ?? null,
      fsaRating: business.fsa_rating != null ? String(business.fsa_rating) : null,
      autoFill: business.haccp_auto_fill ?? true, lastReviewedAt: business.haccp_last_reviewed_at ?? null,
    },
    site: site
      ? { id: site.id, name: site.name, address: site.address ?? null, postcode: site.postcode ?? null,
        fsaRating: site.fsa_rating != null ? String(site.fsa_rating) : null, timezone: tz }
      : null,
    pack: {
      data: {
        toggles: inner.toggles ?? {}, texts: inner.texts ?? {}, files: inner.files ?? {},
        selects: inner.selects ?? {}, overrides: inner.overrides ?? {}, sources: inner.sources ?? {},
      },
      updatedAt: packRow?.updated_at ?? null,
    },
    signoff: signoff ? { signedByName: signoff.signed_by_name ?? null, signedAt: signoff.signed_at } : null,
    sources: {
      recipes, dishes, suppliers,
      templates: templates.map((t) => ({ id: t.id, name: t.name, frequency: t.frequency, sfbb_section: t.sfbb_section ?? null, library_key: t.library_key ?? null })),
      documents: planDocuments(documents as never[]),
      team: planTeam(team as never[]).map((p) => ({ full_name: p.full_name ?? null, role: p.role ?? null })),
    },
    proof: {
      templates: aggregateTemplates(templateRows, completionRows, instances as InstanceRow[], period.dates, tz),
      deliveries: aggregateDeliveries(
        deliveries.map((d) => ({
          received_at: d.received_at,
          product_temperature: d.product_temperature == null ? null : Number(d.product_temperature),
          frozen: d.product_temperature != null && Number(d.product_temperature) <= FROZEN_GUESS_MAX,
        })),
        period.dates, tz,
      ),
      corrective,
      lastReview,
    },
    people: { operator: owner?.full_name ?? null, siteManager: manager?.full_name ?? null },
  };
}
