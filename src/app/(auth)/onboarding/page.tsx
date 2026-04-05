'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PAIN_POINTS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import {
  Search,
  MapPin,
  Star,
  Check,
  ArrowRight,
  ArrowLeft,
  Building2,
  Loader2,
} from 'lucide-react'

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

type Step = 'search' | 'select' | 'rating' | 'pain-points' | 'signup'

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('search')
  const [postcode, setPostcode] = useState('')
  const [searchResults, setSearchResults] = useState<FsaEstablishment[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<FsaEstablishment | null>(null)
  const [painPoints, setPainPoints] = useState<Set<string>>(new Set())

  // Signup form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [signupError, setSignupError] = useState('')
  const [signupLoading, setSignupLoading] = useState(false)

  const searchFsa = useCallback(async () => {
    if (!postcode.trim()) return
    setSearching(true)
    try {
      const res = await fetch(
        `https://api.ratings.food.gov.uk/Establishments?address=${encodeURIComponent(
          postcode
        )}&pageSize=20&sortOptionKey=distance`,
        {
          headers: {
            'x-api-version': '2',
            Accept: 'application/json',
          },
        }
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
    setSignupLoading(true)

    try {
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
      })
      if (authError) throw authError

      // If invite code, join via invite
      if (inviteCode.trim()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: joinError } = await (supabase.rpc as any)('join_with_invite', {
          invite_token: inviteCode.trim(),
          member_name: name,
        })
        if (joinError) throw joinError
      } else {
        // Create business
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: setupError } = await (supabase.rpc as any)('setup_business', {
          business_name: selected?.BusinessName ?? 'My Restaurant',
          owner_name: name,
          business_address: selected
            ? [selected.AddressLine1, selected.AddressLine2, selected.PostCode]
                .filter(Boolean)
                .join(', ')
            : undefined,
          p_fhrs_id: selected?.FHRSID,
          p_fsa_rating: selected?.RatingValue,
          p_post_code: selected?.PostCode,
        })
        if (setupError) throw setupError
      }

      router.push('/dashboard')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setSignupError(message)
    } finally {
      setSignupLoading(false)
    }
  }

  const ratingColor = (rating: string) => {
    const n = parseInt(rating)
    if (n >= 4) return 'text-emerald-600 bg-emerald-50 border-emerald-200'
    if (n >= 3) return 'text-amber-600 bg-amber-50 border-amber-200'
    return 'text-red-600 bg-red-50 border-red-200'
  }

  return (
    <div>
      {/* Progress */}
      <div className="mb-8 flex gap-1">
        {(['search', 'select', 'rating', 'pain-points', 'signup'] as Step[]).map(
          (s, i) => (
            <div
              key={s}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                (['search', 'select', 'rating', 'pain-points', 'signup'] as Step[]).indexOf(step) >= i
                  ? 'bg-emerald-600'
                  : 'bg-gray-200'
              )}
            />
          )
        )}
      </div>

      {/* Step: Search */}
      {step === 'search' && (
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Find your business
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Enter your postcode to find your FSA food hygiene rating
          </p>

          <div className="mt-6 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  placeholder="e.g. SW1A 1AA"
                  className="pl-9"
                  onKeyDown={(e) => e.key === 'Enter' && searchFsa()}
                  autoFocus
                />
              </div>
              <Button
                onClick={searchFsa}
                disabled={searching || !postcode.trim()}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>

            <button
              onClick={() => setStep('signup')}
              className="text-[13px] text-muted-foreground hover:text-foreground"
            >
              Skip — I&apos;ll set up manually
            </button>
          </div>
        </div>
      )}

      {/* Step: Select business */}
      {step === 'select' && (
        <div>
          <button
            onClick={() => setStep('search')}
            className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <h1 className="text-xl font-semibold tracking-tight">
            Select your business
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {searchResults.length} businesses found near {postcode}
          </p>

          <div className="mt-4 max-h-[400px] space-y-2 overflow-y-auto">
            {searchResults.map((est) => (
              <button
                key={est.FHRSID}
                onClick={() => {
                  setSelected(est)
                  setStep('rating')
                }}
                className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
              >
                <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {est.BusinessName}
                  </p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {[est.AddressLine1, est.PostCode].filter(Boolean).join(', ')}
                  </p>
                </div>
                {est.RatingValue && !isNaN(parseInt(est.RatingValue)) && (
                  <span
                    className={cn(
                      'shrink-0 rounded-md border px-2 py-0.5 text-[12px] font-semibold',
                      ratingColor(est.RatingValue)
                    )}
                  >
                    {est.RatingValue}/5
                  </span>
                )}
              </button>
            ))}
          </div>

          {searchResults.length === 0 && (
            <div className="mt-8 text-center">
              <p className="text-[13px] text-muted-foreground">
                No businesses found.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setStep('signup')}
              >
                Set up manually
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Step: Rating reveal */}
      {step === 'rating' && selected && (
        <div>
          <button
            onClick={() => setStep('select')}
            className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>

          <div className="text-center">
            <p className="text-[13px] font-medium text-muted-foreground">
              {selected.BusinessName}
            </p>
            <div className="mt-6 flex justify-center">
              <div
                className={cn(
                  'flex h-24 w-24 items-center justify-center rounded-2xl border-2 text-4xl font-bold',
                  ratingColor(selected.RatingValue)
                )}
              >
                {isNaN(parseInt(selected.RatingValue))
                  ? selected.RatingValue
                  : selected.RatingValue}
              </div>
            </div>
            <p className="mt-3 text-[13px] text-muted-foreground">
              Food Hygiene Rating
            </p>

            {/* Score breakdown */}
            {selected.scores && (
              <div className="mx-auto mt-6 max-w-xs space-y-2">
                {[
                  { label: 'Hygiene', score: selected.scores.Hygiene },
                  { label: 'Structural', score: selected.scores.Structural },
                  { label: 'Confidence in Management', score: selected.scores.ConfidenceInManagement },
                ].map(
                  (item) =>
                    item.score !== null && (
                      <div key={item.label} className="flex items-center justify-between">
                        <span className="text-[12px] text-muted-foreground">
                          {item.label}
                        </span>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{
                                width: `${Math.max(0, 100 - (item.score / 25) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    )
                )}
              </div>
            )}

            <Button
              onClick={() => setStep('pain-points')}
              className="mt-8 bg-emerald-600 hover:bg-emerald-700"
            >
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step: Pain points */}
      {step === 'pain-points' && (
        <div>
          <button
            onClick={() => setStep('rating')}
            className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <h1 className="text-xl font-semibold tracking-tight">
            What are your biggest headaches?
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Select all that apply — this helps us personalise your experience
          </p>

          <div className="mt-6 space-y-2">
            {PAIN_POINTS.map((point) => (
              <button
                key={point}
                onClick={() => togglePainPoint(point)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-3 text-left text-[13px] transition-colors',
                  painPoints.has(point)
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-border hover:bg-accent'
                )}
              >
                <div
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                    painPoints.has(point)
                      ? 'border-emerald-500 bg-emerald-500'
                      : 'border-gray-300'
                  )}
                >
                  {painPoints.has(point) && (
                    <Check className="h-3 w-3 text-white" />
                  )}
                </div>
                {point}
              </button>
            ))}
          </div>

          <Button
            onClick={() => setStep('signup')}
            className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700"
          >
            Create my account
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Step: Signup */}
      {step === 'signup' && (
        <div>
          {selected && (
            <button
              onClick={() => setStep('pain-points')}
              className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          )}
          <h1 className="text-xl font-semibold tracking-tight">
            Create your account
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {selected
              ? `Setting up ${selected.BusinessName}`
              : 'Get started with Blueroll'}
          </p>

          <form onSubmit={handleSignup} className="mt-6 space-y-4">
            {signupError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                {signupError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-[13px]">
                Your name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Smith"
                required
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="signup-email" className="text-[13px]">
                Email
              </Label>
              <Input
                id="signup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@restaurant.com"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="signup-password" className="text-[13px]">
                Password
              </Label>
              <Input
                id="signup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                required
                minLength={6}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite" className="text-[13px]">
                Invite code{' '}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="invite"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Paste invite code to join a team"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              disabled={signupLoading}
            >
              {signupLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {signupLoading ? 'Creating account...' : 'Create account'}
            </Button>
          </form>

          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            Already have an account?{' '}
            <Link
              href="/login"
              className="font-medium text-emerald-600 hover:text-emerald-700"
            >
              Sign in
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
