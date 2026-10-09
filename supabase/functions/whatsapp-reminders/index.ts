// supabase/functions/whatsapp-reminders/index.ts
// Every 10 minutes (pg_cron → net.http_post with x-cron-secret): send due reminders and corrective follow-ups,
// then tidy old link codes / form tokens / reminder keys. Deployed with --no-verify-jwt; authenticity = x-cron-secret.
// Never log raw phone numbers — use maskPhone.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeSender, templateMessage } from "../_shared/channels/whatsapp.ts";
import { makeDeps } from "../_shared/channels/db.ts";
import { isBillable, sendManagerAlert } from "../_shared/channels/bot.ts";
import { maskPhone } from "../_shared/channels/mask.ts";
import { planCorrective, planReminders, reminderKey, type Recipient } from "../_shared/checklists-core/reminders.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CRON_SECRET = Deno.env.get("WA_CRON_SECRET") ?? "";
const send = makeSender({ token: Deno.env.get("WA_TOKEN") ?? "", phoneNumberId: Deno.env.get("WA_PHONE_NUMBER_ID") ?? "" });
const deps = makeDeps(admin, { send, correctiveFlowId: Deno.env.get("WA_CORRECTIVE_FLOW_ID") ?? "" });

const DAY_MS = 86400_000;
const REMINDER_KEY_COLS = "profile_id,template_id,site_id,period_key";

// deno-lint-ignore no-explicit-any
type Any = any;
interface Ident { id: string; business_id: string; profile_id: string; external_id: string; last_inbound_at: string | null }
interface SiteRow { name: string; timezone: string }

const hhmm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const errMsg = (e: unknown) => String((e as Any)?.message ?? e).slice(0, 200);

/**
 * Claim a one-off corrective step (nudge / no-action alert) by inserting its log row FIRST.
 * uq_channel_messages_claim (partial unique index on (ref_id, kind)) makes overlapping runs safe:
 * a unique_violation (23505) means another run already claimed it. PostgREST onConflict can't target a
 * partial index, hence a plain insert. Returns the log row id, or null if not claimed by this run.
 */
async function claimStep(row: { business_id: string; site_id: string; profile_id: string | null; kind: "corrective_nudge" | "alert_no_action"; template_name?: string; ref_id: string }): Promise<number | null> {
  const { data, error } = await admin.from("channel_messages_log")
    .insert({ ...row, channel: "whatsapp", direction: "out", billable: false }).select("id").single();
  if (error) {
    if (error.code !== "23505") console.error("whatsapp corrective claim failed", row.kind, errMsg(error));
    return null;
  }
  return data.id as number;
}

async function remindBusiness(biz: string, list: Ident[], sites: Map<string, SiteRow>, now: Date): Promise<number> {
  const [templates, completions] = await Promise.all([deps.templates(biz), deps.completionsSince(biz, new Date(now.getTime() - 32 * DAY_MS))]);
  const recipients: Recipient[] = [];
  for (const i of list) {
    const person = await deps.person(i.profile_id);
    if (!person || person.business_id !== biz) continue;
    for (const s of await deps.sitesFor(i.profile_id)) recipients.push({ person, external_id: i.external_id, site_id: s.id, tz: s.timezone });
  }
  if (!recipients.length) return 0;

  const { data: sentRows, error: sentErr } = await admin.from("channel_reminders_sent").select("profile_id, template_id, site_id, period_key")
    .in("profile_id", list.map((i) => i.profile_id)).in("site_id", [...sites.keys()])
    .gte("sent_at", new Date(now.getTime() - 40 * DAY_MS).toISOString());
  if (sentErr) throw sentErr;
  const already = new Set((sentRows ?? []).map((r: Any) => reminderKey(r.profile_id, r.template_id, r.site_id, r.period_key)));

  let sent = 0;
  // planReminders returns several jobs per recipient (chunks of MAX_PER_MESSAGE) — every job is sent.
  for (const job of planReminders({ now, recipients, templates, completions, alreadySent: already })) {
    // Claim the keys before sending: the PK makes overlapping runs safe; conflicting keys are skipped.
    const { data: claimed, error: claimErr } = await admin.from("channel_reminders_sent")
      .upsert(job.items.map((it) => ({ profile_id: job.profile_id, template_id: it.template.id, site_id: job.site_id, period_key: it.period_key })),
        { onConflict: REMINDER_KEY_COLS, ignoreDuplicates: true })
      .select("template_id, period_key");
    if (claimErr) { console.error("whatsapp reminder claim failed", errMsg(claimErr)); continue; }
    const claimedKeys = new Set((claimed ?? []).map((c: Any) => `${c.template_id}:${c.period_key}`));
    const items = job.items.filter((it) => claimedKeys.has(`${it.template.id}:${it.period_key}`));
    if (!items.length) continue;

    const ident = list.find((i) => i.profile_id === job.profile_id);
    const site = sites.get(job.site_id);
    const siteName = site?.name ?? "";
    const tz = site?.timezone ?? "Europe/London";
    const single = items.length === 1;
    const msg = single
      ? templateMessage(job.external_id, "checklist_reminder", [items[0].template.name, hhmm(items[0].deadline_utc!, tz), siteName], [`fill:${items[0].template.id}:${job.site_id}`])
      : templateMessage(job.external_id, "checklist_reminder_list",
        [String(items.length), siteName, items.map((x) => `${x.template.name} (${hhmm(x.deadline_utc!, tz)})`).join(", ")],
        items.map((x) => `fill:${x.template.id}:${job.site_id}`));
    const r = await send(msg);
    if (!r.ok) {
      // Give the keys back so the next run (still inside the lead window) retries.
      console.error("whatsapp reminder send failed", maskPhone(job.external_id), r.status);
      for (const it of items) {
        const { error: relErr } = await admin.from("channel_reminders_sent").delete()
          .eq("profile_id", job.profile_id).eq("template_id", it.template.id).eq("site_id", job.site_id).eq("period_key", it.period_key);
        if (relErr) console.error("whatsapp reminder key release failed", maskPhone(job.external_id), it.template.id, it.period_key, errMsg(relErr));
      }
    } else sent++;
    await deps.log({
      business_id: biz, site_id: job.site_id, profile_id: job.profile_id, direction: "out", kind: single ? "reminder" : "reminder_list",
      template_name: single ? "checklist_reminder" : "checklist_reminder_list", billable: r.ok && isBillable(ident?.last_inbound_at, now), wa_message_id: r.id,
    });
  }
  return sent;
}

async function correctiveBusiness(biz: string, list: Ident[], sites: Map<string, SiteRow>, now: Date): Promise<void> {
  // Only WhatsApp-recorded answers (app completions have their own corrective flow), last 2 days.
  const { data: needed, error } = await admin.from("checklist_responses")
    .select("id, value, item:checklist_template_items(name), completion:checklist_completions!inner(business_id, site_id, completed_by, completed_at, source)")
    .eq("corrective_status", "needed").eq("completion.business_id", biz).eq("completion.source", "whatsapp")
    .gte("completion.completed_at", new Date(now.getTime() - 2 * DAY_MS).toISOString());
  if (error) throw error;
  const rows: Any[] = (needed ?? []).filter((n: Any) => n.completion?.site_id && n.completion?.completed_by);
  if (!rows.length) return;

  const ids = rows.map((n) => n.id);
  const { data: logs, error: logErr } = await admin.from("channel_messages_log").select("kind, ref_id")
    .eq("business_id", biz).in("ref_id", ids).in("kind", ["corrective_nudge", "alert_no_action"]);
  if (logErr) throw logErr;
  const nudged = new Set((logs ?? []).filter((l: Any) => l.kind === "corrective_nudge").map((l: Any) => l.ref_id));
  const alerted = new Set((logs ?? []).filter((l: Any) => l.kind === "alert_no_action").map((l: Any) => l.ref_id));
  const plan = planCorrective({
    now, nudged, alerted,
    needed: rows.map((n) => ({ response_id: n.id, completed_by: n.completion.completed_by, business_id: biz, site_id: n.completion.site_id, created_at: n.completion.completed_at })),
  });

  for (const a of plan) {
    const n = rows.find((x) => x.id === a.response_id)!;
    const site = sites.get(n.completion.site_id);
    if (a.action === "nudge") {
      const ident = list.find((i) => i.profile_id === n.completion.completed_by);
      // Claim first; if the person is no longer linked the claim alone records the step (the 60-min manager alert still follows).
      const logId = await claimStep({ business_id: biz, site_id: n.completion.site_id, profile_id: ident ? n.completion.completed_by : null,
        kind: "corrective_nudge", template_name: ident ? "corrective_nudge" : undefined, ref_id: a.response_id });
      if (logId === null || !ident) continue;
      const r = await send(templateMessage(ident.external_id, "corrective_nudge", [site?.name ?? ""], ["checks"]));
      if (!r.ok) console.error("whatsapp nudge send failed", maskPhone(ident.external_id), r.status);
      const { error: upErr } = await admin.from("channel_messages_log")
        .update({ billable: r.ok && isBillable(ident.last_inbound_at, now), wa_message_id: r.id }).eq("id", logId);
      if (upErr) console.error("whatsapp nudge log update failed", errMsg(upErr));
    } else {
      const logId = await claimStep({ business_id: biz, site_id: n.completion.site_id, profile_id: null, kind: "alert_no_action", ref_id: a.response_id });
      if (logId === null) continue;
      // Per-manager sends are logged separately by sendManagerAlert (kind 'alert').
      const { data: by } = await admin.from("profiles").select("full_name").eq("id", n.completion.completed_by).eq("business_id", biz).maybeSingle();
      await sendManagerAlert(deps, biz, {
        siteName: site?.name ?? "", itemName: n.item?.name ?? "", value: n.value ?? "",
        time: hhmm(n.completion.completed_at, site?.timezone ?? "Europe/London"),
        byName: by?.full_name ?? "", action: "No corrective action recorded",
      });
    }
  }
}

async function housekeeping(now: Date): Promise<void> {
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const twoDaysAgo = new Date(now.getTime() - 2 * DAY_MS).toISOString();
  // Link codes older than a day that are used or expired (two deletes = the OR, without filter-string interpolation).
  const a = await admin.from("channel_link_codes").delete().not("used_at", "is", null).lt("created_at", dayAgo);
  const b = await admin.from("channel_link_codes").delete().lt("expires_at", now.toISOString()).lt("created_at", dayAgo);
  const c = await admin.from("channel_form_tokens").delete().lt("expires_at", twoDaysAgo);
  const d = await admin.from("channel_reminders_sent").delete().lt("sent_at", new Date(now.getTime() - 60 * DAY_MS).toISOString());
  for (const r of [a, b, c, d]) if (r.error) console.error("whatsapp housekeeping failed", errMsg(r.error));
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const now = new Date();
  const { data: idents, error } = await admin.from("channel_identities")
    .select("id, business_id, profile_id, external_id, last_inbound_at").eq("channel", "whatsapp").is("revoked_at", null);
  if (error) { console.error("whatsapp reminders: identities query failed", errMsg(error)); return new Response("error", { status: 500 }); }

  const byBiz = new Map<string, Ident[]>();
  for (const i of (idents ?? []) as Ident[]) {
    const l = byBiz.get(i.business_id) ?? [];
    l.push(i);
    byBiz.set(i.business_id, l);
  }

  let sent = 0;
  let failed = 0;
  for (const [biz, list] of byBiz) {
    try {
      if (!(await deps.ready(biz))) continue;
      const { data: siteRows, error: siteErr } = await admin.from("sites").select("id, name, timezone").eq("business_id", biz).is("removed_at", null);
      if (siteErr) throw siteErr;
      const sites = new Map<string, SiteRow>((siteRows ?? []).map((s: Any) => [s.id, { name: s.name ?? "", timezone: s.timezone ?? "Europe/London" }]));
      sent += await remindBusiness(biz, list, sites, now);
      await correctiveBusiness(biz, list, sites, now);
    } catch (err) {
      failed++;
      console.error("whatsapp reminders: business run failed", biz, errMsg(err));
    }
  }
  await housekeeping(now);
  return new Response(JSON.stringify({ ok: true, sent, failed }), { headers: { "Content-Type": "application/json" } });
});
