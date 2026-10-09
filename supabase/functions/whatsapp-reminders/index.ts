// supabase/functions/whatsapp-reminders/index.ts
// Serves BOTH channels (WhatsApp and Telegram); the name is historical.
// Every 10 minutes (pg_cron → net.http_post with x-cron-secret): send due reminders (Telegram + WhatsApp), WhatsApp corrective
// follow-ups, then tidy old link codes / form tokens / reminder keys / message log. Deployed with --no-verify-jwt; authenticity = x-cron-secret.
// A channel runs only when its env is set: Telegram needs TG_BOT_TOKEN; WhatsApp needs WA_TOKEN + WA_PHONE_NUMBER_ID.
// Never log raw phone numbers / chat ids — use maskPhone.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeSender, templateMessage } from "../_shared/channels/whatsapp.ts";
import { makeTelegramSender } from "../_shared/channels/telegram.ts";
import { makeDeps, pageAll } from "../_shared/channels/db.ts";
import { isBillable, saveChecklistToken, telegramFormItemIds, withUnit, type BotDeps } from "../_shared/channels/bot.ts";
import { alertManagers, makeAlertDeps, TG_MINI_APP_URL, type Senders } from "../_shared/channels/alerts.ts";
import { telegramUI, whatsappUI, type Channel } from "../_shared/channels/ui.ts";
import { buildTelegramReminder } from "../_shared/channels/tg-reminder.ts";
import { maskPhone } from "../_shared/channels/mask.ts";
import { planCorrective, planReminders, reminderKey, type Recipient, type ReminderJob } from "../_shared/checklists-core/reminders.ts";
import { completionsWindowStart } from "../_shared/checklists-core/due.ts";
import type { Person } from "../_shared/checklists-core/types.ts";
import type { SendFn } from "../_shared/channels/types.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CRON_SECRET = Deno.env.get("WA_CRON_SECRET") ?? "";
const WA_TOKEN = Deno.env.get("WA_TOKEN") ?? "";
const WA_PHONE = Deno.env.get("WA_PHONE_NUMBER_ID") ?? "";
const TG_TOKEN = Deno.env.get("TG_BOT_TOKEN") ?? "";
const waSend: SendFn | undefined = WA_TOKEN && WA_PHONE ? makeSender({ token: WA_TOKEN, phoneNumberId: WA_PHONE }) : undefined;
const tgSend: SendFn | undefined = TG_TOKEN ? makeTelegramSender({ token: TG_TOKEN }) : undefined;
const CORRECTIVE_FLOW_ID = Deno.env.get("WA_CORRECTIVE_FLOW_ID") ?? "";
if (waSend && !CORRECTIVE_FLOW_ID) console.error("whatsapp-reminders: WA_CORRECTIVE_FLOW_ID is not set — corrective forms will be skipped");
const senders: Senders = { ...(tgSend ? { telegram: tgSend } : {}), ...(waSend ? { whatsapp: waSend } : {}) };
// Telegram first: a person linked on both channels gets the (free) Telegram reminder; the shared key then skips WhatsApp.
const channelDeps: { channel: Channel; send: SendFn; deps: BotDeps }[] = [
  ...(tgSend ? [{ channel: "telegram" as const, send: tgSend, deps: makeDeps(admin, { channel: "telegram", ui: telegramUI(TG_MINI_APP_URL), send: tgSend, senders }) }] : []),
  ...(waSend ? [{ channel: "whatsapp" as const, send: waSend, deps: makeDeps(admin, { channel: "whatsapp", ui: whatsappUI(), send: waSend, correctiveFlowId: CORRECTIVE_FLOW_ID, senders }) }] : []),
];
const CHANNELS = channelDeps.map((c) => c.channel);
const alertDeps = makeAlertDeps(admin);

const DAY_MS = 86400_000;
const REMINDER_KEY_COLS = "profile_id,template_id,site_id,period_key";

// deno-lint-ignore no-explicit-any
type Any = any;
interface Ident { id: string; business_id: string; profile_id: string; channel: Channel; external_id: string; last_inbound_at: string | null }
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

async function releaseKeys(job: ReminderJob, items: ReminderJob["items"]): Promise<void> {
  for (const it of items) {
    const { error: relErr } = await admin.from("channel_reminders_sent").delete()
      .eq("profile_id", job.profile_id).eq("template_id", it.template.id).eq("site_id", job.site_id).eq("period_key", it.period_key);
    if (relErr) console.error("reminder key release failed", maskPhone(job.external_id), it.template.id, it.period_key, errMsg(relErr));
  }
}

/** Reminders for one business across its ready channels. `byChannel` holds that business's identities per channel. */
async function remindBusiness(biz: string, byChannel: Map<Channel, Ident[]>, sites: Map<string, SiteRow>, now: Date): Promise<number> {
  const shared = channelDeps[0].deps;   // business-level reads are channel-independent
  const templates = await shared.templates(biz);
  if (!templates.length) return 0;
  const completions = await shared.completionsSince(biz, completionsWindowStart(templates, [...new Set([...sites.values()].map((s) => s.timezone))], now));

  const allProfiles = [...new Set([...byChannel.values()].flat().map((i) => i.profile_id))];
  if (!allProfiles.length) return 0;
  // The reminder key has no channel: one reminder per person per key, whichever channel claims it first.
  const sentRows = await pageAll<Any>((from, to) => admin.from("channel_reminders_sent").select("profile_id, template_id, site_id, period_key")
    .in("profile_id", allProfiles).in("site_id", [...sites.keys()])
    .gte("sent_at", new Date(now.getTime() - 40 * DAY_MS).toISOString())
    .order("profile_id").order("template_id").order("site_id").order("period_key").range(from, to));
  const already = new Set(sentRows.map((r: Any) => reminderKey(r.profile_id, r.template_id, r.site_id, r.period_key)));

  // Per-run caches shared by both channels.
  const personCache = new Map<string, Person | null>();
  const sitesCache = new Map<string, { id: string; timezone: string }[]>();
  const tgItemsCache = new Map<string, string[] | null>();

  let sent = 0;
  for (const { channel, send, deps } of channelDeps) {
    const list = byChannel.get(channel) ?? [];
    if (!list.length) continue;

    let hasFlow: ((templateId: string, siteId: string) => boolean) | undefined;
    if (channel === "whatsapp") {
      // Only (template, site) pairs with a published Flow: a reminder for a checklist that can't be filled here is billable noise.
      const { data: flowRows, error: flowErr } = await admin.from("channel_flows").select("template_id, site_id")
        .eq("channel", "whatsapp").eq("status", "published").not("flow_id", "is", null).in("template_id", templates.map((t) => t.id));
      if (flowErr) throw flowErr;
      const withFlow = new Set((flowRows ?? []).map((f: Any) => `${f.template_id}:${f.site_id}`));
      if (!withFlow.size) continue;
      hasFlow = (templateId, siteId) => withFlow.has(`${templateId}:${siteId}`);
    }

    const recipients: Recipient[] = [];
    for (const i of list) {
      if (!personCache.has(i.profile_id)) personCache.set(i.profile_id, await deps.person(i.profile_id));
      const person = personCache.get(i.profile_id);
      if (!person || person.business_id !== biz) continue;
      if (!sitesCache.has(i.profile_id)) sitesCache.set(i.profile_id, await deps.sitesFor(i.profile_id));
      for (const s of sitesCache.get(i.profile_id)!) recipients.push({ person, external_id: i.external_id, site_id: s.id, tz: s.timezone });
    }
    if (!recipients.length) continue;

    // planReminders returns several jobs per recipient (chunks of MAX_PER_MESSAGE) — every job is sent.
    for (const job of planReminders({ now, recipients, templates, completions, alreadySent: already, hasFlow })) {
      // Claim the keys before sending: the PK makes overlapping runs (and the other channel) safe; conflicting keys are skipped.
      const { data: claimed, error: claimErr } = await admin.from("channel_reminders_sent")
        .upsert(job.items.map((it) => ({ profile_id: job.profile_id, template_id: it.template.id, site_id: job.site_id, period_key: it.period_key })),
          { onConflict: REMINDER_KEY_COLS, ignoreDuplicates: true })
        .select("template_id, period_key");
      if (claimErr) { console.error(`${channel} reminder claim failed`, errMsg(claimErr)); continue; }
      const claimedKeys = new Set((claimed ?? []).map((c: Any) => `${c.template_id}:${c.period_key}`));
      // Keys this job touched are now taken either way — the other channel must not re-plan them in this run.
      for (const it of job.items) already.add(reminderKey(job.profile_id, it.template.id, job.site_id, it.period_key));
      const items = job.items.filter((it) => claimedKeys.has(`${it.template.id}:${it.period_key}`));
      if (!items.length) continue;

      const ident = list.find((i) => i.profile_id === job.profile_id);
      const site = sites.get(job.site_id);
      const siteName = site?.name ?? "";
      const tz = site?.timezone ?? "Europe/London";
      const single = items.length === 1;

      let r: { id: string | null; ok: boolean; status: number };
      if (channel === "telegram") {
        try {
          const tokens = new Map<string, string | null>();
          for (const it of items) {
            if (!tgItemsCache.has(it.template.id)) tgItemsCache.set(it.template.id, telegramFormItemIds(await deps.items(it.template.id)));
            const ids = tgItemsCache.get(it.template.id);
            tokens.set(it.template.id, ids
              ? await saveChecklistToken(deps, { business_id: biz, profile_id: job.profile_id, site_id: job.site_id, template_id: it.template.id }, ids)
              : null);
          }
          r = await send(buildTelegramReminder({ external_id: job.external_id, siteName, tz, items }, tokens));
        } catch (err) {
          console.error("telegram reminder build failed", maskPhone(job.external_id), errMsg(err));
          r = { id: null, ok: false, status: 0 };
        }
      } else {
        const msg = single
          ? templateMessage(job.external_id, "checklist_reminder", [items[0].template.name, hhmm(items[0].deadline_utc!, tz), siteName], [`fill:${items[0].template.id}:${job.site_id}`])
          : templateMessage(job.external_id, "checklist_reminder_list",
            [String(items.length), siteName, items.map((x) => `${x.template.name} (${hhmm(x.deadline_utc!, tz)})`).join(", ")],
            // One QUICK_REPLY "Show checks": the bot answers with named Fill-in buttons (a template can't label its buttons per send).
            ["checks"]);
        r = await send(msg);
      }
      if (!r.ok) {
        // Give the keys back so the next run (still inside the lead window) retries.
        console.error(`${channel} reminder send failed`, maskPhone(job.external_id), r.status);
        await releaseKeys(job, items);
      } else sent++;
      await deps.log({
        business_id: biz, site_id: job.site_id, profile_id: job.profile_id, direction: "out", kind: single ? "reminder" : "reminder_list",
        // Telegram messages are free; only WhatsApp templates outside the 24h window cost money.
        template_name: channel === "whatsapp" ? (single ? "checklist_reminder" : "checklist_reminder_list") : undefined,
        billable: channel === "whatsapp" && r.ok && isBillable(ident?.last_inbound_at, now), wa_message_id: r.id,
      });
    }
  }
  return sent;
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
      // Per-manager sends are logged separately by alertManagers (kind 'alert', one row per channel send).
      const { data: by } = await admin.from("profiles").select("full_name").eq("id", n.completion.completed_by).eq("business_id", biz).maybeSingle();
      await alertManagers(alertDeps, senders, biz, {
        siteName: site?.name ?? "", itemName: n.item?.name ?? "",
        value: withUnit(n.value ?? "", n.item?.unit ?? (n.item?.item_type === "temperature" ? "°C" : null)),
        time: hhmm(n.completion.completed_at, site?.timezone ?? "Europe/London"),
        byName: by?.full_name ?? "", action: "No corrective action recorded",
      }, now);
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
  // Privacy policy: channel message logs are kept for 12 months.
  const yearAgo = new Date(now);
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 12);
  const e = await admin.from("channel_messages_log").delete().lt("created_at", yearAgo.toISOString());
  for (const r of [a, b, c, d, e]) if (r.error) console.error("channel housekeeping failed", errMsg(r.error));
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const now = new Date();
  let idents: Ident[] = [];
  if (CHANNELS.length) {
    try {
      idents = await pageAll<Ident>((from, to) => admin.from("channel_identities")
        .select("id, business_id, profile_id, channel, external_id, last_inbound_at").in("channel", CHANNELS).is("revoked_at", null)
        .order("id").range(from, to));
    } catch (error) { console.error("channel reminders: identities query failed", errMsg(error)); return new Response("error", { status: 500 }); }
  } else console.error("channel reminders: neither TG_BOT_TOKEN nor WA_TOKEN/WA_PHONE_NUMBER_ID is set — only housekeeping runs");

  // business → channel → identities
  const byBiz = new Map<string, Map<Channel, Ident[]>>();
  for (const i of idents) {
    const m = byBiz.get(i.business_id) ?? new Map<Channel, Ident[]>();
    const l = m.get(i.channel) ?? [];
    l.push(i);
    m.set(i.channel, l);
    byBiz.set(i.business_id, m);
  }

  let sent = 0;
  let failed = 0;
  for (const [biz, all] of byBiz) {
    try {
      // channel_ready(b, channel): keep only the channels this business can use right now.
      const byChannel = new Map<Channel, Ident[]>();
      for (const { channel, deps } of channelDeps) {
        const list = all.get(channel);
        if (list?.length && (await deps.ready(biz))) byChannel.set(channel, list);
      }
      if (!byChannel.size) continue;
      const { data: siteRows, error: siteErr } = await admin.from("sites").select("id, name, timezone").eq("business_id", biz).is("removed_at", null);
      if (siteErr) throw siteErr;
      const sites = new Map<string, SiteRow>((siteRows ?? []).map((s: Any) => [s.id, { name: s.name ?? "", timezone: s.timezone ?? "Europe/London" }]));
      sent += await remindBusiness(biz, byChannel, sites, now);
      // Corrective nudges / no-action alerts: WhatsApp-recorded answers only (Telegram submissions always carry their action).
      const waList = byChannel.get("whatsapp");
      if (waList && waSend) await correctiveBusiness(biz, waList, sites, now);
    } catch (err) {
      failed++;
      console.error("channel reminders: business run failed", biz, errMsg(err));
    }
  }
  await housekeeping(now);
  return new Response(JSON.stringify({ ok: true, sent, failed }), { headers: { "Content-Type": "application/json" } });
});
