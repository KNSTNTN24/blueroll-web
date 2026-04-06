'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { seedDefaultChecklists } from '@/lib/seed-checklists'
import { PAYWALL_FEATURES } from '@/lib/constants'

// ── Types ──

type Scenario = 'new' | 'join' | null

interface FsaBusiness {
  FHRSID: number
  BusinessName: string
  AddressLine1: string
  AddressLine2: string
  AddressLine3: string
  PostCode: string
  RatingValue: string
  scores: {
    Hygiene: number | null
    Structural: number | null
    ConfidenceInManagement: number | null
  }
}

// ── Helpers ──

function ratingColor(rating: number) {
  if (rating >= 4) return 'bg-emerald-500'
  if (rating === 3) return 'bg-yellow-500'
  return 'bg-red-500'
}

function ratingBadgeColor(rating: number) {
  if (rating >= 4) return 'bg-emerald-100 text-emerald-700'
  if (rating === 3) return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-700'
}

function scoreBarWidth(score: number | null, max: number) {
  if (score === null || score === undefined) return 0
  return Math.round((score / max) * 100)
}

// ── Progress Bar ──

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors ${
            i < current ? 'bg-emerald-600' : 'bg-gray-200'
          }`}
        />
      ))}
    </div>
  )
}

// ── Main Component ──

export default function OnboardingPage() {
  const router = useRouter()

  // Session check
  const [checkingSession, setCheckingSession] = useState(true)

  // Wizard state
  const [step, setStep] = useState(1)
  const [scenario, setScenario] = useState<Scenario>(null)

  // Step 1: Name
  const [fullName, setFullName] = useState('')

  // Step 3a: Postcode search
  const [postcode, setPostcode] = useState('')
  const [searching, setSearching] = useState(false)
  const [fsaResults, setFsaResults] = useState<FsaBusiness[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [skippedFsa, setSkippedFsa] = useState(false)

  // Step 4a: Selected business
  const [selectedBusiness, setSelectedBusiness] = useState<FsaBusiness | null>(null)

  // Step 3b: Invite code
  const [inviteCode, setInviteCode] = useState('')

  // Step 6/4: Signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [signupError, setSignupError] = useState<string | null>(null)
  const [signingUp, setSigningUp] = useState(false)

  // Setting up account message
  const [settingUp, setSettingUp] = useState(false)

  // Paywall
  const [startingTrial, setStartingTrial] = useState(false)
  const [paywallError, setPaywallError] = useState<string | null>(null)

  const firstName = fullName.trim().split(' ')[0] || ''

  // Determine total steps and current display step
  const totalSteps = scenario === 'join' ? 5 : 7

  // Map internal step to display step for each scenario
  function getDisplayStep(): number {
    if (scenario === 'join') {
      // Steps: 1(name) 2(choice) 3(invite) 4(signup) 5(paywall)
      if (step <= 2) return step
      if (step === 3) return 3 // invite
      if (step === 4) return 4 // signup
      if (step === 5) return 5 // paywall
      return step
    }
    // Scenario A (new): 1(name) 2(choice) 3(postcode) 4(select) 5(rating) 6(signup) 7(paywall)
    return step
  }

  const displayStep = getDisplayStep()
  const isPaywallStep = (scenario === 'new' && step === 7) || (scenario === 'join' && step === 5)

  // ── Session check on mount ──
  useEffect(() => {
    let mounted = true
    const timeout = setTimeout(() => {
      if (mounted) setCheckingSession(false)
    }, 3000)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return
      if (!session?.user) {
        setCheckingSession(false)
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('business_id')
        .eq('id', session.user.id)
        .single()

      if (!mounted) return

      if (profile) {
        // Has profile, check subscription
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

  // ── FSA API search ──
  const searchFsa = useCallback(async () => {
    if (!postcode.trim()) return
    setSearching(true)
    setSearchError(null)
    setFsaResults([])

    try {
      const res = await fetch(
        `https://api.ratings.food.gov.uk/Establishments?address=${encodeURIComponent(
          postcode.trim()
        )}&pageSize=20&sortOptionKey=distance`,
        { headers: { 'x-api-version': '2', Accept: 'application/json' } }
      )
      if (!res.ok) throw new Error('Failed to search')
      const data = await res.json()
      const establishments: FsaBusiness[] = (data.establishments || []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => ({
          FHRSID: e.FHRSID,
          BusinessName: e.BusinessName,
          AddressLine1: e.AddressLine1 || '',
          AddressLine2: e.AddressLine2 || '',
          AddressLine3: e.AddressLine3 || '',
          PostCode: e.PostCode || '',
          RatingValue: e.RatingValue || 'Awaiting',
          scores: {
            Hygiene: e.scores?.Hygiene ?? null,
            Structural: e.scores?.Structural ?? null,
            ConfidenceInManagement: e.scores?.ConfidenceInManagement ?? null,
          },
        })
      )
      setFsaResults(establishments)
      if (establishments.length > 0) {
        setStep(4)
      }
    } catch {
      setSearchError('Could not search. Check the postcode and try again.')
    } finally {
      setSearching(false)
    }
  }, [postcode])

  // ── Signup handler ──
  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setSignupError(null)

    if (password !== confirmPassword) {
      setSignupError('Passwords do not match')
      return
    }
    if (password.length < 6) {
      setSignupError('Password must be at least 6 characters')
      return
    }

    setSigningUp(true)

    try {
      // 1. Sign up
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (signUpError) {
        if (
          signUpError.message.includes('already registered') ||
          signUpError.message.includes('already been registered')
        ) {
          setSignupError('This email is already registered. Try signing in.')
        } else {
          setSignupError(signUpError.message)
        }
        setSigningUp(false)
        return
      }

      const userId = signUpData.user?.id
      if (!userId) {
        setSignupError('Something went wrong. Please try again.')
        setSigningUp(false)
        return
      }

      setSettingUp(true)

      if (scenario === 'new') {
        // 2. Setup business via RPC
        const businessName = selectedBusiness?.BusinessName || `${firstName}'s Business`
        const businessAddress = selectedBusiness
          ? [selectedBusiness.AddressLine1, selectedBusiness.AddressLine2, selectedBusiness.AddressLine3]
              .filter(Boolean)
              .join(', ')
          : null
        const fhrsId = selectedBusiness?.FHRSID || null
        const fsaRating = selectedBusiness?.RatingValue || null
        const postCode = selectedBusiness?.PostCode || null

        const { error: rpcError } = await (supabase.rpc as any)('setup_business', {
          business_name: businessName,
          owner_name: fullName.trim(),
          business_address: businessAddress,
          fhrs_id: fhrsId,
          fsa_rating: fsaRating,
          post_code: postCode,
        })

        if (rpcError) {
          setSignupError(rpcError.message || 'Failed to set up business')
          setSigningUp(false)
          setSettingUp(false)
          return
        }

        // 3. Get business_id from profile to seed checklists
        const { data: profile } = await supabase
          .from('profiles')
          .select('business_id')
          .eq('id', userId)
          .single()

        if (profile?.business_id) {
          await seedDefaultChecklists(profile.business_id)
        }

        // 4. Go to paywall step
        setSettingUp(false)
        setSigningUp(false)
        setStep(7)
      } else {
        // Join team
        const { error: joinError } = await (supabase.rpc as any)('join_with_invite', {
          invite_token: inviteCode,
          member_name: fullName.trim(),
        })

        if (joinError) {
          setSignupError(
            'Invalid or expired invite token. Ask your manager for a new one.'
          )
          setSigningUp(false)
          setSettingUp(false)
          return
        }

        // Go to paywall step
        setSettingUp(false)
        setSigningUp(false)
        setStep(5)
      }
    } catch {
      setSignupError('Something went wrong. Please try again.')
      setSigningUp(false)
      setSettingUp(false)
    }
  }

  // ── Paywall: start trial ──
  async function handleStartTrial() {
    setStartingTrial(true)
    setPaywallError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        setPaywallError('Not authenticated. Please sign in again.')
        setStartingTrial(false)
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('business_id')
        .eq('id', session.user.id)
        .single()

      const { data, error } = await supabase.functions.invoke('create-subscription', {
        body: {
          userId: session.user.id,
          email: session.user.email,
          businessId: profile?.business_id,
        },
      })

      if (error) {
        setPaywallError('Failed to start trial. Please try again.')
        setStartingTrial(false)
        return
      }

      const checkoutUrl = data?.checkoutUrl || data?.url
      if (checkoutUrl) {
        window.location.href = checkoutUrl
      } else {
        setPaywallError('Failed to start trial. Please try again.')
        setStartingTrial(false)
      }
    } catch {
      setPaywallError('Something went wrong. Please try again.')
      setStartingTrial(false)
    }
  }

  // ── Back button logic ──
  function handleBack() {
    if (scenario === 'new') {
      if (step === 7) setStep(6)
      else if (step === 6) setStep(skippedFsa ? 3 : 5)
      else if (step === 5) setStep(4)
      else if (step === 4) setStep(3)
      else if (step === 3) { setStep(2); setScenario(null) }
      else if (step === 2) setStep(1)
    } else if (scenario === 'join') {
      if (step === 5) setStep(4)
      else if (step === 4) setStep(3)
      else if (step === 3) { setStep(2); setScenario(null) }
      else if (step === 2) setStep(1)
    } else {
      if (step === 2) setStep(1)
    }
  }

  // ── Loading states ──

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

  if (settingUp) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
          <div>
            <p className="text-lg font-medium text-gray-900">Setting up your account...</p>
            <p className="mt-1 text-sm text-gray-500">You&apos;ll be redirected automatically.</p>
          </div>
          <Link href="/paywall" className="mt-4 text-sm text-emerald-600 hover:text-emerald-500">
            If the page doesn&apos;t load within a few seconds, click here
          </Link>
        </div>
      </div>
    )
  }

  // ── Paywall step (inline, full screen) ──

  if (isPaywallStep) {
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

            {paywallError && (
              <div className="mt-6 rounded-lg bg-red-500/20 px-4 py-3 text-sm text-white border border-red-400/30">
                {paywallError}
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
            <Link
              href="/dashboard"
              className="mt-6 inline-block text-sm text-emerald-200 underline hover:text-white"
            >
              Continue to dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Wizard steps ──

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        {/* Progress bar */}
        <div className="mb-8">
          <ProgressBar current={displayStep} total={totalSteps} />
        </div>

        {/* Step 1: Name */}
        {step === 1 && (
          <div className="space-y-6">
            {step > 1 && (
              <button onClick={handleBack} className="text-sm text-gray-500 hover:text-gray-700">
                &larr; Back
              </button>
            )}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">First, tell us your name</h1>
              <p className="mt-1 text-sm text-gray-500">
                This is how you&apos;ll appear to your team
              </p>
            </div>
            <div>
              <input
                type="text"
                autoCapitalize="words"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            {fullName.trim() && (
              <button
                onClick={() => setStep(2)}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
              >
                Continue
              </button>
            )}
            <p className="text-center text-sm text-gray-500">
              Already have an account?{' '}
              <Link href="/login" className="font-medium text-emerald-600 hover:text-emerald-500">
                Sign in
              </Link>
            </p>
          </div>
        )}

        {/* Step 2: Choice */}
        {step === 2 && (
          <div className="space-y-6">
            <button onClick={handleBack} className="text-sm text-gray-500 hover:text-gray-700">
              &larr; Back
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Hey {firstName}</h1>
              <p className="mt-1 text-lg text-gray-600">What brings you here?</p>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => {
                  setScenario('new')
                  setStep(3)
                }}
                className="flex w-full items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm hover:border-emerald-300 hover:shadow-md transition-all"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50">
                  <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0021 9.349m-18 0h18" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Setting up a business</p>
                  <p className="text-sm text-gray-500">I&apos;m starting fresh</p>
                </div>
              </button>

              <button
                onClick={() => {
                  setScenario('join')
                  setStep(3)
                }}
                className="flex w-full items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm hover:border-emerald-300 hover:shadow-md transition-all"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50">
                  <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Joining a team</p>
                  <p className="text-sm text-gray-500">I have an invite code</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Step 3a: Postcode search (Scenario A) */}
        {step === 3 && scenario === 'new' && (
          <div className="space-y-6">
            <button onClick={handleBack} className="text-sm text-gray-500 hover:text-gray-700">
              &larr; Back
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Find your business</h1>
              <p className="mt-1 text-sm text-gray-500">
                Enter your postcode to find your FSA food hygiene rating
              </p>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <svg
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                <input
                  type="text"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') searchFsa()
                  }}
                  placeholder="e.g. SW1A 1AA"
                  className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <button
                onClick={searchFsa}
                disabled={searching || !postcode.trim()}
                className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {searching ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent inline-block" />
                ) : (
                  'Search'
                )}
              </button>
            </div>
            {searchError && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
                {searchError}
              </div>
            )}
            <button
              onClick={() => {
                setSkippedFsa(true)
                setSelectedBusiness(null)
                setStep(6)
              }}
              className="w-full text-center text-sm text-gray-500 hover:text-gray-700"
            >
              Skip &mdash; I&apos;ll set up manually
            </button>
          </div>
        )}

        {/* Step 3b: Invite code (Scenario B) */}
        {step === 3 && scenario === 'join' && (
          <div className="space-y-6">
            <button onClick={handleBack} className="text-sm text-gray-500 hover:text-gray-700">
              &larr; Back
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Enter your invite code</h1>
              <p className="mt-1 text-sm text-gray-500">
                Your manager can create one in Team &rarr; Invite
              </p>
            </div>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Paste your code"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-center font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            {inviteCode.trim() && (
              <button
                onClick={() => setStep(4)}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
              >
                Continue
              </button>
            )}
          </div>
        )}

        {/* Step 4a: Select business (Scenario A) */}
        {step === 4 && scenario === 'new' && (
          <div className="space-y-6">
            <button onClick={handleBack} className="text-sm text-gray-500 hover:text-gray-700">
              &larr; Back
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Select your business</h1>
              <p className="mt-1 text-sm text-gray-500">
                {fsaResults.length} business{fsaResults.length !== 1 ? 'es' : ''} found near{' '}
                {postcode.trim()}
              </p>
            </div>
            {fsaResults.length === 0 ? (
              <div className="space-y-4 text-center">
                <p className="text-sm text-gray-500">No businesses found.</p>
                <button
                  onClick={() => {
                    setSkippedFsa(true)
                    setSelectedBusiness(null)
                    setStep(6)
                  }}
                  className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
                >
                  Set up manually
                </button>
              </div>
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {fsaResults.map((biz) => {
                  const rating = parseInt(biz.RatingValue, 10)
                  const hasRating = !isNaN(rating)
                  return (
                    <button
                      key={biz.FHRSID}
                      onClick={() => {
                        setSelectedBusiness(biz)
                        setSkippedFsa(false)
                        setStep(5)
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm hover:border-emerald-300 hover:shadow-md transition-all"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate">{biz.BusinessName}</p>
                        <p className="text-sm text-gray-500 truncate">
                          {[biz.AddressLine1, biz.AddressLine2, biz.AddressLine3]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      </div>
                      {hasRating && (
                        <span
                          className={`flex-shrink-0 rounded-md px-2 py-1 text-sm font-bold ${ratingBadgeColor(rating)}`}
                        >
                          {rating}/5
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Step 5a: FSA Rating (Scenario A) */}
        {step === 5 && scenario === 'new' && selectedBusiness && (
          <div className="space-y-6">
            <button onClick={handleBack} className="text-sm text-gray-500 hover:text-gray-700">
              &larr; Back
            </button>

            <p className="text-sm font-medium text-gray-500">{selectedBusiness.BusinessName}</p>

            {/* Large rating square */}
            {(() => {
              const rating = parseInt(selectedBusiness.RatingValue, 10)
              const hasRating = !isNaN(rating)
              return hasRating ? (
                <div className="flex flex-col items-center gap-2">
                  <div
                    className={`flex h-28 w-28 items-center justify-center rounded-2xl text-white ${ratingColor(rating)}`}
                  >
                    <span className="text-5xl font-bold">{rating}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-500">Food Hygiene Rating</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex h-28 w-28 items-center justify-center rounded-2xl bg-gray-200 text-gray-500">
                    <span className="text-lg font-medium">N/A</span>
                  </div>
                  <p className="text-sm font-medium text-gray-500">Awaiting Inspection</p>
                </div>
              )
            })()}

            {/* Score breakdown */}
            <div className="space-y-3">
              {[
                { label: 'Hygiene', score: selectedBusiness.scores.Hygiene, max: 25 },
                { label: 'Structural', score: selectedBusiness.scores.Structural, max: 25 },
                {
                  label: 'Confidence in Management',
                  score: selectedBusiness.scores.ConfidenceInManagement,
                  max: 30,
                },
              ].map(({ label, score, max }) => (
                <div key={label}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-medium text-gray-900">
                      {score !== null && score !== undefined ? score : '—'}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${scoreBarWidth(score, max)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setStep(6)}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 6 (Scenario A) / Step 4 (Scenario B): Signup */}
        {((step === 6 && scenario === 'new') || (step === 4 && scenario === 'join')) && (
          <div className="space-y-6">
            <button onClick={handleBack} className="text-sm text-gray-500 hover:text-gray-700">
              &larr; Back
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Almost there</h1>
              <p className="mt-1 text-sm text-gray-500">
                {scenario === 'new'
                  ? selectedBusiness
                    ? `Setting up ${selectedBusiness.BusinessName}`
                    : 'Create your account to get started'
                  : 'Create your account to join the team'}
              </p>
            </div>

            <form onSubmit={handleSignup} className="space-y-4">
              {signupError && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
                  {signupError}
                </div>
              )}

              <div>
                <label htmlFor="signup-email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="signup-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label htmlFor="signup-password" className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <input
                  id="signup-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="At least 6 characters"
                />
              </div>

              <div>
                <label htmlFor="signup-confirm" className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm password
                </label>
                <input
                  id="signup-confirm"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Re-enter password"
                />
              </div>

              <button
                type="submit"
                disabled={signingUp}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {signingUp ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Creating account...
                  </span>
                ) : (
                  'Sign up'
                )}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500">
              Already have an account?{' '}
              <Link href="/login" className="font-medium text-emerald-600 hover:text-emerald-500">
                Sign in
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
