'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'

export function useAuth() {
  const store = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const user = session?.user ?? null
        store.setUser(user)

        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single()

          store.setProfile(profile)

          if (profile) {
            const { data: business } = await supabase
              .from('businesses')
              .select('*')
              .eq('id', profile.business_id)
              .single()

            store.setBusiness(business)
          }
        } else {
          store.setProfile(null)
          store.setBusiness(null)
        }

        store.setLoading(false)
      }
    )

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const user = session?.user ?? null
      store.setUser(user)

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()

        store.setProfile(profile)

        if (profile) {
          const { data: business } = await supabase
            .from('businesses')
            .select('*')
            .eq('id', profile.business_id)
            .single()

          store.setBusiness(business)
        }
      }

      store.setLoading(false)
    })

    return () => subscription.unsubscribe()
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

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', store.user!.id)
      .single()

    store.setProfile(profile)

    if (profile) {
      const { data: business } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', profile.business_id)
        .single()

      store.setBusiness(business)
    }
  }

  const joinWithInvite = async (token: string, memberName: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('join_with_invite', {
      invite_token: token,
      member_name: memberName,
    })
    if (error) throw error

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', store.user!.id)
      .single()

    store.setProfile(profile)

    if (profile) {
      const { data: business } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', profile.business_id)
        .single()

      store.setBusiness(business)
    }
  }

  const refreshProfile = async () => {
    if (!store.user) return
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', store.user.id)
      .single()
    store.setProfile(profile)
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
