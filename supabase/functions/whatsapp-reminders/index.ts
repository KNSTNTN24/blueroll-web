// supabase/functions/whatsapp-reminders/index.ts
// Every 10 minutes (pg_cron → net.http_post with x-cron-secret). The name is historical; it serves:
//  - WhatsApp: TEAMS (team-cron.ts: morning list, overdue, missed summary) + corrective follow-ups
//    (needs WA_TOKEN + WA_PHONE_NUMBER_ID). Role assignments no longer drive WhatsApp (spec 2026-10-12 §9);
//    channel_reminders_sent is kept for history only.
//  - Telegram GROUPS: reminders (repost the live list), list refresh, daily permission check, cleanup of unlinked
//    groups' lists (tg-cron.ts; needs TG_BOT_TOKEN). There are no personal Telegram chats any more.
// Then housekeeping. Deployed with --no-verify-jwt; authenticity = x-cron-secret. Never log raw phone numbers (maskPhone).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeSender, templateMessage } from "../_shared/channels/whatsapp.ts";
import { makeTelegramApi } from "../_shared/channels/telegram.ts";
import { pageAll } from "../_shared/channels/db.ts";
import { isBillable, withUnit } from "../_shared/channels/bot.ts";
import { alertManagers, alertTelegramAlertsGroups, makeAlertDeps, type Senders } from "../_shared/channels/alerts.ts";
import { makeGroupDeps } from "../_shared/channels/groups-db.ts";
import { runTelegramGroups, type GroupRunResult } from "../_shared/channels/tg-cron.ts";
import { makeTeamDeps } from "../_shared/channels/teams-db.ts";
import { runWhatsAppTeams, type TeamRunResult } from "../_shared/channels/team-cron.ts";
import { maskPhone } from "../_shared/channels/mask.ts";
import { planCorrective } from "../_shared/checklists-core/reminders.ts";
import type { SendFn } from "../_shared/channels/types.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CRON_SECRET = Deno.env.get("WA_CRON_SECRET") ?? "";
const WA_TOKEN = Deno.env.get("WA_TOKEN") ?? "";
const WA_PHONE = Deno.env.get("WA_PHONE_NUMBER_ID") ?? "";
const TG_TOKEN = Deno.env.get("TG_BOT_TOKEN") ?? "";
const waSend: SendFn | undefined = WA_TOKEN && WA_PHONE ? makeSender({ token: WA_TOKEN, phoneNumberId: WA_PHONE }) : undefined;
const tgApi = TG_TOKEN ? makeTelegramApi({ token: TG_TOKEN }) : undefined;
const senders: Senders = waSend ? { whatsapp: waSend } : {};
const groupDeps = makeGroupDeps(admin, "telegram");
const teamDeps = makeTeamDeps(admin);
const alertDeps = makeAlertDeps(admin);

const DAY_MS = 86400_000;

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
 * a unique_violation (23505) means another run already claimed it. Returns the log row id, or null if not claimed.
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

async function correctiveBusiness(biz: string, list: Ident[], sites: Map<string, SiteRow>, now: Date): Promise<void> {
  // Only WhatsApp-recorded answers (app completions have their own corrective flow), last 2 days.
  const { data: needed, error } = await admin.from("checklist_responses")
    .select("id, value, item:checklist_template_items(name, unit, item_type), completion:checklist_completions!inner(business_id, site_id, completed_by, completed_at, source)")
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
      const r = await waSend!(templateMessage(ident.external_id, "corrective_nudge", [site?.name ?? ""], ["checks"]));
      if (!r.ok) console.error("whatsapp nudge send failed", maskPhone(ident.external_id), r.status);
      const { error: upErr } = await admin.from("channel_messages_log")
        .update({ billable: r.ok && isBillable(ident.last_inbound_at, now), wa_message_id: r.id }).eq("id", logId);
      if (upErr) console.error("whatsapp nudge log update failed", errMsg(upErr));
    } else {
      const logId = await claimStep({ business_id: biz, site_id: n.completion.site_id, profile_id: null, kind: "alert_no_action", ref_id: a.response_id });
      if (logId === null) continue;
      // Per-manager sends are logged separately by alertManagers (kind 'alert', one row per send).
      const { data: by } = await admin.from("profiles").select("full_name").eq("id", n.completion.completed_by).eq("business_id", biz).maybeSingle();
      const alert = {
        siteName: site?.name ?? "", itemName: n.item?.name ?? "",
        value: withUnit(n.value ?? "", n.item?.unit ?? (n.item?.item_type === "temperature" ? "°C" : null)),
        time: hhmm(n.completion.completed_at, site?.timezone ?? "Europe/London"),
        byName: by?.full_name ?? "", action: "No corrective action recorded",
      };
      try { await alertManagers(alertDeps, senders, biz, alert, now); }
      // Spec §2: also every Telegram "Alerts" group of the business (best effort, never throws).
      finally { if (tgApi) await alertTelegramAlertsGroups({ g: groupDeps, api: tgApi }, biz, alert); }
    }
  }
}

async function housekeeping(now: Date): Promise<void> {
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const twoDaysAgo = new Date(now.getTime() - 2 * DAY_MS).toISOString();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * DAY_MS).toISOString();
  // Link codes older than a day that are used or expired (two deletes = the OR, without filter-string interpolation).
  const a = await admin.from("channel_link_codes").delete().not("used_at", "is", null).lt("created_at", dayAgo);
  const b = await admin.from("channel_link_codes").delete().lt("expires_at", now.toISOString()).lt("created_at", dayAgo);
  const ga = await admin.from("channel_group_link_codes").delete().not("used_at", "is", null).lt("created_at", dayAgo);
  const gb = await admin.from("channel_group_link_codes").delete().lt("expires_at", now.toISOString()).lt("created_at", dayAgo);
  const c = await admin.from("channel_form_tokens").delete().lt("expires_at", twoDaysAgo);
  const d = await admin.from("channel_reminders_sent").delete().lt("sent_at", sixtyDaysAgo);
  const gd = await admin.from("channel_group_reminders_sent").delete().lt("sent_at", sixtyDaysAgo);
  // Privacy policy: channel message logs are kept for 12 months.
  const yearAgo = new Date(now);
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 12);
  const e = await admin.from("channel_messages_log").delete().lt("created_at", yearAgo.toISOString());
  const te = await admin.from("channel_group_events").delete().lt("sent_at", sixtyDaysAgo);
  const tt = await admin.from("channel_group_takes").delete().lt("taken_at", sixtyDaysAgo);
  for (const r of [a, b, ga, gb, c, d, gd, te, tt, e]) if (r.error) console.error("channel housekeeping failed", errMsg(r.error));
}

/** `fatal`: the identities query failed — the handler answers 500 (as before) so the cron failure is visible. */
async function runWhatsApp(now: Date): Promise<{ teams: TeamRunResult | null; failed: number; fatal?: boolean }> {
  if (!waSend) return { teams: null, failed: 0 };
  let teams: TeamRunResult | null = null;
  try { teams = await runWhatsAppTeams(teamDeps, waSend, now); }
  catch (err) { console.error("whatsapp teams run failed", errMsg(err)); }
  let idents: Ident[];
  try {
    // Corrective follow-ups go to the person who recorded the out-of-range answer: WhatsApp identities ONLY.
    idents = await pageAll<Ident>((from, to) => admin.from("channel_identities")
      .select("id, business_id, profile_id, external_id, last_inbound_at").eq("channel", "whatsapp").is("revoked_at", null)
      .order("id").range(from, to));
  } catch (error) {
    console.error("whatsapp reminders: identities query failed", errMsg(error));
    return { teams, failed: 1, fatal: true };
  }
  const byBiz = new Map<string, Ident[]>();
  for (const i of idents) byBiz.set(i.business_id, [...(byBiz.get(i.business_id) ?? []), i]);
  let failed = 0;
  for (const [biz, list] of byBiz) {
    try {
      if (!(await teamDeps.ready(biz))) continue;
      const { data: siteRows, error: siteErr } = await admin.from("sites").select("id, name, timezone").eq("business_id", biz).is("removed_at", null);
      if (siteErr) throw siteErr;
      const sites = new Map<string, SiteRow>((siteRows ?? []).map((s: Any) => [s.id, { name: s.name ?? "", timezone: s.timezone ?? "Europe/London" }]));
      await correctiveBusiness(biz, list, sites, now);
    } catch (err) {
      failed++;
      console.error("whatsapp corrective run failed", biz, errMsg(err));
    }
  }
  return { teams, failed };
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const now = new Date();
  if (!waSend && !tgApi) console.error("channel reminders: neither TG_BOT_TOKEN nor WA_TOKEN/WA_PHONE_NUMBER_ID is set — only housekeeping runs");
  const wa = await runWhatsApp(now);
  let groups: GroupRunResult | null = null;
  if (tgApi) {
    try { groups = await runTelegramGroups(groupDeps, tgApi, now); }
    catch (err) { console.error("telegram groups run failed", errMsg(err)); }
  }
  await housekeeping(now);
  // WhatsApp identities query failed: groups and housekeeping above are independent and still ran, but the cron must see the failure.
  if (wa.fatal) return new Response("error", { status: 500 });
  return new Response(JSON.stringify({ ok: true, teams: wa.teams, failed: wa.failed, groups }), { headers: { "Content-Type": "application/json" } });
});
