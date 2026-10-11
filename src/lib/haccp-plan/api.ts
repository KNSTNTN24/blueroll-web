import { supabase } from '@/lib/supabase'
import type { PlanBundle } from './types'

const FN = 'haccp-plan'

/** A member's own plan (RLS-equivalent checks run in the edge function). */
export async function fetchPlanBundleForSite(siteId: string | null): Promise<PlanBundle> {
  const { data, error } = await supabase.functions.invoke(FN, { body: { site_id: siteId } })
  if (error) throw error
  return data as PlanBundle
}

/** Public inspector / PDF view. 404 from the function = expired, revoked or unknown. */
export async function fetchPlanBundleByToken(token: string): Promise<PlanBundle | 'expired'> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const res = await fetch(`${base}/functions/v1/${FN}?t=${encodeURIComponent(token)}`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' },
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  })
  if (res.status === 404) return 'expired'
  if (!res.ok) throw new Error(`haccp-plan ${res.status}`)
  return (await res.json()) as PlanBundle
}

export async function signOffPlan(p: { businessId: string; siteId: string; userId: string; name: string }): Promise<void> {
  const { error } = await supabase.from('haccp_signoffs').upsert(
    { business_id: p.businessId, site_id: p.siteId, signed_by: p.userId, signed_by_name: p.name, signed_at: new Date().toISOString() },
    { onConflict: 'business_id,site_id' },
  )
  if (error) throw error
}
