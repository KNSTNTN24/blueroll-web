'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, Link2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createShare, listInspectorShares, revokeShare, TTL } from '@/lib/haccp-plan/share'
import { fmtDate } from './parts'

const EXPIRY = [
  { label: '1 day', ms: TTL.day },
  { label: '7 days', ms: TTL.week },
  { label: '30 days', ms: TTL.month },
]

export function ShareDialog({ open, onOpenChange, businessId, siteId, userId }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  businessId: string
  siteId: string | null
  userId: string
}) {
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [ttl, setTtl] = useState(TTL.week)
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null)
  const key = ['haccp-plan-shares', businessId, siteId]

  const { data: shares = [] } = useQuery({ queryKey: key, queryFn: () => listInspectorShares(businessId, siteId), enabled: open })

  const create = useMutation({
    mutationFn: () => createShare({ kind: 'inspector', businessId, siteId, userId, label, ttlMs: ttl }),
    onSuccess: (r) => {
      setCreated({ url: r.url, expiresAt: r.expiresAt })
      setLabel('')
      qc.invalidateQueries({ queryKey: key })
    },
    onError: () => toast.error('Could not create the link. Only owners and managers can share the plan.'),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeShare(id),
    onSuccess: () => { toast.success('Link withdrawn'); qc.invalidateQueries({ queryKey: key }) },
    onError: () => toast.error('Could not withdraw the link'),
  })

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      toast.error('Copy failed — select the link and copy it')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setCreated(null); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Share with an inspector</DialogTitle>
          <DialogDescription>A read-only link to this site’s HACCP Plan with live records. No login needed.</DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col gap-3">
            <label className="text-[12.5px] font-medium" htmlFor="plan-link">Link</label>
            <div className="flex gap-2">
              <input id="plan-link" readOnly value={created.url} onFocus={(e) => e.currentTarget.select()}
                className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-muted px-3 text-[13px]" />
              <button type="button" onClick={() => copy(created.url)}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-3.5 text-[13px] font-medium text-background">
                <Copy className="h-3.5 w-3.5" strokeWidth={1.7} /> Copy
              </button>
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              This link is shown once. Anyone with it can view this plan until {fmtDate(created.expiresAt, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.
            </p>
            <button type="button" onClick={() => setCreated(null)} className="self-start text-[13px] font-medium text-[#1f7a52]">Create another link</button>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
            <div className="flex flex-col gap-1.5">
              <label className="text-[12.5px] font-medium" htmlFor="plan-label">Label (optional)</label>
              <input id="plan-label" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. EHO visit 14 Oct"
                className="h-10 rounded-lg border border-input px-3 text-[13px]" />
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-[12.5px] font-medium">Link expires after</legend>
              <div className="flex gap-2">
                {EXPIRY.map((x) => (
                  <label key={x.label} className={`flex h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border text-[13px] font-medium ${ttl === x.ms ? 'border-foreground bg-foreground text-background' : 'border-input'}`}>
                    <input type="radio" name="plan-ttl" className="sr-only" checked={ttl === x.ms} onChange={() => setTtl(x.ms)} />
                    {x.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit" disabled={create.isPending}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#1f9d63] text-[13.5px] font-semibold text-white disabled:opacity-60">
              <Link2 className="h-4 w-4" strokeWidth={1.8} /> {create.isPending ? 'Creating…' : 'Create link'}
            </button>
          </form>
        )}

        {shares.length > 0 && (
          <div className="mt-2 flex flex-col gap-2 border-t pt-4">
            <div className="text-[12.5px] font-medium">Active links</div>
            {shares.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[12.5px]">
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.label || 'Inspector link'}</div>
                  <div className="text-muted-foreground">
                    Expires {fmtDate(s.expires_at, { day: 'numeric', month: 'short' })} · {s.view_count} {s.view_count === 1 ? 'view' : 'views'}
                    {s.last_viewed_at ? ` · last ${fmtDate(s.last_viewed_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                  </div>
                </div>
                <button type="button" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending}
                  className="h-9 shrink-0 rounded-lg border px-3 font-medium text-[#b3392f]">Withdraw</button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
