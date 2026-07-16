'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Check } from 'lucide-react'

interface Signoff { site_id: string; signed_by_name: string | null; signed_at: string }

/**
 * Sign-off status for the CURRENT site, as a header pill.
 *
 * The pack is one shared document for the group; each site's manager confirms it
 * matches their kitchen. In the single-site scope we only ever show this site's
 * own status — the estate-wide list lives on the All-sites dashboard.
 */
export function SiteSignoffBadge() {
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
      const { data } = await supabase.from('haccp_signoffs').select('site_id, signed_by_name, signed_at').eq('business_id', bid!)
      return (data ?? []) as Signoff[]
    },
  })

  if (sites.length <= 1 || !currentSiteId) return null

  const so = signoffs.find((s) => s.site_id === currentSiteId)
  const canSign = profile?.role === 'owner' || profile?.role === 'manager'

  async function confirm() {
    if (!bid || !currentSiteId) return
    const { error } = await supabase.from('haccp_signoffs').insert({
      business_id: bid, site_id: currentSiteId, signed_by: profile?.id ?? null, signed_by_name: profile?.full_name ?? null,
    })
    if (error) { toast.error(error.message); return }
    toast.success('Pack signed off for this site')
    qc.invalidateQueries({ queryKey: ['haccp-signoffs', bid] })
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  if (so) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: "600 12.5px 'Geist'", padding: '7px 12px', borderRadius: 20, whiteSpace: 'nowrap', background: '#eaf4ee', color: '#1f7a52' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f9d63' }} />
        Signed off {fmt(so.signed_at)}
      </span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: "600 12.5px 'Geist'", padding: '7px 12px', borderRadius: 20, whiteSpace: 'nowrap', background: '#fbf1e1', color: '#b07d1e' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d98a1a' }} />
        Awaiting sign-off
      </span>
      {canSign && (
        <button onClick={confirm}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: '#1f9d63', color: '#fff', font: "600 12.5px 'Geist'", padding: '7px 12px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#1a8a56')} onMouseLeave={(e) => (e.currentTarget.style.background = '#1f9d63')}>
          <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> Confirm
        </button>
      )}
    </span>
  )
}
