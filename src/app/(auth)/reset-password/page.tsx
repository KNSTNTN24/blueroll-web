'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Loader2, ArrowRight, Lock, CheckCircle2 } from 'lucide-react'
import { useBrand } from '../layout'

// The recovery email lands here with a Supabase hash
// (#access_token=…&type=recovery) or an error hash if the link expired.
// Read it at module load, before supabase-js consumes and strips it.
const recoveryHash = typeof window === 'undefined' ? '' : window.location.hash
const linkExpired = /error_code=(otp_expired|access_denied)|error=access_denied/.test(recoveryHash)

export default function ResetPasswordPage() {
  const router = useRouter()
  const { setContent } = useBrand()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [expired, setExpired] = useState(linkExpired)

  useEffect(() => {
    setContent({
      headline: "Let's get you back in.",
      subtitle: 'Set a new password and pick up right where you left off.',
    })
  }, [setContent])

  // supabase-js auto-processes the recovery hash and fires PASSWORD_RECOVERY.
  // If the link was invalid/expired we surface that.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setExpired(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords don’t match'); return }
    setLoading(true)
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password })
      if (updErr) throw updErr
      setDone(true)
      // Sign out of the recovery session so they log in fresh with the new password.
      await supabase.auth.signOut()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      // A missing session almost always means the link was already used or expired.
      setError(/session|token|expired|missing/i.test(msg) ? 'This reset link has expired or was already used. Please request a new one.' : msg)
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10">
          <CheckCircle2 className="h-7 w-7 text-emerald-600" strokeWidth={1.8} />
        </div>
        <h1 className="mt-6 text-[26px] font-bold tracking-tight text-gray-900">Password updated</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-400">You can now sign in with your new password.</p>
        <button
          onClick={() => router.push('/login')}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-[15px] font-semibold text-white transition-colors hover:opacity-90"
        >
          Go to sign in <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.5} />
        </button>
      </div>
    )
  }

  if (expired) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100">
          <Lock className="h-7 w-7 text-amber-600" strokeWidth={1.8} />
        </div>
        <h1 className="mt-6 text-[26px] font-bold tracking-tight text-gray-900">This link has expired</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-400">Reset links are valid for one hour. Request a fresh one and we&apos;ll email it over.</p>
        <Link
          href="/forgot-password"
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-[15px] font-semibold text-white transition-colors hover:opacity-90"
        >
          Send a new link <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.5} />
        </Link>
        <p className="mt-6 text-[13px] text-gray-400">
          <Link href="/login" className="font-medium text-emerald-600 hover:underline">Back to sign in</Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-[30px] font-bold tracking-tight text-gray-900">Set a new password</h1>
      <p className="mt-2 text-[15px] text-gray-400">Choose a new password for your account — at least 6 characters.</p>

      <form onSubmit={handleSubmit} className="mt-8">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</div>
        )}

        <div>
          <label htmlFor="new-password" className="mb-2 block text-[13px] font-medium text-gray-700">New password</label>
          <input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 characters"
            required
            autoFocus
            minLength={6}
            className="w-full rounded-xl border-[1.5px] border-gray-200 bg-white px-4 py-3.5 text-[16px] text-gray-900 outline-none transition-all placeholder:text-gray-300 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/[0.08]"
          />
        </div>

        <div className="mt-4">
          <label htmlFor="confirm-password" className="mb-2 block text-[13px] font-medium text-gray-700">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your new password"
            required
            className="w-full rounded-xl border-[1.5px] border-gray-200 bg-white px-4 py-3.5 text-[16px] text-gray-900 outline-none transition-all placeholder:text-gray-300 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/[0.08]"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !password || !confirm}
          className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-[15px] font-semibold transition-colors ${
            loading || !password || !confirm ? 'cursor-not-allowed bg-gray-200 text-gray-400' : 'bg-brand text-white hover:opacity-90'
          }`}
        >
          {loading ? (<><Loader2 className="h-4 w-4 animate-spin" /> Updating password...</>) : (<>Update password <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.5} /></>)}
        </button>
      </form>

      <p className="mt-6 text-center text-[13px] text-gray-400">
        Remembered it? <Link href="/login" className="font-medium text-emerald-600 hover:underline">Back to sign in</Link>
      </p>
    </div>
  )
}
