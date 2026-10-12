// src/app/(dashboard)/settings/whatsapp-teams.tsx
'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth-store'
import { listChecklistOptions, mappingDiff, saveGroupChecklists, type ChecklistOption } from '@/lib/telegram/groups'
import { maskNumber } from '@/lib/whatsapp/client'
import {
  TEAM_SHARE_HINT, addTeamPerson, canResend, createTeam, deleteTeam, listPeople, listTeams, memberStatusLabel,
  removeTeamMember, resendTeamInvite, teamErrorText, type Person, type TeamMemberRow, type WhatsAppTeam,
} from '@/lib/whatsapp/teams'

const STATUS_STYLE: Record<string, string> = {
  Active: 'bg-emerald-50 text-emerald-700',
  Invited: 'bg-amber-50 text-amber-700',
  'Not reachable': 'bg-red-50 text-red-700',
}

/** Settings → Messaging → WhatsApp teams (spec 2026-10-12 §8): one team per site, its checklists and its people. */
export function WhatsAppTeams() {
  const business = useAuthStore((s) => s.business)
  const allSites = useAuthStore((s) => s.sites)
  // Live sites only: createTeam relies on RLS, which rejects soft-removed sites.
  const sites = useMemo(() => allSites.filter((s) => s.status !== 'removed'), [allSites])
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const teamsKey = ['whatsapp-teams', business?.id]
  const { data: teams = [], isLoading } = useQuery({ queryKey: teamsKey, enabled: !!business?.id, queryFn: () => listTeams(business!.id) })
  const { data: options = [] } = useQuery({
    queryKey: ['telegram-checklist-options', business?.id], enabled: !!business?.id, queryFn: () => listChecklistOptions(business!.id),
  })
  const { data: people = [] } = useQuery({ queryKey: ['whatsapp-team-people', business?.id], enabled: !!business?.id, queryFn: () => listPeople(business!.id) })
  const siteNames = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites])
  if (!business) return null
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: teamsKey })
    void queryClient.invalidateQueries({ queryKey: ['whatsapp-team-people', business.id] })
    void queryClient.invalidateQueries({ queryKey: ['wa-member-teams', business.id] })
    void queryClient.invalidateQueries({ queryKey: ['team', business.id] })
  }

  return (
    <section className="rounded-xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">WhatsApp teams</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Anyone in a team can fill in its checks; the first to submit closes a check for everyone. Each person gets one list of checks in the morning.</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={creating}>New team</Button>
      </div>
      {creating && <NewTeamForm businessId={business.id} sites={sites} onClose={(created) => { setCreating(false); if (created) refresh() }} />}
      {isLoading ? (
        <p className="mt-4 text-[13px] text-muted-foreground">Loading…</p>
      ) : teams.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">No teams yet.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {teams.map((t) => (
            // Remount when the saved mapping changes so the checkbox state starts from it.
            <TeamCard key={`${t.id}:${t.template_ids.join(',')}`} team={t} siteName={siteNames.get(t.site_id) ?? 'Site'}
              options={options.filter((o) => o.site_id === null || o.site_id === t.site_id)} people={people} onChanged={refresh} />
          ))}
        </div>
      )}
      <p className="mt-4 text-[12.5px] text-muted-foreground">{TEAM_SHARE_HINT}</p>
    </section>
  )
}

function NewTeamForm({ businessId, sites, onClose }: { businessId: string; sites: { id: string; name: string }[]; onClose: (created: boolean) => void }) {
  const [title, setTitle] = useState('')
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try { await createTeam({ businessId, title, siteId }); toast.success('Team created'); onClose(true) }
    catch (e) { toast.error(teamErrorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border p-4">
      <Input aria-label="Team name" placeholder="Team name, e.g. Kitchen" value={title} onChange={(e) => setTitle(e.target.value)} className="max-w-[260px]" />
      {sites.length > 1 && (
        <select aria-label="Site" className="h-10 rounded-md border px-2 text-[14px]" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
      <Button disabled={!title.trim() || !siteId || busy} onClick={create}>{busy ? 'Creating…' : 'Create'}</Button>
    </div>
  )
}

function TeamCard({ team, siteName, options, people, onChanged }: {
  team: WhatsAppTeam; siteName: string; options: ChecklistOption[]; people: Person[]; onChanged: () => void
}) {
  const [selected, setSelected] = useState<string[]>(team.template_ids)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const diff = mappingDiff(team.template_ids, selected)
  const dirty = diff.add.length + diff.remove.length > 0
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const save = async () => {
    setBusy(true)
    try { await saveGroupChecklists(team.id, team.template_ids, selected); toast.success('Checks saved'); onChanged() }
    catch (e) { toast.error(teamErrorText(e)) } finally { setBusy(false) }
  }
  const remove = async (m: TeamMemberRow) => {
    if (!window.confirm(`Remove ${m.name} from ${team.title}? They stop getting this team's checks at once.`)) return
    try { await removeTeamMember(m.id); toast.success(`${m.name} removed`); onChanged() } catch (e) { toast.error(teamErrorText(e)) }
  }
  const resend = async (m: TeamMemberRow) => {
    try { await resendTeamInvite(m.id); toast.success(`Invite sent to ${m.name}`); onChanged() } catch (e) { toast.error(teamErrorText(e)) }
  }
  const del = async () => {
    if (!window.confirm(`Delete “${team.title}”? Its people stop getting WhatsApp checks for it.`)) return
    try { await deleteTeam(team.id); toast.success('Team deleted'); onChanged() } catch (e) { toast.error(teamErrorText(e)) }
  }
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{team.title} <span className="font-normal text-muted-foreground">· {siteName}</span></p>
        <Button variant="outline" size="sm" onClick={del}>Delete team</Button>
      </div>
      <fieldset className="mt-3">
        <legend className="text-[12.5px] font-semibold text-muted-foreground">Checks this team does</legend>
        {options.length === 0 ? (
          <p className="mt-1 text-[13px] text-muted-foreground">No active checklists at this site yet.</p>
        ) : (
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {options.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" className="size-4 accent-[#1f9d63]" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                <span>{o.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setSelected(team.template_ids)}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
      <div className="mt-4">
        <p className="text-[12.5px] font-semibold text-muted-foreground">People</p>
        {team.members.length === 0 ? (
          <p className="mt-1 text-[13px] text-muted-foreground">No people yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {team.members.map((m) => {
              const status = memberStatusLabel(m)
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted-foreground">{maskNumber(m.phone)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${STATUS_STYLE[status]}`}>{status}</span>
                  <span className="ml-auto flex gap-2">
                    {canResend(m) && <button className="text-[12px] font-medium text-primary underline" onClick={() => resend(m)}>Resend invite</button>}
                    <button className="text-[12px] text-muted-foreground underline" onClick={() => remove(m)}>Remove</button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {adding
          ? <AddPersonForm team={team} people={people} onClose={(added) => { setAdding(false); if (added) onChanged() }} />
          : <Button className="mt-3" variant="outline" size="sm" onClick={() => setAdding(true)}>Add person</Button>}
      </div>
    </div>
  )
}

function AddPersonForm({ team, people, onClose }: { team: WhatsAppTeam; people: Person[]; onClose: (added: boolean) => void }) {
  const [mode, setMode] = useState<'new' | 'team'>('new')
  const [name, setName] = useState('')
  const [profileId, setProfileId] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const inTeam = new Set(team.members.map((m) => m.profile_id))
  const pickable = people.filter((p) => !inTeam.has(p.id))
  const who = mode === 'new' ? name.trim() : pickable.find((p) => p.id === profileId)?.full_name ?? ''
  const ok = !!phone.trim() && !!who
  const submit = async () => {
    setBusy(true)
    try {
      const outcome = await addTeamPerson({ groupId: team.id, phone, ...(mode === 'new' ? { fullName: name } : { profileId }) })
      toast.success(outcome === 'invited' ? `Invite sent to ${who}` : `${who} is already in ${team.title}`)
      onClose(true)
    } catch (e) { toast.error(teamErrorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex gap-3 text-[13px]">
        <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> New person</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'team'} onChange={() => setMode('team')} disabled={!pickable.length} /> From your team</label>
      </div>
      {mode === 'new'
        ? <Input aria-label="Name" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        : (
          <select aria-label="Team member" className="h-10 rounded-md border px-2 text-[14px]" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">Choose a person…</option>
            {pickable.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        )}
      <Input aria-label="WhatsApp number" placeholder="WhatsApp number, e.g. +44 7700 900123" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <p className="text-[12px] text-muted-foreground">They get a WhatsApp invite and join with one tap. Nothing else is sent until they tap Join.</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
        <Button disabled={!ok || busy} onClick={submit}>{busy ? 'Sending…' : 'Send invite'}</Button>
      </div>
    </div>
  )
}
