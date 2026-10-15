'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_STYLE, LINK_CODE_TTL_SEC, disconnectGoogle, getConnection, getReplyStyle, issueReviewsLinkCode, listLocations,
  listReviewGroups, refreshLocations, saveReplyStyle, setGroupSites, startGoogleConnect, syncNow, unlinkReviewGroup,
  updateLocation, type GoogleLocationRow, type ReplyStyle, type ReviewGroup,
} from '@/lib/reviews/api'
import { REVIEW_LINK_STEPS, googleResultFromQuery, routeDiff } from '@/lib/reviews/format'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'not yet')

/** Settings → Google reviews (manage_reviews): connect Google, map restaurants to sites, route to Telegram groups, reply style. */
export function GoogleReviewsSettings() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const qc = useQueryClient()
  const bid = business?.id
  const connKey = ['google-connection', bid]
  const { data: conn, isLoading } = useQuery({ queryKey: connKey, enabled: !!bid, queryFn: () => getConnection(bid!) })
  const { data: locations = [] } = useQuery({ queryKey: ['google-locations', conn?.id], enabled: !!conn?.id, queryFn: () => listLocations(conn!.id) })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const r = googleResultFromQuery(window.location.search)
    if (!r) return
    if (r.ok) toast.success(r.text); else toast.error(r.text)
    window.history.replaceState(null, '', '/settings?tab=reviews')
  }, [])

  if (!business) return null
  const refreshAll = () => { qc.invalidateQueries({ queryKey: connKey }); qc.invalidateQueries({ queryKey: ['google-locations'] }) }
  const run = async (f: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try { await f(); if (ok) toast.success(ok); refreshAll() } catch (e) { toast.error(errText(e)) } finally { setBusy(false) }
  }
  const connect = async () => { setBusy(true); try { window.location.href = await startGoogleConnect() } catch (e) { toast.error(errText(e)); setBusy(false) } }
  const disconnect = () => {
    if (!window.confirm('Disconnect Google? New reviews stop arriving and the buttons on open review cards are removed. Imported reviews stay.')) return
    run(disconnectGoogle, 'Google disconnected')
  }
  const enabledCount = locations.filter((l) => l.enabled).length

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[25px] font-bold tracking-[-0.02em]">Google reviews</h1>
        <p className="mt-1.5 text-[14px] text-muted-foreground">New Google reviews arrive in your managers’ Telegram group with a suggested reply. Nothing is posted to Google until someone presses Publish.</p>
      </div>

      <section className="rounded-xl border p-5">
        {isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p> : !conn ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-[560px]">
              <h2 className="text-[15px] font-semibold">Connect Google</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">Sign in with the Google account that manages your restaurants on Google Maps. Blueroll will read your reviews and post replies only when your team presses Publish.</p>
              <p className="mt-2 text-[12px] text-muted-foreground">Your restaurants must be verified on Google Business Profile, and the account must be their Owner or Manager.</p>
            </div>
            <Button disabled={busy} onClick={connect}>{busy ? 'Opening Google…' : 'Connect Google'}</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Connected as {conn.google_email}</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">{enabledCount} restaurant{enabledCount === 1 ? '' : 's'} syncing · last checked {fmtTime(conn.last_sync_at)}</p>
              {conn.status === 'error' && <p className="mt-2 text-[13px] text-red-700">Google stopped accepting our access. Connect again to resume.</p>}
            </div>
            <div className="flex gap-2">
              {conn.status === 'error'
                ? <Button disabled={busy} onClick={connect}>Reconnect</Button>
                : <Button variant="outline" disabled={busy} onClick={() => run(async () => { const r = await syncNow(); toast.success(`Checked — ${r.delivered} new review${r.delivered === 1 ? '' : 's'} sent`) })}>Check now</Button>}
              <Button variant="outline" disabled={busy} onClick={disconnect}>Disconnect</Button>
            </div>
          </div>
        )}
      </section>

      {conn && (
        <section className="rounded-xl border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Restaurants</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">Choose the Blueroll site for each Google listing and switch on sync.</p>
            </div>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => run(refreshLocations, 'Restaurants updated')}>Check Google again</Button>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {locations.map((l) => <LocationRow key={`${l.id}:${l.site_id}:${l.enabled}`} loc={l} sites={sites} onChanged={refreshAll} />)}
          </div>
        </section>
      )}

      {conn && <ReviewGroups businessId={business.id} sites={sites} />}
      {conn && <ReplyStyleForm businessId={business.id} />}
    </div>
  )
}

function LocationRow({ loc, sites, onChanged }: { loc: GoogleLocationRow; sites: { id: string; name: string }[]; onChanged: () => void }) {
  const save = async (patch: { site_id?: string | null; enabled?: boolean }) => {
    try { await updateLocation(loc.id, patch); onChanged() } catch (e) { toast.error(errText(e)) }
  }
  const label = `sync-${loc.id}`
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <div className="min-w-[200px] flex-1">
        <p className="text-[13.5px] font-medium">{loc.title || 'Google listing'}</p>
        <p className="text-[12px] text-muted-foreground">{loc.address}</p>
        {!loc.can_reply && <p className="mt-1 text-[12px] text-amber-700">Not verified on Google — replies are disabled</p>}
      </div>
      <select className="rounded-md border px-2 py-1.5 text-[13px]" value={loc.site_id ?? ''} aria-label={`Site for ${loc.title}`}
        onChange={(e) => save({ site_id: e.target.value || null, ...(e.target.value ? {} : { enabled: false }) })}>
        <option value="">Not linked</option>
        {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <span id={label} className="text-[12.5px]">Sync</span>
      <Switch aria-labelledby={label} checked={loc.enabled} disabled={!loc.can_reply || !loc.site_id} onCheckedChange={(v) => save({ enabled: v })} />
    </div>
  )
}

function ReviewGroups({ businessId, sites }: { businessId: string; sites: { id: string; name: string }[] }) {
  const qc = useQueryClient()
  const [linking, setLinking] = useState(false)
  const key = ['review-groups', businessId]
  const { data: groups = [] } = useQuery({ queryKey: key, queryFn: () => listReviewGroups(businessId), refetchInterval: linking ? 5000 : false })
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  return (
    <section className="rounded-xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Where to send reviews</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Link your managers’ Telegram group and choose which restaurants it gets. Anyone in a linked group can publish replies on Google.</p>
        </div>
        <Button onClick={() => setLinking(true)}>Link a Telegram group</Button>
      </div>
      {groups.length === 0
        ? <p className="mt-4 text-[13px] text-muted-foreground">No groups linked yet. Reviews still appear on the Reviews page.</p>
        : <div className="mt-4 flex flex-col gap-3">{groups.map((g) => <GroupSites key={`${g.id}:${g.site_ids.join(',')}`} businessId={businessId} group={g} sites={sites} onChanged={refresh} />)}</div>}
      {linking && <LinkDialog onClose={() => { setLinking(false); refresh() }} />}
    </section>
  )
}

function GroupSites({ businessId, group, sites, onChanged }: { businessId: string; group: ReviewGroup; sites: { id: string; name: string }[]; onChanged: () => void }) {
  const [selected, setSelected] = useState(group.site_ids)
  const [busy, setBusy] = useState(false)
  const diff = routeDiff(group.site_ids, selected)
  const dirty = diff.add.length + diff.remove.length > 0
  const save = async () => {
    setBusy(true)
    try { await setGroupSites(businessId, group.id, group.site_ids, selected); toast.success('Saved'); onChanged() }
    catch (e) { toast.error(errText(e)) } finally { setBusy(false) }
  }
  const unlink = async () => {
    if (!window.confirm(`Unlink “${group.title}”? New reviews stop going there.`)) return
    try { await unlinkReviewGroup(group.id); onChanged() } catch (e) { toast.error(errText(e)) }
  }
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{group.title}</p>
        <Button variant="outline" size="sm" onClick={unlink}>Unlink</Button>
      </div>
      <fieldset className="mt-3">
        <legend className="text-[12.5px] font-semibold text-muted-foreground">Restaurants this group gets</legend>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {sites.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="size-4 accent-[#1f9d63]" checked={selected.includes(s.id)}
                onChange={() => setSelected((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]))} />
              <span>{s.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setSelected(group.site_ids)}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
    </div>
  )
}

function LinkDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(LINK_CODE_TTL_SEC)
  useEffect(() => {
    let alive = true
    issueReviewsLinkCode().then((c) => { if (alive) setCode(c) }).catch((e: unknown) => { if (alive) setError(errText(e)) })
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div role="dialog" aria-modal="true" aria-labelledby="link-reviews-title" className="w-[420px] max-w-full rounded-2xl bg-card p-6 shadow-xl">
        <h2 id="link-reviews-title" className="text-[17px] font-semibold">Link a Telegram group</h2>
        {error ? <p className="mt-2 text-[13px] text-red-700">{error}</p> : (
          <>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px]">{REVIEW_LINK_STEPS(code ?? '······').map((s) => <li key={s}>{s}</li>)}</ol>
            <p className="mt-4 text-center font-mono text-[24px] tracking-[0.2em]">{code ?? '······'}</p>
            <p className="mt-1 text-center text-[12px] text-muted-foreground">
              {left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired — close and try again'}
            </p>
          </>
        )}
        <div className="mt-4 flex justify-end"><Button variant="outline" onClick={onClose}>Done</Button></div>
      </div>
    </div>
  )
}

function ReplyStyleForm({ businessId }: { businessId: string }) {
  const { data } = useQuery({ queryKey: ['review-style', businessId], queryFn: () => getReplyStyle(businessId) })
  const [s, setS] = useState<ReplyStyle>(DEFAULT_STYLE)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data) setS({ ...data, examples: [...data.examples, '', '', ''].slice(0, 3) }) }, [data])
  const examples = useMemo(() => s.examples.length ? s.examples : ['', '', ''], [s.examples])
  const save = async () => {
    setBusy(true)
    try { await saveReplyStyle(businessId, s); toast.success('Reply style saved') } catch (e) { toast.error(errText(e)) } finally { setBusy(false) }
  }
  const field = 'mt-1 w-full rounded-md border px-3 py-2 text-[13px]'
  return (
    <section className="rounded-xl border p-5">
      <h2 className="text-[15px] font-semibold">Reply style</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">Optional. The defaults work well.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-[12.5px] font-semibold">Tone
          <select className={field} value={s.tone} onChange={(e) => setS({ ...s, tone: e.target.value as ReplyStyle['tone'] })}>
            <option value="warm">Warm</option><option value="neutral">Neutral</option><option value="formal">Formal</option>
          </select>
        </label>
        <label className="text-[12.5px] font-semibold">Sign-off
          <input className={field} maxLength={120} placeholder="— The Casa-Mia team" value={s.sign_off} onChange={(e) => setS({ ...s, sign_off: e.target.value })} />
        </label>
        <label className="text-[12.5px] font-semibold sm:col-span-2">Contact for complaints (used in food-safety replies)
          <input className={field} maxLength={200} placeholder="hello@yourrestaurant.co.uk" value={s.contact} onChange={(e) => setS({ ...s, contact: e.target.value })} />
        </label>
        <label className="text-[12.5px] font-semibold sm:col-span-2">Things never to say
          <textarea className={field} rows={2} maxLength={1000} value={s.avoid} onChange={(e) => setS({ ...s, avoid: e.target.value })} />
        </label>
        {examples.map((ex, i) => (
          <label key={i} className="text-[12.5px] font-semibold sm:col-span-2">Example reply {i + 1}
            <textarea className={field} rows={2} maxLength={1000} value={ex}
              onChange={(e) => { const next = [...examples]; next[i] = e.target.value; setS({ ...s, examples: next }) }} />
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end"><Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button></div>
    </section>
  )
}
