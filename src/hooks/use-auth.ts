'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'

async function loadProfileAndBusiness(userId: string) {
  const store = useAuthStore.getState()
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (!profile) {
      store.setProfile(null)
      store.setBusiness(null)
      return
    }

    store.setProfile(profile)

    if (profile.business_id) {
      const { data: business } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', profile.business_id)
        .single()
      store.setBusiness(business)
    }
  } catch {
    store.setProfile(null)
    store.setBusiness(null)
  }
}

export function useAuth() {
  const store = useAuthStore()

  useEffect(() => {
    let mounted = true
    let initialLoaded = false

    const timeoutId = setTimeout(() => {
      if (mounted && store.isLoading) store.setLoading(false)
    }, 2000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted || (!initialLoaded && event === 'INITIAL_SESSION')) return
        const user = session?.user ?? null
        useAuthStore.getState().setUser(user)
        if (user) await loadProfileAndBusiness(user.id)
        else { useAuthStore.getState().setProfile(null); useAuthStore.getState().setBusiness(null) }
        useAuthStore.getState().setLoading(false)
      }
    )

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return
      initialLoaded = true
      clearTimeout(timeoutId)
      const user = session?.user ?? null
      useAuthStore.getState().setUser(user)
      if (user) await loadProfileAndBusiness(user.id)
      useAuthStore.getState().setLoading(false)
    }).catch(() => {
      if (mounted) { initialLoaded = true; clearTimeout(timeoutId); useAuthStore.getState().setLoading(false) }
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
      await supabase.auth.signOut()
      useAuthStore.getState().reset()
    },
    refreshProfile: async () => {
      const u = useAuthStore.getState().user
      if (u) await loadProfileAndBusiness(u.id)
    },
  }
}
