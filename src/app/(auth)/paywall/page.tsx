'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { PAYWALL_FEATURES } from '@/lib/constants'

export default function PaywallPage() {
  const router = useRouter()
  const [checkingSession, setCheckingSession] = useState(true)
  const [startingTrial, setStartingTrial] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check if already subscribed
  useEffect(() => {
    let mounted = true
    const timeout = setTimeout(() => {
      if (mounted) setCheckingSession(false)
    }, 3000)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return

      if (!session?.user) {
        router.replace('/login')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('business_id')
        .eq('id', session.user.id)
        .single()

      if (!mounted) return

      if (!profile) {
        router.replace('/onboarding')
        return
      }

      const { data: business } = await supabase
        .from('businesses')
        .select('subscription_status')
        .eq('id', profile.business_id)
        .single()

      if (!mounted) return

      const status = business?.subscription_status
      if (status === 'active' || status === 'trialing') {
        router.replace('/dashboard')
      } else {
        setCheckingSession(false)
      }
    }).catch(() => {
      if (mounted) setCheckingSession(false)
    })

    return () => {
      mounted = false
      clearTimeout(timeout)
    }
  }, [router])

  async function handleStartTrial() {
    setStartingTrial(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        setError('Not authenticated. Please sign in again.')
        setStartingTrial(false)
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('business_id')
        .eq('id', session.user.id)
        .single()

      const { data, error: fnError } = await supabase.functions.invoke('create-subscription', {
        body: {
          userId: session.user.id,
          email: session.user.email,
          businessId: profile?.business_id,
          success_url: `${window.location.origin}/dashboard`,
          cancel_url: `${window.location.origin}/paywall`,
        },
      })

      if (fnError) {
        setError('Failed to start trial. Please try again.')
        setStartingTrial(false)
        return
      }

      const checkoutUrl = data?.checkoutUrl || data?.url
      if (checkoutUrl) {
        window.location.href = checkoutUrl
      } else {
        setError('Failed to start trial. Please try again.')
        setStartingTrial(false)
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setStartingTrial(false)
    }
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-emerald-700">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
          <p className="text-sm text-emerald-100">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-600 to-emerald-800">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <h1 className="text-3xl font-bold text-white">
            Everything you need for food safety
          </h1>

          <ul className="mt-8 space-y-4 text-left">
            {PAYWALL_FEATURES.map((feature) => (
              <li key={feature.title} className="flex items-start gap-3">
                <svg
                  className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-200"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <div>
                  <p className="font-medium text-white">{feature.title}</p>
                  <p className="text-sm text-emerald-100">{feature.subtitle}</p>
                </div>
              </li>
            ))}
          </ul>

          {error && (
            <div className="mt-6 rounded-lg bg-red-500/20 px-4 py-3 text-sm text-white border border-red-400/30">
              {error}
            </div>
          )}

          <button
            onClick={handleStartTrial}
            disabled={startingTrial}
            className="mt-8 w-full rounded-xl bg-white px-6 py-4 text-lg font-semibold text-emerald-700 shadow-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {startingTrial ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                Starting...
              </span>
            ) : (
              'Start free trial'
            )}
          </button>
          <p className="mt-2 text-sm text-emerald-100">
            then &pound;14.99/mo after 14 days
          </p>

          <div className="mt-8 space-y-2">
            <p className="text-sm text-emerald-200">
              14-day free trial. Cancel anytime. No charge until trial ends.
            </p>
            <div className="flex items-center justify-center gap-3 text-xs text-emerald-300">
              <a
                href="https://blueroll.app/terms.html"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-white"
              >
                Terms
              </a>
              <span>&middot;</span>
              <a
                href="https://blueroll.app/privacy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-white"
              >
                Privacy
              </a>
            </div>
          </div>

          {/* Temporary skip link */}
          <button
            onClick={() => { window.location.href = '/dashboard' }}
            className="mt-6 inline-block text-sm text-emerald-200 underline hover:text-white"
          >
            Continue to dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
