import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: string
  business_id: string
  avatar_url: string | null
  created_at: string
}

export interface Business {
  id: string
  name: string
  address: string | null
  fhrs_id: number | null
  fsa_rating: string | null
  post_code: string | null
  subscription_status: string | null
  trial_ends_at: string | null
  haccp_auto_fill: boolean
  haccp_last_reviewed_at: string | null
  equipment: string[]
  created_at: string
}

interface AuthState {
  user: User | null
  profile: Profile | null
  business: Business | null
  isLoading: boolean
  setUser: (user: User | null) => void
  setProfile: (profile: Profile | null) => void
  setBusiness: (business: Business | null) => void
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
