'use client'

import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import type { Tables } from '@/types/database'

interface AuthState {
  user: User | null
  profile: Tables<'profiles'> | null
  business: Tables<'businesses'> | null
  isLoading: boolean
  setUser: (user: User | null) => void
  setProfile: (profile: Tables<'profiles'> | null) => void
  setBusiness: (business: Tables<'businesses'> | null) => void
  setLoading: (loading: boolean) => void
  reset: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  business: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setBusiness: (business) => set({ business }),
  setLoading: (isLoading) => set({ isLoading }),
  reset: () => set({ user: null, profile: null, business: null, isLoading: false }),
}))
