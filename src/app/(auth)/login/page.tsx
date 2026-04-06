'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Loader2, ArrowRight } from 'lucide-react'
import { useBrand } from '../layout'

export default function LoginPage() {
  const router = useRouter()
  const { setContent } = useBrand()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    setContent({
      headline: 'Your kitchen is waiting for you.',
      subtitle: 'Pick up right where you left off — checklists, team updates, and compliance reports.',
    })
  }, [setContent])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        supabase
          .from('profiles')
          .select('id')
          .eq('id', session.user.id)
          .single()
          .then(({ data: profile }) => {
            if (profile) {
              router.replace('/dashboard')
            } else {
              setCheckingSession(false)
            }
          })
      } else {
        setCheckingSession(false)
      }
    }).catch(() => {
      setCheckingSession(false)
    })
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (authError) {
        if (authError.message.includes('Invalid login')) {
          setError('Invalid email or password')
        } else if (authError.message.includes('Email not confirmed')) {
          setError('Please check your email to confirm your account')
        } else {
          setError(authError.message)
        }
        setLoading(false)
        return
      }

      if (!data.user) {
        setError('Something went wrong. Please try again.')
        setLoading(false)
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', data.user.id)
        .single()

      if (profile) {
        router.push('/dashboard')
      } else {
        router.push('/onboarding')
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  if (checkingSession) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-[30px] font-bold tracking-tight text-gray-900">
        Welcome back
      </h1>
      <p className="mt-2 text-[15px] text-gray-400">
        Sign in to your account to continue.
      </p>

      <form onSubmit={handleSubmit} className="mt-10 space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="email" className="mb-2 block text-[13px] font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@restaurant.com"
            required
            autoFocus
            className="w-full rounded-xl border-[1.5px] border-gray-200 bg-white px-4 py-3.5 text-[16px] text-gray-900 outline-none transition-all placeholder:text-gray-300 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/[0.08]"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-2 block text-[13px] font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            className="w-full rounded-xl border-[1.5px] border-gray-200 bg-white px-4 py-3.5 text-[16px] text-gray-900 outline-none transition-all placeholder:text-gray-300 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/[0.08]"
          />
          <div className="mt-1.5 flex justify-end">
            <Link href="/forgot-password" className="text-[13px] font-medium text-emerald-600 hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Signing in...
            </>
          ) : (
            <>
              Sign in
              <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.5} />
            </>
          )}
        </button>
      </form>

      <div className="my-7 flex items-center gap-4">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-[12px] font-medium uppercase tracking-wider text-gray-300">or</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <p className="text-center text-[14px] text-gray-500">
        Don&apos;t have an account?{' '}
        <Link href="/onboarding" className="font-semibold text-emerald-600 hover:underline">
          Start your free trial
        </Link>
      </p>

      <p className="mt-4 text-center text-[11px] text-gray-400">
        By signing in you accept our{' '}
        <a href="https://blueroll.app/terms.html" target="_blank" rel="noopener noreferrer" className="text-gray-500 underline hover:text-gray-700">Terms&nbsp;of&nbsp;Service</a>.
      </p>
    </div>
  )
}
