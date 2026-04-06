'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  Search,
  Check,
  ArrowRight,
  ArrowLeft,
  Building2,
  Loader2,
  Home,
  UserPlus,
} from 'lucide-react'
import { useBrand } from '../layout'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'

interface FsaEstablishment {
  FHRSID: number
  BusinessName: string
  BusinessType: string
  AddressLine1: string
  AddressLine2: string
  AddressLine3: string
  PostCode: string
  RatingValue: string
  RatingDate: string
  scores: {
    Hygiene: number | null
    Structural: number | null
    ConfidenceInManagement: number | null
  }
}

type Step =
  | 'name'
  | 'choice'
  | 'postcode'
  | 'select'
  | 'rating'
  | 'invite'
  | 'pain-points'
  | 'signup'
  | 'card'

// --- Shared UI atoms ---

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = ((current + 1) / total) * 100
  return (
    <div className="mb-12 h-1 overflow-hidden rounded-full bg-gray-200">
      <div
        className="h-full animate-[shimmer_2.5s_ease-in-out_infinite] rounded-full transition-all duration-500 ease-out"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(90deg, #059669, #34d399, #059669)',
          backgroundSize: '200% 100%',
        }}
      />
    </div>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mb-5 flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-gray-400 transition-colors hover:text-gray-600">
      <ArrowLeft className="h-4 w-4" strokeWidth={2} />
      Back
    </button>
  )
}

function StepLabel({ current, total }: { current: number; total: number }) {
  return (
    <p className="mb-2.5 text-[13px] font-semibold text-emerald-600">
      Step {current + 1} of {total}
    </p>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-[30px] font-bold leading-tight tracking-tight text-gray-900">
      {children}
    </h1>
  )
}

function Subtitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-[15px] leading-relaxed text-gray-400">
      {children}
    </p>
  )
}

function FormInput({
  id, label, hint, ...props
}: { id: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[13px] font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className={cn(
          'w-full rounded-xl border-[1.5px] border-gray-200 bg-white px-4 py-3.5 text-[16px] text-gray-900 outline-none transition-all placeholder:text-gray-300 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/[0.08]',
          props.className,
        )}
      />
      {hint && <p className="mt-2 text-[12px] leading-relaxed text-gray-400">{hint}</p>}
    </div>
  )
}

function PrimaryButton({
  disabled, loading, children, ...props
}: { disabled?: boolean; loading?: boolean; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        'mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-[15px] font-semibold transition-colors',
        disabled || loading
          ? 'cursor-not-allowed bg-gray-200 text-gray-400'
          : 'bg-emerald-600 text-white hover:bg-emerald-700',
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
      {!loading && !disabled && <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.5} />}
    </button>
  )
}

// --- Brand headlines per step ---
const BRAND_COPY: Record<Step, { headline: string; subtitle: string }> = {
  name: {
    headline: 'Pass every inspection. Without the paperwork.',
    subtitle: 'Digital checklists, AI recipe import, and one-tap compliance reports.',
  },
  choice: {
    headline: 'One plan. Everything included.',
    subtitle: 'Unlimited team members, no per-seat charges, no feature gates. Less than a pack of blue rolls.',
  },
  postcode: {
    headline: "We'll find your business on the FSA register.",
    subtitle: 'Your hygiene rating, address, and details — pulled in automatically.',
  },
  select: {
    headline: 'Pick your place from the list.',
    subtitle: "We found these businesses near your postcode.",
  },
  rating: {
    headline: "Here's your current rating.",
    subtitle: "We'll help you keep it — or improve it.",
  },
  invite: {
    headline: 'Your team is already set up.',
    subtitle: "Enter the code your manager shared and you're in — checklists, tasks, everything ready.",
  },
  'pain-points': {
    headline: 'Built for real kitchen problems.',
    subtitle: '89% of restaurants improve after switching to digital records.',
  },
  signup: {
    headline: "You're almost there.",
    subtitle: 'Create your account and start your 14-day free trial.',
  },
  card: {
    headline: 'Less than a pack of blue rolls.',
    subtitle: '£14.99/month after your 14-day free trial. Cancel anytime.',
  },
}

// --- Stripe ---

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '')

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

function CardForm() {
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
    if (!card) return

    const { error: stripeError, paymentMethod } = await stripe.createPaymentMethod({
      type: 'card',
      card,
    })

    if (stripeError) {
      setError(stripeError.message ?? 'Something went wrong')
      setLoading(false)
      return
    }

    // TODO: send paymentMethod.id to backend to create subscription
    console.log('PaymentMethod created:', paymentMethod.id)
    window.location.href = '/dashboard'
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
            : 'bg-emerald-600 text-white hover:bg-emerald-700',
        )}
      >
        {loading ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
        ) : (
          <>Start free trial <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.5} /></>
        )}
      </button>

      <div className="mt-6 flex items-center justify-center gap-4 text-[12px] text-gray-400">
        <span className="flex items-center gap-1">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          Secure
        </span>
        <span>•</span>
        <span>Cancel anytime</span>
        <span>•</span>
        <span>No charge for 14 days</span>
      </div>
    </form>
  )
}

function CardStep({ currentStepIndex, totalSteps }: { currentStepIndex: number; totalSteps: number }) {
  const options = useMemo(() => ({ fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap' }] }), [])

  return (
    <div>
      <StepLabel current={currentStepIndex} total={totalSteps} />
      <Title>Start your free trial</Title>
      <Subtitle>14 days free, then £14.99/month. Cancel anytime. You won&apos;t be charged today.</Subtitle>

      <div className="mt-8">
        <Elements stripe={stripePromise} options={options}>
          <CardForm />
        </Elements>
      </div>
    </div>
  )
}

function ChoiceStep({
  currentStepIndex, totalSteps, goBack, onSelect,
}: {
  currentStepIndex: number; totalSteps: number; goBack: () => void; onSelect: (type: 'new' | 'join') => void
}) {
  const [selected, setSelected] = useState<'new' | 'join' | null>(null)

  return (
    <div>
      <BackButton onClick={goBack} />
      <StepLabel current={currentStepIndex} total={totalSteps} />
      <Title>How are you getting started?</Title>
      <Subtitle>This helps us set up the right experience for you.</Subtitle>

      <div className="mt-10 grid grid-cols-2 gap-4">
        {([
          { key: 'new' as const, icon: Home, title: 'Setting up a business', desc: "I'm the owner or manager" },
          { key: 'join' as const, icon: UserPlus, title: 'Joining a team', desc: 'I have an invite code' },
        ]).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setSelected(opt.key)}
            className={cn(
              'group relative flex aspect-square cursor-pointer flex-col items-center justify-center rounded-2xl border-2 bg-white p-5 text-center transition-all',
              selected === opt.key
                ? 'border-emerald-600'
                : 'border-gray-200 hover:border-emerald-400',
            )}
          >
            {/* Checkmark circle */}
            <div className={cn(
              'absolute right-3.5 top-3.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition-all',
              selected === opt.key ? 'border-emerald-700 bg-emerald-700' : 'border-gray-300',
            )}>
              {selected === opt.key && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
            </div>

            <div className={cn(
              'mb-4 flex h-14 w-14 items-center justify-center rounded-[14px] transition-colors',
              selected === opt.key ? 'bg-emerald-100' : 'bg-emerald-50',
            )}>
              <opt.icon className="h-6 w-6 text-emerald-600" strokeWidth={1.6} />
            </div>
            <span className="text-[15px] font-semibold text-gray-900">{opt.title}</span>
            <span className="mt-1.5 text-[12px] text-gray-400">{opt.desc}</span>
          </button>
        ))}
      </div>

      <PrimaryButton disabled={!selected} onClick={() => selected && onSelect(selected)}>
        Continue
      </PrimaryButton>
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const { setContent } = useBrand()
  const [step, setStep] = useState<Step>('name')
  const [isJoinFlow, setIsJoinFlow] = useState(false)
  const [checking, setChecking] = useState(false)

  // Update brand panel when step changes
  useEffect(() => {
    setContent(BRAND_COPY[step])
  }, [step, setContent])

  // If user is already logged in with a profile, go to dashboard
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', session.user.id)
            .single()
          if (profile) {
            window.location.href = '/dashboard'
          }
        } catch { /* no profile — stay on onboarding */ }
      }
    }).catch(() => { /* ignore */ })
  }, [router])

  // State
  const [name, setName] = useState('')
  const [postcode, setPostcode] = useState('')
  const [searchResults, setSearchResults] = useState<FsaEstablishment[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<FsaEstablishment | null>(null)
  const [inviteCode, setInviteCode] = useState('')
  const [painPoints, setPainPoints] = useState<Set<string>>(new Set())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [signupError, setSignupError] = useState('')
  const [signupLoading, setSignupLoading] = useState(false)

  const stepsForFlow = isJoinFlow
    ? ['name', 'choice', 'invite', 'signup', 'card']
    : ['name', 'choice', 'postcode', 'select', 'rating', 'signup', 'card']

  const currentStepIndex = stepsForFlow.indexOf(step)
  const totalSteps = stepsForFlow.length

  const searchFsa = useCallback(async () => {
    if (!postcode.trim()) return
    setSearching(true)
    try {
      const res = await fetch(
        `https://api.ratings.food.gov.uk/Establishments?address=${encodeURIComponent(postcode)}&pageSize=20&sortOptionKey=distance`,
        { headers: { 'x-api-version': '2', Accept: 'application/json' } },
      )
      const data = await res.json()
      setSearchResults(data.establishments || [])
      setStep('select')
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [postcode])

  const togglePainPoint = (point: string) => {
    setPainPoints((prev) => {
      const next = new Set(prev)
      if (next.has(point)) next.delete(point)
      else next.add(point)
      return next
    })
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setSignupError('')
    if (password.length < 6) { setSignupError('Password must be at least 6 characters'); return }
    setSignupLoading(true)

    try {
      const { error: authError } = await supabase.auth.signUp({ email: email.trim(), password })
      if (authError) {
        if (authError.message.includes('already registered')) {
          setSignupError('This email is already registered. Try signing in.')
        } else { throw authError }
        setSignupLoading(false)
        return
      }

      if (isJoinFlow && inviteCode.trim()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: joinError } = await (supabase.rpc as any)('join_with_invite', {
          invite_token: inviteCode.trim(),
          member_name: name.trim(),
        })
        if (joinError) {
          setSignupError('Invalid or expired invite token. Ask your manager for a new one.')
          setSignupLoading(false)
          return
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: setupError } = await (supabase.rpc as any)('setup_business', {
          business_name: selected?.BusinessName ?? 'My Restaurant',
          owner_name: name.trim(),
          business_address: selected
            ? [selected.AddressLine1, selected.AddressLine2, selected.PostCode].filter(Boolean).join(', ')
            : undefined,
          p_fhrs_id: selected?.FHRSID,
          p_fsa_rating: selected?.RatingValue,
          p_post_code: selected?.PostCode,
        })
        if (setupError) throw setupError

        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('business_id')
            .eq('id', (await supabase.auth.getUser()).data.user!.id)
            .single()
          if (profile?.business_id) await seedDefaultChecklists(profile.business_id)
        } catch { /* Non-critical */ }
      }

      setStep('card')
      setSignupLoading(false)
    } catch (err: unknown) {
      // If signup succeeded but business setup failed, still go to card
      const session = await supabase.auth.getSession()
      if (session.data.session) {
        setStep('card')
        setSignupLoading(false)
        return
      }
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setSignupError(message)
      setSignupLoading(false)
    }
  }

  const ratingColor = (rating: string) => {
    const n = parseInt(rating)
    if (n >= 4) return 'text-emerald-700 bg-emerald-600/10'
    if (n >= 3) return 'text-amber-700 bg-amber-600/10'
    return 'text-red-700 bg-red-600/10'
  }

  const goBack = () => {
    const idx = stepsForFlow.indexOf(step)
    if (idx > 0) setStep(stepsForFlow[idx - 1] as Step)
  }


  return (
    <div>
      <ProgressBar current={currentStepIndex} total={totalSteps} />

      {/* Step: Name */}
      {step === 'name' && (
        <div>
          <StepLabel current={currentStepIndex} total={totalSteps} />
          <Title>What&apos;s your name?</Title>
          <Subtitle>We&apos;ll personalise your experience.</Subtitle>

          <div className="mt-10">
            <FormInput
              id="name"
              label="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. James Wilson"
              autoFocus
              autoCapitalize="words"
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && setStep('choice')}
            />

            <PrimaryButton disabled={!name.trim()} onClick={() => setStep('choice')}>
              Continue
            </PrimaryButton>
          </div>

          <p className="mt-7 text-center text-[13px] text-gray-400">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-emerald-600 hover:underline">Sign in</Link>
          </p>
        </div>
      )}

      {/* Step: Choice */}
      {step === 'choice' && (
        <ChoiceStep
          currentStepIndex={currentStepIndex}
          totalSteps={totalSteps}
          goBack={goBack}
          onSelect={(type) => {
            if (type === 'new') { setIsJoinFlow(false); setStep('postcode') }
            else { setIsJoinFlow(true); setStep('invite') }
          }}
        />
      )}

      {/* Step: Postcode */}
      {step === 'postcode' && (
        <div>
          <BackButton onClick={goBack} />
          <StepLabel current={currentStepIndex} total={totalSteps} />
          <Title>Find your business</Title>
          <Subtitle>Enter your postcode and we&apos;ll look you up on the FSA register.</Subtitle>

          <div className="mt-10">
            <FormInput
              id="postcode"
              label="Postcode"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              placeholder="e.g. SW1A 1AA"
              autoFocus
              style={{ textTransform: 'uppercase' }}
              onKeyDown={(e) => e.key === 'Enter' && postcode.trim() && searchFsa()}
              hint="We search the FSA database to find your registered business."
            />

            <PrimaryButton disabled={!postcode.trim()} loading={searching} onClick={searchFsa}>
              {searching ? 'Searching...' : 'Search'}
            </PrimaryButton>

            <button
              onClick={() => setStep('signup')}
              className="mt-4 block w-full text-center text-[13px] text-gray-400 hover:text-gray-600"
            >
              Skip — I&apos;ll set up manually
            </button>
          </div>
        </div>
      )}

      {/* Step: Select business */}
      {step === 'select' && (
        <div>
          <BackButton onClick={() => setStep('postcode')} />
          <StepLabel current={currentStepIndex} total={totalSteps} />
          <Title>Select your business</Title>
          <Subtitle>{searchResults.length} result{searchResults.length !== 1 && 's'} near {postcode.toUpperCase()}</Subtitle>

          <div className="-mx-2 mt-4 max-h-[60vh] space-y-1 overflow-y-auto px-2">
            {searchResults.map((est) => {
              const rating = parseInt(est.RatingValue)
              const hasRating = !isNaN(rating)
              return (
                <button
                  key={est.FHRSID}
                  onClick={() => { setSelected(est); setStep('rating') }}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent px-4 py-3.5 text-left transition-colors hover:border-gray-200 hover:bg-white"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-gray-900">{est.BusinessName}</p>
                    <p className="mt-0.5 truncate text-[12px] text-gray-400">
                      {[est.AddressLine1, est.PostCode].filter(Boolean).join(', ')}
                    </p>
                  </div>
                  {hasRating ? (
                    <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-[12px] font-bold', ratingColor(est.RatingValue))}>
                      {est.RatingValue}/5
                    </span>
                  ) : est.RatingValue ? (
                    <span className="shrink-0 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                      {est.RatingValue.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>

          {searchResults.length === 0 && (
            <div className="mt-10 text-center">
              <p className="text-[14px] text-gray-500">No businesses found for that postcode.</p>
              <button onClick={() => setStep('signup')} className="mt-3 text-[14px] font-semibold text-emerald-600 hover:underline">
                Continue without FSA
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step: Rating reveal */}
      {step === 'rating' && selected && (() => {
        const rating = parseInt(selected.RatingValue)
        const isGood = rating >= 4
        const pct = (rating / 5) * 100
        const circumference = 2 * Math.PI * 54
        const strokeDashoffset = circumference - (pct / 100) * circumference
        const mainColor = isGood ? '#059669' : rating === 3 ? '#d97706' : '#dc2626'
        const mainColorLight = isGood ? 'rgba(5,150,105,0.1)' : rating === 3 ? 'rgba(217,119,6,0.1)' : 'rgba(220,38,38,0.1)'

        const scoreItems = [
          { label: 'Hygiene', score: selected.scores?.Hygiene },
          { label: 'Structural', score: selected.scores?.Structural },
          { label: 'Management', score: selected.scores?.ConfidenceInManagement },
        ].filter(s => s.score !== null && s.score !== undefined) as { label: string; score: number }[]

        const scoreCircle = (score: number, size: number) => {
          const pctS = Math.max(5, 100 - (score / 25) * 100)
          const r = (size - 6) / 2
          const c = 2 * Math.PI * r
          const color = score <= 5 ? '#059669' : score <= 10 ? '#d97706' : '#dc2626'
          return { r, c, offset: c - (pctS / 100) * c, color }
        }

        return (
          <div>
            <BackButton onClick={() => setStep('select')} />
            <StepLabel current={currentStepIndex} total={totalSteps} />
            <Title>{selected.BusinessName}</Title>
            <Subtitle>{[selected.AddressLine1, selected.PostCode].filter(Boolean).join(', ')}</Subtitle>

            {/* Main circular rating */}
            <div className="mt-8 flex justify-center">
              <div className="relative flex h-[140px] w-[140px] items-center justify-center">
                <svg className="absolute inset-0" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="54" fill="none" stroke={mainColorLight} strokeWidth="8" />
                  <circle
                    cx="60" cy="60" r="54" fill="none"
                    stroke={mainColor} strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    transform="rotate(-90 60 60)"
                    style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                  />
                </svg>
                <div className="text-center">
                  <p className="text-[36px] font-extrabold leading-none text-gray-900">{selected.RatingValue}</p>
                  <p className="text-[12px] font-medium text-gray-400">of 5</p>
                </div>
              </div>
            </div>

            <p className="mt-3 text-center text-[13px] font-medium" style={{ color: mainColor }}>
              {isGood ? 'Great score' : rating === 3 ? 'Room to improve' : 'Needs attention'}
            </p>

            {/* Sub-scores with mini circles */}
            {scoreItems.length > 0 && (
              <div className="mt-6 flex justify-center gap-8">
                {scoreItems.map((item) => {
                  const sc = scoreCircle(item.score, 56)
                  return (
                    <div key={item.label} className="flex flex-col items-center">
                      <div className="relative flex h-[56px] w-[56px] items-center justify-center">
                        <svg className="absolute inset-0" viewBox="0 0 56 56">
                          <circle cx="28" cy="28" r={sc.r} fill="none" stroke="#f3f4f6" strokeWidth="4" />
                          <circle
                            cx="28" cy="28" r={sc.r} fill="none"
                            stroke={sc.color} strokeWidth="4"
                            strokeLinecap="round"
                            strokeDasharray={sc.c}
                            strokeDashoffset={sc.offset}
                            transform="rotate(-90 28 28)"
                            style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                          />
                        </svg>
                        <p className="text-[14px] font-bold tabular-nums text-gray-900">{item.score}</p>
                      </div>
                      <p className="mt-1.5 text-[11px] font-medium text-gray-400">{item.label}</p>
                    </div>
                  )
                })}
              </div>
            )}

            <PrimaryButton onClick={() => setStep('signup')}>
              Continue
            </PrimaryButton>
          </div>
        )
      })()}

      {/* Step: Invite code */}
      {step === 'invite' && (
        <div>
          <BackButton onClick={goBack} />
          <StepLabel current={currentStepIndex} total={totalSteps} />
          <Title>Enter your invite code</Title>
          <Subtitle>Ask your manager for the 6-character code.</Subtitle>

          <div className="mt-10">
            <FormInput
              id="invite"
              label="Invite code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="e.g. ABC123"
              maxLength={6}
              autoFocus
              style={{ textTransform: 'uppercase' }}
              onKeyDown={(e) => e.key === 'Enter' && inviteCode.trim() && setStep('signup')}
              hint="Check your email or messages from your manager."
            />

            <PrimaryButton disabled={!inviteCode.trim()} onClick={() => setStep('signup')}>
              Continue
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Step: Pain points */}
      {step === 'pain-points' && (
        <div>
          <BackButton onClick={goBack} />
          <StepLabel current={currentStepIndex} total={totalSteps} />
          <Title>What are your biggest headaches?</Title>
          <Subtitle>Select all that apply — this helps us personalise your setup.</Subtitle>

          <div className="mt-8 space-y-3">
            {PAIN_POINTS.map((point) => {
              const active = painPoints.has(point)
              return (
                <button
                  key={point}
                  onClick={() => togglePainPoint(point)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-4 rounded-xl border-[1.5px] px-5 py-4 text-left text-[14px] transition-all',
                    active
                      ? 'border-emerald-600 text-gray-900'
                      : 'border-gray-200 text-gray-600 hover:border-emerald-400',
                  )}
                >
                  <div className={cn(
                    'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md transition-colors',
                    active ? 'bg-emerald-600' : 'border-[1.5px] border-gray-300',
                  )}>
                    {active && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                  </div>
                  {point}
                </button>
              )
            })}
          </div>

          <div className="mt-8">
            <PrimaryButton onClick={() => setStep('signup')}>
              Create my account
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Step: Signup */}
      {step === 'signup' && (
        <div>
          <BackButton onClick={goBack} />
          <StepLabel current={currentStepIndex} total={totalSteps} />
          <Title>Create your account</Title>
          <Subtitle>
            {isJoinFlow
              ? 'One last step before you join your team.'
              : selected
                ? `We'll set up ${selected.BusinessName} for you. 14 days free, cancel anytime.`
                : '14 days free, cancel anytime. You won\'t be charged until the trial ends.'}
          </Subtitle>

          <form onSubmit={handleSignup} className="mt-8 space-y-4">
            {signupError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                {signupError}
              </div>
            )}

            <FormInput
              id="signup-email"
              label="Work email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@restaurant.com"
              required
              autoFocus
            />

            <FormInput
              id="signup-password"
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              required
              minLength={6}
            />

            <PrimaryButton type="submit" loading={signupLoading} disabled={!email || !password}>
              {signupLoading ? 'Creating account...' : 'Create account'}
            </PrimaryButton>

            <p className="text-center text-[11px] leading-relaxed text-gray-400">
              By continuing you agree to our{' '}
              <a href="https://blueroll.app/terms.html" target="_blank" rel="noopener noreferrer" className="text-gray-500 underline hover:text-gray-700">Terms&nbsp;of&nbsp;Service</a>.
            </p>
          </form>

          <p className="mt-6 text-center text-[13px] text-gray-400">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-emerald-600 hover:underline">Sign in</Link>
          </p>
        </div>
      )}

      {/* Step: Card for trial */}
      {step === 'card' && (
        <CardStep currentStepIndex={currentStepIndex} totalSteps={totalSteps} />
      )}
    </div>
  )
}

// Seed default HACCP checklist templates for a new business
async function seedDefaultChecklists(businessId: string) {
  const { data: existing } = await supabase
    .from('checklist_templates')
    .select('id')
    .eq('business_id', businessId)
    .eq('is_default', true)
    .limit(1)

  if (existing && existing.length > 0) return

  const templates = [
    {
      name: 'Fridge & Freezer Temperatures',
      description: 'Record fridge and freezer temperatures twice daily',
      frequency: 'daily',
      assigned_roles: ['owner', 'manager', 'chef', 'kitchen_staff'],
      sfbb_section: 'chilling',
      deadline_time: '10:00',
      items: [
        { name: 'Main fridge temperature', item_type: 'temperature', required: true, sort_order: 0, min_value: 1, max_value: 5, unit: '°C' },
        { name: 'Prep fridge temperature', item_type: 'temperature', required: true, sort_order: 1, min_value: 1, max_value: 5, unit: '°C' },
        { name: 'Walk-in fridge temperature', item_type: 'temperature', required: false, sort_order: 2, min_value: 1, max_value: 5, unit: '°C' },
        { name: 'Freezer temperature', item_type: 'temperature', required: true, sort_order: 3, min_value: -23, max_value: -18, unit: '°C' },
        { name: 'Food stored correctly and covered', item_type: 'yes_no', required: true, sort_order: 4 },
      ],
    },
    {
      name: 'Daily Opening Checks',
      description: 'Morning checks before service begins',
      frequency: 'daily',
      assigned_roles: ['owner', 'manager', 'chef', 'kitchen_staff'],
      sfbb_section: 'cleaning',
      deadline_time: '09:00',
      items: [
        { name: 'All surfaces clean and sanitised', item_type: 'yes_no', required: true, sort_order: 0 },
        { name: 'Handwash basin stocked (soap, paper towels)', item_type: 'yes_no', required: true, sort_order: 1 },
        { name: 'Sanitiser spray available and in-date', item_type: 'yes_no', required: true, sort_order: 2 },
        { name: 'No signs of pests', item_type: 'yes_no', required: true, sort_order: 3 },
        { name: 'Staff wearing clean uniform', item_type: 'yes_no', required: true, sort_order: 4 },
        { name: 'Issues or notes', item_type: 'text', required: false, sort_order: 5 },
      ],
    },
    {
      name: 'Delivery Acceptance',
      description: 'Check deliveries on arrival',
      frequency: 'daily',
      assigned_roles: ['owner', 'manager', 'chef', 'kitchen_staff'],
      sfbb_section: 'chilling',
      items: [
        { name: 'Chilled delivery temperature', item_type: 'temperature', required: true, sort_order: 0, min_value: 0, max_value: 5, unit: '°C' },
        { name: 'Frozen delivery temperature', item_type: 'temperature', required: false, sort_order: 1, min_value: -25, max_value: -18, unit: '°C' },
        { name: 'Packaging intact and undamaged', item_type: 'yes_no', required: true, sort_order: 2 },
        { name: 'Use-by dates acceptable', item_type: 'yes_no', required: true, sort_order: 3 },
        { name: 'Stored within 15 minutes', item_type: 'yes_no', required: true, sort_order: 4 },
      ],
    },
    {
      name: 'End of Day Closing',
      description: 'Closing checks at end of service',
      frequency: 'daily',
      assigned_roles: ['owner', 'manager', 'chef', 'kitchen_staff'],
      sfbb_section: 'cleaning',
      deadline_time: '23:00',
      items: [
        { name: 'All surfaces cleaned and sanitised', item_type: 'yes_no', required: true, sort_order: 0 },
        { name: 'Floors swept and mopped', item_type: 'yes_no', required: true, sort_order: 1 },
        { name: 'All food covered and labelled with date', item_type: 'yes_no', required: true, sort_order: 2 },
        { name: 'Bins emptied and replaced', item_type: 'yes_no', required: true, sort_order: 3 },
        { name: 'Closing fridge temperature', item_type: 'temperature', required: true, sort_order: 4, min_value: 1, max_value: 5, unit: '°C' },
      ],
    },
    {
      name: 'Weekly Deep Clean & Calibration',
      description: 'Weekly deep cleaning and equipment checks',
      frequency: 'weekly',
      assigned_roles: ['owner', 'manager', 'chef'],
      sfbb_section: 'cleaning',
      items: [
        { name: 'Probe calibration (ice water test)', item_type: 'temperature', required: true, sort_order: 0, min_value: -1, max_value: 1, unit: '°C' },
        { name: 'Fridge/freezer interior cleaned', item_type: 'yes_no', required: true, sort_order: 1 },
        { name: 'Extraction hood/canopy cleaned', item_type: 'yes_no', required: true, sort_order: 2 },
        { name: 'Drains checked and cleaned', item_type: 'yes_no', required: true, sort_order: 3 },
        { name: 'Notes or issues', item_type: 'text', required: false, sort_order: 4 },
      ],
    },
  ]

  for (const t of templates) {
    const { items, ...templateData } = t
    const { data: tmpl } = await supabase
      .from('checklist_templates')
      .insert({ ...templateData, business_id: businessId, is_default: true, active: false })
      .select('id')
      .single()

    if (tmpl) {
      const itemRows = items.map((item) => ({ ...item, template_id: tmpl.id }))
      await supabase.from('checklist_template_items').insert(itemRows)
    }
  }
}
