'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'

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

export function useAuth() {
  const store = useAuthStore()

  useEffect(() => {
    let mounted = true

    const timeoutId = setTimeout(() => {
      if (mounted && store.isLoading) store.setLoading(false)
    }, 8000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return
        // Skip INITIAL_SESSION — handled by getSession() below
        if (event === 'INITIAL_SESSION') return
        const user = session?.user ?? null
        useAuthStore.getState().setUser(user)
        if (user) await loadProfileAndBusiness(user.id)
        else { useAuthStore.getState().setProfile(null); useAuthStore.getState().setBusiness(null) }
        useAuthStore.getState().setLoading(false)
      }
    )

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return
      clearTimeout(timeoutId)
      const user = session?.user ?? null
      useAuthStore.getState().setUser(user)
      if (user) await loadProfileAndBusiness(user.id)
      useAuthStore.getState().setLoading(false)
    }).catch(() => {
      if (mounted) { clearTimeout(timeoutId); useAuthStore.getState().setLoading(false) }
    })

    return () => { mounted = false; clearTimeout(timeoutId); subscription.unsubscribe() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isSubscribed = store.business?.subscription_status === 'active' ||
    store.business?.subscription_status === 'trialing'

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
