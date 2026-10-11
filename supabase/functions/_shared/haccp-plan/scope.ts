// What of the loaded rows may reach the plan document. The plan is inspector-facing and
// is also served to anonymous link holders, so it carries only what everyone in the
// business may see: documents open to all, and owners/managers by name.
import { localDate } from "./aggregate.ts";

export interface DocumentRow { id: string; title: string; category: string | null; access_level: string | null }
export interface TeamRow { id: string; full_name: string | null; role: string | null }

export function planDocuments(rows: DocumentRow[]): { id: string; title: string; category: string | null }[] {
  return rows
    .filter((d) => d.access_level == null || d.access_level === "all")
    .map((d) => ({ id: d.id, title: d.title, category: d.category }));
}

export function planTeam(rows: TeamRow[]): TeamRow[] {
  return rows.filter((p) => p.role === "owner" || p.role === "manager");
}

export interface CorrectiveEntry {
  at: string;
  template: string;
  item: string;
  value: string | null;
  notes: string | null;
  status: "needed" | "done" | null;
  by: string | null;
}

interface CompletionWithResponses {
  template_id: string;
  completed_at: string;
  completed_by_profile?: { full_name: string | null } | null;
  responses?: { flagged: boolean | null; corrective_status: string | null; value: string | null; notes: string | null; item?: { name: string | null } | null }[] | null;
}

export const CORRECTIVE_MAX = 20;

/** Flagged responses inside the 28-day period (site-local dates), newest first. */
export function buildCorrective(
  completions: CompletionWithResponses[],
  templateNames: Map<string, string>,
  dates: string[],
  tz: string,
): CorrectiveEntry[] {
  const inPeriod = new Set(dates);
  return completions
    .filter((c) => inPeriod.has(localDate(c.completed_at, tz)))
    .flatMap((c) => (c.responses ?? []).filter((r) => r.flagged).map((r) => ({
      at: c.completed_at,
      template: templateNames.get(c.template_id) ?? "Checklist",
      item: r.item?.name ?? "Item",
      value: r.value ?? null,
      notes: r.notes ?? null,
      status: r.corrective_status === "done" || r.corrective_status === "needed" ? r.corrective_status : null,
      by: c.completed_by_profile?.full_name ?? null,
    } as CorrectiveEntry)))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, CORRECTIVE_MAX);
}
