'use client'

import { useState, useCallback, useEffect } from 'react'
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
  Check,
  ArrowRight,
  ArrowLeft,
  Building2,
  Loader2,
  Users,
  Store,
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

// Flow A (new business): name → choice → postcode → select → rating → painpoints → signup (7 steps)
// Flow B (join team):    name → choice → invite → painpoints → signup (5 steps)
type Step =
  | 'name'
  | 'choice'
  | 'postcode'
  | 'select'
  | 'rating'
  | 'invite'
  | 'pain-points'
  | 'signup'

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('name')
  const [isJoinFlow, setIsJoinFlow] = useState(false)
  const [checking, setChecking] = useState(true)

  // If user is already logged in with a profile, go to dashboard
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', session.user.id)
          .single()
        if (profile) {
          router.replace('/dashboard')
          return
        }
      }
      setChecking(false)
    }).catch(() => setChecking(false))
  }, [router])

  // Name
  const [name, setName] = useState('')

  // FSA search
  const [postcode, setPostcode] = useState('')
  const [searchResults, setSearchResults] = useState<FsaEstablishment[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<FsaEstablishment | null>(null)

  // Invite
  const [inviteCode, setInviteCode] = useState('')

  // Pain points
  const [painPoints, setPainPoints] = useState<Set<string>>(new Set())

  // Signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [signupError, setSignupError] = useState('')
  const [signupLoading, setSignupLoading] = useState(false)

  // Step tracking for progress bar
  const stepsForFlow = isJoinFlow
    ? ['name', 'choice', 'invite', 'pain-points', 'signup']
    : ['name', 'choice', 'postcode', 'select', 'rating', 'pain-points', 'signup']

  const currentStepIndex = stepsForFlow.indexOf(step)
  const totalSteps = stepsForFlow.length

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

    if (password !== confirmPassword) {
      setSignupError('Passwords do not match')
      return
    }
    if (password.length < 6) {
      setSignupError('Password must be at least 6 characters')
      return
    }

    setSignupLoading(true)

    try {
      const { error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      })
      if (authError) {
        if (authError.message.includes('already registered')) {
          setSignupError('This email is already registered. Try signing in.')
        } else {
          throw authError
        }
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
            ? [selected.AddressLine1, selected.AddressLine2, selected.PostCode]
                .filter(Boolean)
                .join(', ')
            : undefined,
          p_fhrs_id: selected?.FHRSID,
          p_fsa_rating: selected?.RatingValue,
          p_post_code: selected?.PostCode,
        })
        if (setupError) throw setupError

        // Seed default checklists for new business
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('business_id')
            .eq('id', (await supabase.auth.getUser()).data.user!.id)
            .single()
          if (profile?.business_id) {
            await seedDefaultChecklists(profile.business_id)
          }
        } catch {
          // Non-critical — checklists can be created manually
        }
      }

      // Full page reload to ensure auth store picks up the new session + profile
      window.location.href = '/dashboard'
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setSignupError(message)
      setSignupLoading(false)
    }
  }

  const ratingColor = (rating: string) => {
    const n = parseInt(rating)
    if (n >= 4) return 'text-emerald-600 bg-emerald-50 border-emerald-200'
    if (n >= 3) return 'text-amber-600 bg-amber-50 border-amber-200'
    return 'text-red-600 bg-red-50 border-red-200'
  }

  const goBack = () => {
    const idx = stepsForFlow.indexOf(step)
    if (idx > 0) {
      setStep(stepsForFlow[idx - 1] as Step)
    }
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div>
      {/* Progress */}
      <div className="mb-8 flex gap-1">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              currentStepIndex >= i ? 'bg-emerald-600' : 'bg-gray-200'
            )}
          />
        ))}
      </div>

      {/* Step: Name */}
      {step === 'name' && (
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            First, tell us your name
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            This is how you&apos;ll appear to your team
          </p>

          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-[13px]">Your name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoFocus
                autoCapitalize="words"
                onKeyDown={(e) => e.key === 'Enter' && name.trim() && setStep('choice')}
              />
            </div>

            {name.trim() && (
              <Button
                onClick={() => setStep('choice')}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>

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

      {/* Step: Choice */}
      {step === 'choice' && (
        <div>
          <button onClick={goBack} className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>

          <p className="text-[13px] text-muted-foreground">
            Hey {name.split(' ')[0]}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            What brings you here?
          </h1>

          <div className="mt-6 space-y-3">
            <button
              onClick={() => {
                setIsJoinFlow(false)
                setStep('postcode')
              }}
              className="flex w-full items-center gap-4 rounded-lg border border-border p-4 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <Store className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[14px] font-medium">Setting up a business</p>
                <p className="text-[12px] text-muted-foreground">I&apos;m starting fresh</p>
              </div>
            </button>

            <button
              onClick={() => {
                setIsJoinFlow(true)
                setStep('invite')
              }}
              className="flex w-full items-center gap-4 rounded-lg border border-border p-4 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[14px] font-medium">Joining a team</p>
                <p className="text-[12px] text-muted-foreground">I have an invite code</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Step: Invite code */}
      {step === 'invite' && (
        <div>
          <button onClick={goBack} className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <h1 className="text-xl font-semibold tracking-tight">
            Enter your invite code
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Your manager can create one in Team &rarr; Invite
          </p>

          <div className="mt-6 space-y-4">
            <Input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="ABC123"
              className="text-center font-mono tracking-widest"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && inviteCode.trim() && setStep('pain-points')}
            />

            {inviteCode.trim() && (
              <Button
                onClick={() => setStep('pain-points')}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Step: Postcode search */}
      {step === 'postcode' && (
        <div>
          <button onClick={goBack} className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
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
              onClick={() => setStep('pain-points')}
              className="text-[13px] text-muted-foreground hover:text-foreground"
            >
              Skip &mdash; I&apos;ll set up manually
            </button>
          </div>
        </div>
      )}

      {/* Step: Select business */}
      {step === 'select' && (
        <div>
          <button onClick={() => setStep('postcode')} className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
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
                onClick={() => { setSelected(est); setStep('rating') }}
                className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
              >
                <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{est.BusinessName}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {[est.AddressLine1, est.PostCode].filter(Boolean).join(', ')}
                  </p>
                </div>
                {est.RatingValue && !isNaN(parseInt(est.RatingValue)) && (
                  <span className={cn('shrink-0 rounded-md border px-2 py-0.5 text-[12px] font-semibold', ratingColor(est.RatingValue))}>
                    {est.RatingValue}/5
                  </span>
                )}
              </button>
            ))}
          </div>

          {searchResults.length === 0 && (
            <div className="mt-8 text-center">
              <p className="text-[13px] text-muted-foreground">No businesses found.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setStep('pain-points')}>
                Set up manually
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Step: Rating reveal */}
      {step === 'rating' && selected && (
        <div>
          <button onClick={() => setStep('select')} className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>

          <div className="text-center">
            <p className="text-[13px] font-medium text-muted-foreground">{selected.BusinessName}</p>
            <div className="mt-6 flex justify-center">
              <div className={cn('flex h-24 w-24 items-center justify-center rounded-2xl border-2 text-4xl font-bold', ratingColor(selected.RatingValue))}>
                {selected.RatingValue}
              </div>
            </div>
            <p className="mt-3 text-[13px] text-muted-foreground">Food Hygiene Rating</p>

            {selected.scores && (
              <div className="mx-auto mt-6 max-w-xs space-y-2">
                {[
                  { label: 'Hygiene', score: selected.scores.Hygiene },
                  { label: 'Structural', score: selected.scores.Structural },
                  { label: 'Confidence in Management', score: selected.scores.ConfidenceInManagement },
                ].map((item) =>
                  item.score !== null && (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="text-[12px] text-muted-foreground">{item.label}</span>
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, 100 - (item.score / 25) * 100)}%` }} />
                      </div>
                    </div>
                  )
                )}
              </div>
            )}

            <Button onClick={() => setStep('pain-points')} className="mt-8 bg-emerald-600 hover:bg-emerald-700">
              Continue <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step: Pain points */}
      {step === 'pain-points' && (
        <div>
          <button onClick={goBack} className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <h1 className="text-xl font-semibold tracking-tight">
            What are your biggest headaches?
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Select all that apply &mdash; this helps us personalise your experience
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
                <div className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                  painPoints.has(point) ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300'
                )}>
                  {painPoints.has(point) && <Check className="h-3 w-3 text-white" />}
                </div>
                {point}
              </button>
            ))}
          </div>

          <Button onClick={() => setStep('signup')} className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700">
            Create my account <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Step: Signup */}
      {step === 'signup' && (
        <div>
          <button onClick={goBack} className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <h1 className="text-xl font-semibold tracking-tight">Almost there</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {isJoinFlow
              ? 'Create your account to join the team'
              : selected
                ? `Setting up ${selected.BusinessName}`
                : 'Create your account to get started'}
          </p>

          <form onSubmit={handleSignup} className="mt-6 space-y-4">
            {signupError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                {signupError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="signup-email" className="text-[13px]">Email</Label>
              <Input
                id="signup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@restaurant.com"
                required
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="signup-password" className="text-[13px]">Password</Label>
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
              <Label htmlFor="confirm-password" className="text-[13px]">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
                required
                minLength={6}
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              disabled={signupLoading}
            >
              {signupLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {signupLoading ? 'Creating account...' : 'Sign up'}
            </Button>
          </form>

          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-emerald-600 hover:text-emerald-700">
              Sign in
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}

// Seed default HACCP checklist templates for a new business
async function seedDefaultChecklists(businessId: string) {
  // Check if already seeded
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
      .insert({
        ...templateData,
        business_id: businessId,
        is_default: true,
        active: false,
      })
      .select('id')
      .single()

    if (tmpl) {
      const itemRows = items.map((item) => ({
        ...item,
        template_id: tmpl.id,
      }))
      await supabase.from('checklist_template_items').insert(itemRows)
    }
  }
}
