'use client'

import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Check, BellRing } from 'lucide-react'

interface Signoff {
  site_id: string
  signed_by_name: string | null
  signed_at: string
}

/**
 * Per-site HACCP sign-off. The pack is one shared document for the group; each
 * site's manager confirms it matches their kitchen. Shown only for multi-site groups.
 */
export function SiteSignoff() {
  const business = useAuthStore((s) => s.business)
  const profile = useAuthStore((s) => s.profile)
  const sites = useAuthStore((s) => s.sites)
  const currentSiteId = useAuthStore((s) => s.currentSiteId)
  const qc = useQueryClient()
  const bid = business?.id

  const { data: signoffs = [] } = useQuery({
    queryKey: ['haccp-signoffs', bid],
    enabled: !!bid && sites.length > 1,
    queryFn: async () => {
      const { data } = await supabase
        .from('haccp_signoffs')
        .select('site_id, signed_by_name, signed_at')
        .eq('business_id', bid!)
      return (data ?? []) as Signoff[]
    },
  })

  const byId = useMemo(() => {
    const m = new Map<string, Signoff>()
    signoffs.forEach((s) => m.set(s.site_id, s))
    return m
  }, [signoffs])

  const pendingCount = sites.filter((s) => !byId.has(s.id)).length

  // The current single-site scope, if it hasn't signed yet — enables a Confirm action.
  const scopedPending = currentSiteId && !byId.has(currentSiteId)
    ? sites.find((s) => s.id === currentSiteId) ?? null
    : null

  async function confirmSite(siteId: string) {
    if (!bid) return
    const { error } = await supabase.from('haccp_signoffs').insert({
      business_id: bid,
      site_id: siteId,
      signed_by: profile?.id ?? null,
      signed_by_name: profile?.full_name ?? null,
    })
    if (error) { toast.error(error.message); return }
    toast.success('Pack signed off for this site')
    qc.invalidateQueries({ queryKey: ['haccp-signoffs', bid] })
  }

  function remind(siteName: string) {
    toast.success(`Reminder sent to ${siteName}`)
  }

  if (sites.length <= 1) return null

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,.03)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold text-foreground">Site sign-off</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Each manager confirms the pack matches how their kitchen works ·{' '}
            <span className="font-semibold text-foreground">{sites.length - pendingCount}/{sites.length}</span> signed
          </p>
        </div>
        {scopedPending && (
          <button
            onClick={() => confirmSite(scopedPending.id)}
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.4} /> Confirm for {scopedPending.name}
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {sites.map((s) => {
          const so = byId.get(s.id)
          const active = currentSiteId === s.id
          return (
            <div
              key={s.id}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2 py-2',
                active && 'bg-brand-tint/50',
              )}
            >
              <span
                className={cn('h-1.5 w-1.5 shrink-0 rounded-full', so ? 'bg-brand' : 'bg-warn')}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-foreground">{s.name}</div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {so
                    ? `Signed off ${fmt(so.signed_at)}${so.signed_by_name ? ` · ${so.signed_by_name}` : ''}`
                    : 'Pending — not yet confirmed'}
                </div>
              </div>
              {!so && (
                <button
                  onClick={() => remind(s.name)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[12px] font-semibold text-muted-foreground transition-colors hover:border-input hover:text-foreground"
                >
                  <BellRing className="h-3 w-3" strokeWidth={1.8} /> Remind
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
