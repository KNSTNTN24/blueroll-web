'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore, readPersistedSite } from '@/stores/auth-store'
import { isDemoPersisted, applyDemoOverlay, persistDemo } from '@/lib/demo'

// Module-level flag so the Stripe sync runs at most once per browser session.
// Webhook is the primary source of truth for subscription state; this is just
// a safety net for the rare case where a webhook event was lost or hasn't
// been delivered yet (Stripe retries up to ~3 days).
let stripeSyncRanThisSession = false

async function syncSubscriptionFromStripe(): Promise<void> {
  const business = useAuthStore.getState().business
  if (!business?.stripe_customer_id) return // No Stripe customer — nothing to sync.

  try {
    await supabase.functions.invoke('manage-subscription', {
      body: {
        action: 'sync',
        customerId: business.stripe_customer_id,
        businessId: business.id,
      },
    })
    // sync() updates businesses.subscription_status + trial_ends_at in DB.
    // Re-fetch so the local store reflects what the webhook may have missed.
    const { data: fresh } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', business.id)
      .maybeSingle()
    if (fresh) useAuthStore.getState().setBusiness(fresh)
  } catch (e) {
    // Non-fatal — webhook will catch the next event anyway.
    console.warn('[useAuth] Stripe sync failed (non-fatal):', e)
  }
}

async function loadProfileAndBusiness(userId: string, retry = 0): Promise<void> {
  const store = useAuthStore.getState()
  const MAX_RETRIES = 5
  const BACKOFF_MS = 500

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) throw error

    if (!profile || !profile.business_id) {
      // Profile missing or business_id not set yet (onboarding in progress).
      // Retry with backoff — the signup flow may still be writing.
      if (retry < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS * (retry + 1)))
        return loadProfileAndBusiness(userId, retry + 1)
      }
      // Give up — set whatever we have (profile without business is valid for onboarding redirect)
      if (profile) store.setProfile(profile)
      else store.setProfile(null)
      store.setBusiness(null)
      return
    }

    store.setProfile(profile)

    const { data: business } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', profile.business_id)
      .maybeSingle()

    if (business) {
      store.setBusiness(business)
      store.setRealBusiness(business)

      // Load the group's sites and pick the active one.
      const { data: sites } = await supabase
        .from('sites')
        .select('*')
        .eq('business_id', business.id)
        .neq('status', 'removed')
        .order('name')
      const siteList = sites ?? []
      store.setSites(siteList)

      const persisted = readPersistedSite()
      let active: string | null = useAuthStore.getState().currentSiteId
      if (!active || !siteList.some((s) => s.id === active)) {
        if (persisted && siteList.some((s) => s.id === persisted)) active = persisted
        else if (profile.is_group_admin) active = siteList.length > 1 ? null : (siteList[0]?.id ?? null)
        else active = profile.site_id ?? siteList[0]?.id ?? null
      }
      store.setCurrentSiteId(active)

      // Demo mode: overlay the shared showcase business on top of the real
      // one. realBusiness keeps driving the paywall gate; if the demo rows
      // are unreadable (migration not applied) fall back to real data.
      if (isDemoPersisted()) {
        const ok = await applyDemoOverlay()
        if (!ok) {
          persistDemo(false)
          store.setDemoMode(false)
        }
      }
    } else if (retry < MAX_RETRIES) {
      // Business row might not be committed yet
      await new Promise((r) => setTimeout(r, BACKOFF_MS * (retry + 1)))
      return loadProfileAndBusiness(userId, retry + 1)
    } else {
      store.setBusiness(null)
    }
  } catch (e) {
    console.error('[useAuth] loadProfileAndBusiness error:', e)
    if (retry < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS * (retry + 1)))
      return loadProfileAndBusiness(userId, retry + 1)
    }
    store.setProfile(null)
    store.setBusiness(null)
  }
}

/** Re-fetch the signed-in user's own profile/business/sites into the store. */
export async function reloadRealBusiness(): Promise<void> {
  const u = useAuthStore.getState().user
  if (u) await loadProfileAndBusiness(u.id)
}

export function useAuth() {
  const store = useAuthStore()

  useEffect(() => {
    let mounted = true

    const timeoutId = setTimeout(() => {
      if (mounted && store.isLoading) store.setLoading(false)
    }, 8000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return
        if (event === 'INITIAL_SESSION') return
        const user = session?.user ?? null
        useAuthStore.getState().setUser(user)
        useAuthStore.getState().setLoading(false)
        if (user) {
          // Load profile/business in background — don't block UI
          void loadProfileAndBusiness(user.id)
        } else {
          useAuthStore.getState().setProfile(null)
          useAuthStore.getState().setBusiness(null)
        }
      }
    )

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return
      clearTimeout(timeoutId)
      const user = session?.user ?? null
      useAuthStore.getState().setUser(user)
      useAuthStore.getState().setLoading(false) // unblock UI immediately
      if (user) {
        // Load profile/business, then opportunistically sync subscription
        // state from Stripe (once per session). Webhook keeps the DB fresh
        // in real time; this catches any missed events on page load.
        await loadProfileAndBusiness(user.id)
        if (mounted && !stripeSyncRanThisSession) {
          stripeSyncRanThisSession = true
          void syncSubscriptionFromStripe()
        }
      }
    }).catch(() => {
      if (mounted) { clearTimeout(timeoutId); useAuthStore.getState().setLoading(false) }
    })

    return () => { mounted = false; clearTimeout(timeoutId); subscription.unsubscribe() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscription gating.
  //
  // A `trialing` status is honoured until `trial_ends_at` passes — after that
  // the row is treated as not-subscribed until something (webhook, manual
  // sync) flips it to `active`. This prevents the migrated grace period
  // (trial_ends_at = NOW + 10 days for previously-`none` businesses) from
  // turning into permanent free access.
  // Gate on the user's OWN business even while demo mode overlays `business` —
  // browsing the demo must never extend (or cut short) anyone's access.
  const gatingBusiness = store.realBusiness ?? store.business
  const sub = gatingBusiness?.subscription_status
  const trialEnd = gatingBusiness?.trial_ends_at
  const trialExpired = !!(
    sub === 'trialing' && trialEnd && new Date(trialEnd) < new Date()
  )
  const isSubscribed =
    sub === 'active' || (sub === 'trialing' && !trialExpired)

  return {
    ...store,
    isSubscribed,
    isManager: store.profile?.role === 'owner' || store.profile?.role === 'manager',
    canManageRecipes: ['owner', 'manager', 'chef'].includes(store.profile?.role ?? ''),
    signIn: async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    signUp: async (email: string, password: string) => {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) throw error
    },
    signOut: async () => {
      useAuthStore.getState().reset()
      await supabase.auth.signOut()
    },
    refreshProfile: async () => {
      const u = useAuthStore.getState().user
      if (u) await loadProfileAndBusiness(u.id)
    },
  }
}
