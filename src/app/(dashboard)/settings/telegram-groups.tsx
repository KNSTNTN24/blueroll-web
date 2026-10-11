'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useAuthStore } from '@/stores/auth-store'
import {
  GROUP_LINK_STEPS, LINK_CODE_TTL_SEC, checklistLabel, issueGroupLinkCode, listChecklistOptions, listGroups, mappingDiff,
  saveGroupChecklists, setGroupAlerts, unlinkGroup, type ChecklistOption, type TelegramGroup,
} from '@/lib/telegram/groups'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Settings → Messaging → Telegram groups: link a group, choose its checks, mark it as an alerts group, unlink. */
export function TelegramGroups() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const queryClient = useQueryClient()
  const [linking, setLinking] = useState(false)
  const groupsKey = ['telegram-groups', business?.id]
  const { data: groups = [], isLoading } = useQuery({
    queryKey: groupsKey, enabled: !!business?.id, queryFn: () => listGroups(business!.id),
    refetchInterval: linking ? 5000 : false,   // the new group shows up as soon as /link arrives
  })
  const { data: options = [] } = useQuery({
    queryKey: ['telegram-checklist-options', business?.id], enabled: !!business?.id, queryFn: () => listChecklistOptions(business!.id),
  })
  const siteNames = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites])
  if (!business) return null
  const refresh = () => queryClient.invalidateQueries({ queryKey: groupsKey })

  return (
    <section className="rounded-xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Telegram groups</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Anyone in a linked group can fill in that group&apos;s checks. Each group gets one live list per site.</p>
        </div>
        <Button onClick={() => setLinking(true)}>Link a group</Button>
      </div>
      {isLoading ? (
        <p className="mt-4 text-[13px] text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">No groups linked yet.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {groups.map((g) => (
            // Remount when the saved mapping changes so the checkbox state starts from it.
            <GroupCard key={`${g.id}:${g.template_ids.join(',')}`} group={g} options={options} siteNames={siteNames} onChanged={refresh} />
          ))}
        </div>
      )}
      {linking && <LinkGroupDialog onClose={() => { setLinking(false); refresh() }} />}
    </section>
  )
}

function GroupCard({ group, options, siteNames, onChanged }: {
  group: TelegramGroup; options: ChecklistOption[]; siteNames: Map<string, string>; onChanged: () => void
}) {
  const [selected, setSelected] = useState<string[]>(group.template_ids)
  const [busy, setBusy] = useState(false)
  const diff = mappingDiff(group.template_ids, selected)
  const dirty = diff.add.length + diff.remove.length > 0
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const save = async () => {
    setBusy(true)
    try { await saveGroupChecklists(group.id, group.template_ids, selected); toast.success('Checks saved'); onChanged() }
    catch (e) { toast.error(errText(e)) } finally { setBusy(false) }
  }
  const alerts = async (v: boolean) => {
    try { await setGroupAlerts(group.id, v); onChanged() } catch (e) { toast.error(errText(e)) }
  }
  const unlink = async () => {
    if (!window.confirm(`Unlink “${group.title}”? Its lists disappear from the group within 10 minutes.`)) return
    try { await unlinkGroup(group.id); toast.success('Group unlinked'); onChanged() } catch (e) { toast.error(errText(e)) }
  }
  const alertsLabel = `alerts-${group.id}`
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{group.title}</p>
        <Button variant="outline" size="sm" onClick={unlink}>Unlink</Button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[13px]">
        <span id={alertsLabel}>Alerts group — out-of-range readings from every group are posted here too</span>
        <Switch checked={group.alerts} onCheckedChange={alerts} aria-labelledby={alertsLabel} />
      </div>
      <fieldset className="mt-3">
        <legend className="text-[12.5px] font-semibold text-muted-foreground">Checks this group does</legend>
        {options.length === 0 ? (
          <p className="mt-1 text-[13px] text-muted-foreground">No active checklists yet.</p>
        ) : (
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {options.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" className="size-4 accent-[#1f9d63]" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                <span>{checklistLabel(o, siteNames)}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setSelected(group.template_ids)}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
    </div>
  )
}

function LinkGroupDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(LINK_CODE_TTL_SEC)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    issueGroupLinkCode()
      .then((c) => { if (alive) setCode(c) })
      .catch((e: unknown) => { if (alive) setError(errText(e)) })
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => { alive = false; clearInterval(t) }
  }, [attempt])

  // No backdrop close: a stray click must not lose the code mid-setup — only Done/Cancel closes it.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div role="dialog" aria-modal="true" aria-labelledby="link-group-title" className="w-[400px] max-w-full rounded-2xl bg-card p-6 shadow-xl">
        <h2 id="link-group-title" className="text-[17px] font-semibold">Link a Telegram group</h2>
        {error ? (
          <>
            <p className="mt-2 text-[13px] text-red-700">{error}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => { setError(null); setCode(null); setLeft(LINK_CODE_TTL_SEC); setAttempt((n) => n + 1) }}>Retry</Button>
            </div>
          </>
        ) : (
          <>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px]">
              {GROUP_LINK_STEPS(code ?? '······').map((s) => <li key={s}>{s}</li>)}
            </ol>
            <p className="mt-4 text-center font-mono text-[24px] tracking-[0.2em]">{code ?? '······'}</p>
            <p className="mt-1 text-center text-[12px] text-muted-foreground">
              {left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired — close and try again'}
            </p>
            <p className="mt-3 text-[12px] text-muted-foreground">The group appears in this list once it is linked. Then tick the checks it does.</p>
            <div className="mt-4 flex justify-end"><Button variant="outline" onClick={onClose}>Done</Button></div>
          </>
        )}
      </div>
    </div>
  )
}
