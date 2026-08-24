import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: string
  role_id: string | null
  business_id: string
  site_id: string | null
  is_group_admin: boolean
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
  stripe_customer_id: string | null
  haccp_auto_fill: boolean
  haccp_last_reviewed_at: string | null
  equipment: string[]
  created_at: string
}

export interface Site {
  id: string
  business_id: string
  name: string
  address: string | null
  postcode: string | null
  fsa_rating: string | null
  manager_id: string | null
  status: string
  created_at: string
}

const SITE_KEY = 'br_current_site'
function persistSite(id: string | null) {
  try { if (id) localStorage.setItem(SITE_KEY, id); else localStorage.removeItem(SITE_KEY) } catch {}
}
export function readPersistedSite(): string | null {
  try { return localStorage.getItem(SITE_KEY) } catch { return null }
}

interface AuthState {
  user: User | null
  profile: Profile | null
  business: Business | null
  /** The user's own business row — stays set while demo mode overlays `business`. */
  realBusiness: Business | null
  /** True while the store points at the shared demo business (read-only). */
  demoMode: boolean
  /** Direction of an in-flight demo switch; drives the content-area veil. */
  demoSwitching: 'enter' | 'exit' | null
  sites: Site[]
  /** null = "All sites" (group-admin estate view); otherwise the selected site. */
  currentSiteId: string | null
  isLoading: boolean
  setUser: (user: User | null) => void
  setProfile: (profile: Profile | null) => void
  setBusiness: (business: Business | null) => void
  setRealBusiness: (business: Business | null) => void
  setDemoMode: (on: boolean) => void
  setDemoSwitching: (dir: 'enter' | 'exit' | null) => void
  setSites: (sites: Site[]) => void
  setCurrentSiteId: (id: string | null) => void
  setLoading: (loading: boolean) => void
  reset: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  business: null,
  realBusiness: null,
  demoMode: false,
  demoSwitching: null,
  sites: [],
  currentSiteId: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setBusiness: (business) => set({ business }),
  setRealBusiness: (business) => set({ realBusiness: business }),
  setDemoMode: (on) => set({ demoMode: on }),
  setDemoSwitching: (dir) => set({ demoSwitching: dir }),
  setSites: (sites) => set({ sites }),
  setCurrentSiteId: (id) => { persistSite(id); set({ currentSiteId: id }) },
  setLoading: (isLoading) => set({ isLoading }),
  reset: () => set({ user: null, profile: null, business: null, realBusiness: null, demoMode: false, demoSwitching: null, sites: [], currentSiteId: null, isLoading: false }),
}))
