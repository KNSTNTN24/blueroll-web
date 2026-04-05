'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'

async function loadProfileAndBusiness(userId: string, store: ReturnType<typeof useAuthStore.getState>) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    store.setProfile(profile)

    if (profile?.business_id) {
      const { data: business } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', profile.business_id)
        .single()

      store.setBusiness(business)
    }
  } catch {
    // Profile doesn't exist yet — user needs onboarding
    store.setProfile(null)
    store.setBusiness(null)
  }
}

export function useAuth() {
  const store = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    let mounted = true

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return
        const user = session?.user ?? null
        store.setUser(user)

        if (user) {
          await loadProfileAndBusiness(user.id, store)
        } else {
          store.setProfile(null)
          store.setBusiness(null)
        }

        store.setLoading(false)
      }
    )

    // Initial session check with timeout
    const timeoutId = setTimeout(() => {
      if (mounted && store.isLoading) {
        // If still loading after 5s, assume no session
        store.setLoading(false)
      }
    }, 5000)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return
      clearTimeout(timeoutId)

      const user = session?.user ?? null
      store.setUser(user)

      if (user) {
        await loadProfileAndBusiness(user.id, store)
      }

      store.setLoading(false)
    }).catch(() => {
      if (!mounted) return
      clearTimeout(timeoutId)
      store.setLoading(false)
    })

    return () => {
      mounted = false
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    store.reset()
    router.push('/login')
  }

  const setupBusiness = async (params: {
    businessName: string
    ownerName: string
    businessAddress?: string
    fhrsId?: number
    fsaRating?: string
    postCode?: string
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('setup_business', {
      business_name: params.businessName,
      owner_name: params.ownerName,
      business_address: params.businessAddress,
      p_fhrs_id: params.fhrsId,
      p_fsa_rating: params.fsaRating,
      p_post_code: params.postCode,
    })
    if (error) throw error
    await loadProfileAndBusiness(store.user!.id, store)
  }

  const joinWithInvite = async (token: string, memberName: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('join_with_invite', {
      invite_token: token,
      member_name: memberName,
    })
    if (error) throw error
    await loadProfileAndBusiness(store.user!.id, store)
  }

  const refreshProfile = async () => {
    if (!store.user) return
    await loadProfileAndBusiness(store.user.id, store)
  }

  return {
    ...store,
    signIn,
    signUp,
    signOut,
    setupBusiness,
    joinWithInvite,
    refreshProfile,
    isManager: store.profile?.role === 'owner' || store.profile?.role === 'manager',
    canManageRecipes:
      store.profile?.role === 'owner' ||
      store.profile?.role === 'manager' ||
      store.profile?.role === 'chef',
  }
}
