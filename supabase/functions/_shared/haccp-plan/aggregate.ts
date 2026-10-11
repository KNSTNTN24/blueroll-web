// 28-day "Prove it" aggregation for the HACCP Plan document. Pure: no I/O.
// Types mirror src/lib/haccp-plan/types.ts (Deno cannot import from src).

export type DayStatus = "ok" | "flagged" | "corrected" | "missed" | "none";

export interface TemplateProof {
  templateId: string;
  name: string;
  libraryKey: string | null;
  sfbbSection: string | null;
  frequency: string;
  days: DayStatus[];
  completions: number;
  flagged: number;
  corrected: number;
  readings: number;
  initials: string[];
  lastCompletedAt: string | null;
}
export interface DeliveryProof { count: number; outOfRange: number; days: DayStatus[] }

export interface CompletionRow {
  template_id: string;
  completed_at: string;
  by_name: string | null;
  responses: { flagged: boolean | null; corrective_status: string | null; item_type: string | null }[];
}
export interface InstanceRow { template_id: string; due_date: string; status: string }
export interface TemplateRow { id: string; name: string; library_key: string | null; sfbb_section: string | null; frequency: string }

const DAY_MS = 86_400_000;
export const PERIOD_DAYS = 28;
export const CHILLED_MAX = 5;
export const FROZEN_MAX = -15;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function localDate(iso: string, tz: string): string {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f.format(new Date(iso));
}

/** The 28 site-local dates ending yesterday, oldest first. */
export function periodFor(now: Date, tz: string): { start: string; end: string; dates: string[] } {
  const today = localDate(now.toISOString(), tz);
  const [y, m, d] = today.split("-").map(Number);
  const todayUtc = Date.UTC(y, m - 1, d);
  const dates: string[] = [];
  for (let i = PERIOD_DAYS; i >= 1; i--) dates.push(new Date(todayUtc - i * DAY_MS).toISOString().slice(0, 10));
  return { start: dates[0], end: dates[dates.length - 1], dates };
}

export function initials(name: string | null): string | null {
  if (!name || !name.trim()) return null;
  return name.trim().split(/\s+/).map((p) => p[0]!.toUpperCase()).join("").slice(0, 3);
}

type DayAcc = { ok: boolean; corrected: boolean; flagged: boolean; missed: boolean };
const emptyAcc = (): DayAcc => ({ ok: false, corrected: false, flagged: false, missed: false });
const statusOf = (a: DayAcc): DayStatus =>
  a.flagged ? "flagged" : a.corrected ? "corrected" : a.ok ? "ok" : a.missed ? "missed" : "none";

export function aggregateTemplates(
  templates: TemplateRow[],
  completions: CompletionRow[],
  instances: InstanceRow[],
  dates: string[],
  tz: string,
): TemplateProof[] {
  const index = new Map(dates.map((d, i) => [d, i]));
  return templates.map((t) => {
    const acc = dates.map(emptyAcc);
    let count = 0, flagged = 0, corrected = 0, readings = 0;
    let last: string | null = null;
    const inits: string[] = [];
    for (const c of completions) {
      if (c.template_id !== t.id) continue;
      const i = index.get(localDate(c.completed_at, tz));
      if (i === undefined) continue;
      count++;
      acc[i].ok = true;
      if (!last || c.completed_at > last) last = c.completed_at;
      const ini = initials(c.by_name);
      if (ini && !inits.includes(ini)) inits.push(ini);
      for (const r of c.responses) {
        if (r.item_type === "temperature") readings++;
        if (!r.flagged) continue;
        flagged++;
        if (r.corrective_status === "done") { corrected++; acc[i].corrected = true; }
        else acc[i].flagged = true;
      }
    }
    for (const inst of instances) {
      if (inst.template_id !== t.id || inst.status !== "missed") continue;
      const i = index.get(inst.due_date);
      if (i !== undefined) acc[i].missed = true;
    }
    return {
      templateId: t.id, name: t.name, libraryKey: t.library_key, sfbbSection: t.sfbb_section, frequency: t.frequency,
      days: acc.map(statusOf), completions: count, flagged, corrected, readings, initials: inits, lastCompletedAt: last,
    };
  });
}

export function aggregateDeliveries(
  rows: { received_at: string; product_temperature: number | null; frozen: boolean }[],
  dates: string[],
  tz: string,
): DeliveryProof {
  const index = new Map(dates.map((d, i) => [d, i]));
  const acc = dates.map(emptyAcc);
  let count = 0, outOfRange = 0;
  for (const r of rows) {
    const i = index.get(localDate(r.received_at, tz));
    if (i === undefined) continue;
    count++;
    const t = r.product_temperature;
    const bad = t !== null && (r.frozen ? t > FROZEN_MAX : t > CHILLED_MAX);
    if (bad) { outOfRange++; acc[i].flagged = true; } else acc[i].ok = true;
  }
  return { count, outOfRange, days: acc.map(statusOf) };
}
