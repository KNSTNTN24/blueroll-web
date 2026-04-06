'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  // Check session on mount
  useEffect(() => {
    let mounted = true
    const timeout = setTimeout(() => {
      if (mounted) setCheckingSession(false)
    }, 3000)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted || !session?.user) {
        if (mounted) setCheckingSession(false)
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('business_id')
        .eq('id', session.user.id)
        .single()

      if (!mounted) return

      if (!profile) {
        setCheckingSession(false)
        return
      }

      // Check subscription
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
        router.replace('/paywall')
      }
    }).catch(() => {
      if (mounted) setCheckingSession(false)
    })

    return () => {
      mounted = false
      clearTimeout(timeout)
    }
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        if (signInError.message.includes('Invalid login credentials')) {
          setError('Invalid email or password')
        } else if (signInError.message.includes('Email not confirmed')) {
          setError('Email not confirmed')
        } else {
          setError(signInError.message)
        }
        setLoading(false)
        return
      }

      // Get the session to check profile
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        setError('Something went wrong. Please try again.')
        setLoading(false)
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('business_id')
        .eq('id', session.user.id)
        .single()

      if (!profile) {
        router.replace('/onboarding')
        return
      }

      const { data: business } = await supabase
        .from('businesses')
        .select('subscription_status')
        .eq('id', profile.business_id)
        .single()

      const status = business?.subscription_status
      if (status === 'active' || status === 'trialing') {
        router.replace('/dashboard')
      } else {
        router.replace('/paywall')
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Sign in</h1>
          <p className="mt-1 text-sm text-gray-500">
            Welcome back to Blueroll
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              placeholder="Your password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Signing in...
              </span>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Don&apos;t have an account?{' '}
          <Link href="/onboarding" className="font-medium text-emerald-600 hover:text-emerald-500">
            Create account
          </Link>
        </p>
      </div>
    </div>
  )
}
