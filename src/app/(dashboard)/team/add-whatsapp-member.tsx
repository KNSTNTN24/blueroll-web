'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createWhatsAppMember, CHANNELS, type Channel } from '@/lib/whatsapp/client'

export function AddWhatsAppMemberDialog({ roles, sites, defaultSiteId, channels, onCreated, onClose }: {
  roles: { id: string; name: string; base_tier: string }[]; sites: { id: string; name: string }[]; defaultSiteId: string | null
  channels: Channel[]
  onCreated: (profileId: string, name: string, channel: Channel) => void; onClose: () => void
}) {
  const [name, setName] = useState('')
  const assignable = roles.filter((r) => r.base_tier !== 'owner')
  const [roleId, setRoleId] = useState(assignable.find((r) => r.base_tier === 'kitchen_staff')?.id ?? assignable[0]?.id ?? '')
  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? '')
  const [channel, setChannel] = useState<Channel>(channels[0] ?? 'whatsapp')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try { const id = await createWhatsAppMember({ full_name: name.trim(), role_id: roleId, site_id: siteId }); onCreated(id, name.trim(), channel) }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[380px] rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px] font-semibold">Add staff without app login</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">For staff who complete checks in chat and don&apos;t need an app login.</p>
        <div className="mt-4 flex flex-col gap-3">
          <Input aria-label="Name" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <select aria-label="Role" className="h-10 rounded-md border px-2 text-[14px]" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {channels.length > 1 && (
            <select aria-label="Channel" className="h-10 rounded-md border px-2 text-[14px]" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {channels.map((c) => <option key={c} value={c}>{CHANNELS[c].label}</option>)}
            </select>
          )}
          {sites.length > 1 && (
            <select aria-label="Site" className="h-10 rounded-md border px-2 text-[14px]" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim() || !roleId || !siteId || busy} onClick={submit}>{busy ? 'Adding…' : 'Add and connect'}</Button>
        </div>
      </div>
    </div>
  )
}
