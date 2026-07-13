'use client'

// Real Stripe card-collection flow, shared by any page that needs to start a
// paid subscription (currently: /paywall). Mirrors the `CardForm` used in
// the onboarding wizard's `card` step — kept as a separate, self-contained
// component here (rather than importing from onboarding/page.tsx) to avoid
// touching that file while it has in-flight work on another branch.

import { useMemo, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''
const stripePromise = stripeKey ? loadStripe(stripeKey) : null

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: '16px',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: '#111827',
      '::placeholder': { color: '#c9cdd3' },
      iconColor: '#6b7280',
    },
    invalid: { color: '#dc2626', iconColor: '#dc2626' },
  },
}

interface CardSubscriptionFormProps {
  /** Label on the submit button, e.g. "Start free trial". */
  submitLabel?: string
  /** Where to send the user once the subscription is created. */
  redirectTo?: string
}

function InnerCardForm({ submitLabel = 'Start free trial', redirectTo = '/dashboard' }: CardSubscriptionFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cardComplete, setCardComplete] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setLoading(true)
    setError('')

    const card = elements.getElement(CardElement)
    if (!card) {
      setLoading(false)
      return
    }

    const { error: stripeError, paymentMethod } = await stripe.createPaymentMethod({
      type: 'card',
      card,
    })

    if (stripeError || !paymentMethod) {
      setError(stripeError?.message ?? 'Card validation failed')
      setLoading(false)
      return
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      setError('Session expired. Please sign in again.')
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('business_id')
      .eq('id', session.user.id)
      .single()

    if (!profile?.business_id) {
      setError('No business found. Please sign in again.')
      setLoading(false)
      return
    }

    const { data: result, error: fnError } = await supabase.functions.invoke(
      'create-subscription',
      {
        body: {
          userId: session.user.id,
          email: session.user.email,
          businessId: profile.business_id,
          paymentMethodId: paymentMethod.id,
        },
      },
    )

    if (fnError || result?.error) {
      let detail: Record<string, unknown> | null = null
      const ctx = (fnError as { context?: Response } | null)?.context
      if (ctx && typeof ctx.json === 'function') {
        try { detail = await ctx.json() } catch {}
      }
      console.error('create-subscription failed:', { fnError, result, detail })
      const msg =
        result?.error ??
        (detail && typeof detail.error === 'string' ? detail.error : null) ??
        fnError?.message ??
        'Subscription failed. Please try again.'
      setError(msg)
      setLoading(false)
      return
    }

    if (result?.requires_action && result?.client_secret) {
      const { error: scaError } = await stripe.confirmCardSetup(result.client_secret)
      if (scaError) {
        setError(scaError.message ?? 'Card authentication failed.')
        setLoading(false)
        return
      }
    }

    try { await supabase.auth.refreshSession() } catch {}
    window.location.assign(redirectTo)
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      <label className="mb-2 block text-[13px] font-medium text-gray-700">Card details</label>
      <div className="rounded-xl border-[1.5px] border-gray-200 bg-white px-4 py-4 transition-all focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-600/[0.08]">
        <CardElement
          options={CARD_ELEMENT_OPTIONS}
          onChange={(e) => setCardComplete(e.complete)}
        />
      </div>

      <button
        type="submit"
        disabled={!stripe || !cardComplete || loading}
        className={cn(
          'mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-[15px] font-semibold transition-colors',
          !stripe || !cardComplete || loading
            ? 'cursor-not-allowed bg-gray-200 text-gray-400'
            : 'bg-emerald-600 text-white hover:opacity-90',
        )}
      >
        {loading ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
        ) : (
          submitLabel
        )}
      </button>

      <div className="mt-6 flex items-center justify-center gap-4 text-[12px] text-gray-400">
        <span className="flex items-center gap-1">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          Secure
        </span>
        <span>&bull;</span>
        <span>Cancel anytime</span>
        <span>&bull;</span>
        <span>No charge for 14 days</span>
      </div>
    </form>
  )
}

/** Public entry point: wraps the card form in the Stripe Elements provider. */
export function CardSubscriptionForm(props: CardSubscriptionFormProps) {
  const options = useMemo(
    () => ({ fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap' }] }),
    [],
  )

  return (
    <Elements stripe={stripePromise} options={options}>
      <InnerCardForm {...props} />
    </Elements>
  )
}
