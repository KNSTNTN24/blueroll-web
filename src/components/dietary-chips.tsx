'use client'

import { DIETARY_FLAGS, computeDietary, type DietaryOverrides } from '@/lib/dietary'
import { cn } from '@/lib/utils'

// Tri-state chips: auto (computed, muted) -> tap to force ON -> tap to force OFF -> tap back to auto.
export function DietaryChips({
  overrides, allergens, onChange,
}: {
  overrides: DietaryOverrides
  allergens: string[]
  onChange: (next: DietaryOverrides) => void
}) {
  const computed = computeDietary(allergens)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {DIETARY_FLAGS.map((f) => {
        const o = overrides[f.column]
        const on = o ?? computed.includes(f.label)
        return (
          <button
            key={f.label}
            type="button"
            onClick={() => {
              const next: boolean | null = o === null ? true : o === true ? false : null
              onChange({ ...overrides, [f.column]: next })
            }}
            title={o === null ? 'Auto (from allergens) — tap to override' : 'Overridden — tap to cycle'}
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium border transition-colors',
              on
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-gray-50 text-muted-foreground border-border line-through',
              o !== null && 'ring-1 ring-emerald-400',
            )}
          >
            {f.label}
            {o === null && <span className="ml-1 text-[10px] opacity-60">auto</span>}
          </button>
        )
      })}
    </div>
  )
}
