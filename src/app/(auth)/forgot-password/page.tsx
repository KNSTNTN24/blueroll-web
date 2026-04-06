'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Loader2, ArrowRight, ArrowLeft, Mail } from 'lucide-react'
import { useBrand } from '../layout'

export default function ForgotPasswordPage() {
  const { setContent } = useBrand()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setContent({
      headline: 'It happens to the best of us.',
      subtitle: 'Enter your email and we\'ll send you a link to reset your password.',
    })
  }, [setContent])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/login`,
      })
      if (resetError) throw resetError
      setSent(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600/10">
          <Mail className="h-7 w-7 text-emerald-600" strokeWidth={1.8} />
        </div>
        <h1 className="mt-6 text-[26px] font-bold tracking-tight text-gray-900">
          Check your email
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-400">
          We sent a reset link to <span className="font-medium text-gray-600">{email}</span>. Click the link to set a new password.
        </p>

        <button
          onClick={() => { setSent(false); setEmail('') }}
          className="mt-8 text-[14px] font-medium text-emerald-600 hover:underline"
        >
          Didn&apos;t receive it? Try again
        </button>

        <p className="mt-6 text-[13px] text-gray-400">
          <Link href="/login" className="font-medium text-emerald-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <Link href="/login" className="mb-5 flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-gray-400 transition-colors hover:text-gray-600">
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        Back to sign in
      </Link>

      <h1 className="text-[30px] font-bold tracking-tight text-gray-900">
        Reset your password
      </h1>
      <p className="mt-2 text-[15px] text-gray-400">
        Enter the email you signed up with and we&apos;ll send you a reset link.
      </p>

      <form onSubmit={handleSubmit} className="mt-8">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="reset-email" className="mb-2 block text-[13px] font-medium text-gray-700">
            Email
          </label>
          <input
            id="reset-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@restaurant.com"
            required
            autoFocus
            className="w-full rounded-xl border-[1.5px] border-gray-200 bg-white px-4 py-3.5 text-[16px] text-gray-900 outline-none transition-all placeholder:text-gray-300 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/[0.08]"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !email.trim()}
          className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-[15px] font-semibold transition-colors ${
            loading || !email.trim()
              ? 'cursor-not-allowed bg-gray-200 text-gray-400'
              : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          {loading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</>
          ) : (
            <>Send reset link <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.5} /></>
          )}
        </button>
      </form>
    </div>
  )
}
