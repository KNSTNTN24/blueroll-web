'use client'

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { ROLE_LABELS, type UserRole } from '@/lib/constants'

/**
 * Real, per-business names for the 5 preset role tiers.
 *
 * A preset can be renamed (e.g. "Kitchen Staff" → "Kitchen Monkey") — its
 * base_tier is unchanged, only roles.name differs. Checklists are still assigned
 * by base_tier, so this only affects how a tier is *labelled* in the UI. Falls
 * back to the built-in ROLE_LABELS before the query resolves.
 */
export function useRoleLabel(): (tier: UserRole | string) => string {
  const bid = useAuthStore((s) => s.business?.id)
  const { data } = useQuery({
    queryKey: ['role-labels', bid],
    enabled: !!bid,
    queryFn: async () => {
      const { data } = await supabase
        .from('roles')
        .select('base_tier, name')
        .eq('business_id', bid!)
        .eq('is_system', true)
      const m: Record<string, string> = {}
      for (const r of (data ?? []) as { base_tier: string; name: string }[]) m[r.base_tier] = r.name
      return m
    },
  })
  return (tier) => data?.[tier] ?? ROLE_LABELS[tier as UserRole] ?? String(tier)
}
