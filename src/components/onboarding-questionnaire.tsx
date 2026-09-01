'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CircleCheck, LoaderCircle } from 'lucide-react'
import { useOnboarding, type GeneratedChecklist } from '@/lib/onboarding/use-onboarding'
import type { Answers, Area, FohAnswers, FridgeUnit, KitchenAnswers } from '@/lib/onboarding/questionnaire'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'

type Step = 'areas' | 'kitchen' | 'foh' | 'preview' | 'done'

const AREA_OPTIONS: Array<{ value: Area; label: string; emoji: string }> = [
  { value: 'kitchen', label: 'Kitchen', emoji: '🍳' },
  { value: 'foh', label: 'Front of House', emoji: '🍽️' },
]

function Stepper({ label, value, onChange, min = 0 }: { label: string; value: number; onChange: (next: number) => void; min?: number }) {
  return (
    <div className="mt-3 flex items-center justify-between">
      <span className="text-[13px] text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-[15px] leading-none text-foreground hover:bg-accent"
        >
          −
        </button>
        <span className="w-4 text-center text-[13px] font-semibold text-foreground">{value}</span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(value + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-[15px] leading-none text-foreground hover:bg-accent"
        >
          +
        </button>
      </div>
    </div>
  )
}

function CheckboxRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="mt-2 flex items-center gap-2 text-[13px] text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  )
}

function makeFridges(count: number, existing: FridgeUnit[]): FridgeUnit[] {
  const next: FridgeUnit[] = []
  for (let i = 0; i < count; i++) {
    next.push(existing[i] ?? { name: `Fridge ${i + 1}`, kind: 'fridge' })
  }
  return next
}

/**
 * The from-scratch questionnaire wizard: pick areas, answer a short
 * mini-questionnaire per area, preview the generated checklists, and build.
 * Self-contained panel body — rendered inside the widget shell (Task 5).
 */
export function OnboardingQuestionnaire({ onBack }: { onBack: () => void }) {
  const { generate, generated, confirmBuild, status, result, errorMessage } = useOnboarding()

  const [step, setStep] = useState<Step>('areas')
  const [areas, setAreas] = useState<Area[]>([])

  const [fridgeCount, setFridgeCount] = useState(0)
  const [fridges, setFridges] = useState<FridgeUnit[]>([])
  const [probeCount, setProbeCount] = useState(0)
  const [sinkCount, setSinkCount] = useState(0)
  const [cooking, setCooking] = useState<KitchenAnswers['cooking']>([])
  const [kitchenRoutines, setKitchenRoutines] = useState({ opening: true, closing: true, cleaning: true, allergen: false })

  const [coldDisplayCount, setColdDisplayCount] = useState(0)
  const [fohRoutines, setFohRoutines] = useState({ opening: true, closing: true, cleaning: true })

  const [kept, setKept] = useState<Set<number>>(new Set())

  function toggleArea(area: Area) {
    setAreas((prev) => (prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]))
  }

  function toggleCooking(value: KitchenAnswers['cooking'][number]) {
    setCooking((prev) => (prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]))
  }

  function updateFridgeCount(next: number) {
    setFridgeCount(next)
    setFridges((prev) => makeFridges(next, prev))
  }

  function buildAnswers(): Answers {
    const kitchen: KitchenAnswers | undefined = areas.includes('kitchen')
      ? { fridges, probeCount, sinkCount, cooking, routines: kitchenRoutines }
      : undefined
    const foh: FohAnswers | undefined = areas.includes('foh')
      ? { coldDisplayCount, routines: fohRoutines }
      : undefined
    return { areas, kitchen, foh }
  }

  function handleGenerate() {
    void generate(buildAnswers())
  }

  function startAreaSteps() {
    if (areas.includes('kitchen')) {
      setStep('kitchen')
    } else if (areas.includes('foh')) {
      setStep('foh')
    }
  }

  function handleKitchenContinue() {
    if (areas.includes('foh')) {
      setStep('foh')
    } else {
      handleGenerate()
    }
  }

  // status-driven overlays take priority over the local step machine.
  if (status === 'generating') {
    return (
      <div className="flex flex-col items-center px-3 py-10 text-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-brand" />
        <p className="mt-3 text-[13px] text-muted-foreground">Building your checklists…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="px-1 py-2">
        <p className="text-[12.5px] text-warn" role="alert">
          {errorMessage ?? 'Something went wrong. Please try again.'}
        </p>
        <Button type="button" variant="outline" className="mt-4 w-full" onClick={onBack}>
          Back
        </Button>
      </div>
    )
  }

  if (status === 'done' && result) {
    return (
      <div className="flex flex-col items-center px-3 py-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-tint text-brand-deep">
          <CircleCheck className="h-7 w-7" strokeWidth={2} />
        </span>
        <div className="mt-4 text-[17px] font-semibold text-foreground">
          {result.templates} checklists are live
        </div>
        <Link href="/checklists" className={cn(buttonVariants(), 'mt-5 w-full transition-none')}>
          Go to checklists
        </Link>
      </div>
    )
  }

  if (status === 'preview' && generated) {
    return <PreviewStep generated={generated} kept={kept} setKept={setKept} confirmBuild={confirmBuild} />
  }

  if (step === 'kitchen') {
    return (
      <div className="px-1 py-2">
        <p className="text-[13px] font-semibold text-foreground">Kitchen</p>
        <Stepper label="Fridges & freezers" value={fridgeCount} onChange={updateFridgeCount} />
        <Stepper label="Probe thermometers" value={probeCount} onChange={setProbeCount} />
        <Stepper label="Sinks" value={sinkCount} onChange={setSinkCount} />

        <p className="mt-4 text-[11.5px] font-medium text-[#535963]">Cooking</p>
        <CheckboxRow label="Cooking from raw" checked={cooking.includes('raw')} onChange={() => toggleCooking('raw')} />
        <CheckboxRow label="Cook-chill" checked={cooking.includes('cook_chill')} onChange={() => toggleCooking('cook_chill')} />
        <CheckboxRow label="Reheating" checked={cooking.includes('reheat')} onChange={() => toggleCooking('reheat')} />

        <p className="mt-4 text-[11.5px] font-medium text-[#535963]">Routines</p>
        <CheckboxRow
          label="Opening checks"
          checked={kitchenRoutines.opening}
          onChange={(v) => setKitchenRoutines((prev) => ({ ...prev, opening: v }))}
        />
        <CheckboxRow
          label="Closing checks"
          checked={kitchenRoutines.closing}
          onChange={(v) => setKitchenRoutines((prev) => ({ ...prev, closing: v }))}
        />
        <CheckboxRow
          label="Cleaning schedule"
          checked={kitchenRoutines.cleaning}
          onChange={(v) => setKitchenRoutines((prev) => ({ ...prev, cleaning: v }))}
        />
        <CheckboxRow
          label="Allergen control"
          checked={kitchenRoutines.allergen}
          onChange={(v) => setKitchenRoutines((prev) => ({ ...prev, allergen: v }))}
        />

        <Button type="button" className="mt-5 w-full transition-none" onClick={handleKitchenContinue}>
          {areas.includes('foh') ? 'Continue' : 'Create my checklists'}
        </Button>
      </div>
    )
  }

  if (step === 'foh') {
    return (
      <div className="px-1 py-2">
        <p className="text-[13px] font-semibold text-foreground">Front of House</p>
        <Stepper label="Chilled display units" value={coldDisplayCount} onChange={setColdDisplayCount} />

        <p className="mt-4 text-[11.5px] font-medium text-[#535963]">Routines</p>
        <CheckboxRow
          label="Opening checks"
          checked={fohRoutines.opening}
          onChange={(v) => setFohRoutines((prev) => ({ ...prev, opening: v }))}
        />
        <CheckboxRow
          label="Closing checks"
          checked={fohRoutines.closing}
          onChange={(v) => setFohRoutines((prev) => ({ ...prev, closing: v }))}
        />
        <CheckboxRow
          label="Cleaning schedule"
          checked={fohRoutines.cleaning}
          onChange={(v) => setFohRoutines((prev) => ({ ...prev, cleaning: v }))}
        />

        <Button type="button" className="mt-5 w-full transition-none" onClick={handleGenerate}>
          Create my checklists
        </Button>
      </div>
    )
  }

  // step === 'areas'
  return (
    <div className="px-1 py-2">
      <p className="text-[13px] font-semibold text-foreground">Which areas do you want checklists for?</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {AREA_OPTIONS.map((option) => {
          const selected = areas.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleArea(option.value)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border px-3 py-4 text-[13px] font-medium transition-colors',
                selected
                  ? 'border-brand bg-brand-tint text-brand-deep'
                  : 'border-border text-foreground hover:bg-accent',
              )}
            >
              <span className="text-[22px]">{option.emoji}</span>
              {option.label}
            </button>
          )
        })}
      </div>

      <div className="mt-5 flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button type="button" className="flex-1 transition-none" disabled={areas.length === 0} onClick={startAreaSteps}>
          Continue
        </Button>
      </div>
    </div>
  )
}

function PreviewStep({
  generated,
  kept,
  setKept,
  confirmBuild,
}: {
  generated: GeneratedChecklist[]
  kept: Set<number>
  setKept: (next: Set<number>) => void
  confirmBuild: (checklists: GeneratedChecklist[]) => void
}) {
  function isKept(index: number) {
    return !kept.has(index)
  }

  function toggle(index: number) {
    const next = new Set(kept)
    if (next.has(index)) {
      next.delete(index)
    } else {
      next.add(index)
    }
    setKept(next)
  }

  function handleBuild() {
    const keptChecklists = generated.filter((_, index) => isKept(index))
    void confirmBuild(keptChecklists)
  }

  return (
    <div className="px-1 py-2">
      <p className="text-[13px] font-semibold text-foreground">Review your checklists</p>
      <div className="mt-3 flex flex-col gap-2">
        {generated.map((checklist, index) => (
          <label
            key={`${checklist.name}-${index}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            <span className="min-w-0 flex-1 text-[13px] text-foreground">
              <span className="block font-medium">{checklist.name}</span>
              <span className="block text-[11.5px] text-muted-foreground">{checklist.items.length} items</span>
            </span>
            <input
              type="checkbox"
              checked={isKept(index)}
              onChange={() => toggle(index)}
            />
          </label>
        ))}
      </div>

      <Button type="button" className="mt-5 w-full transition-none" onClick={handleBuild}>
        Build
      </Button>
    </div>
  )
}
