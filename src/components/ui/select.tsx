import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  onValueChange?: (value: string | null) => void
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, onValueChange, onChange, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-[13px] text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        onChange={(e) => {
          onChange?.(e)
          const val = e.target.value
          onValueChange?.(val === '' ? null : val)
        }}
        {...props}
      >
        {children}
      </select>
    )
  },
)
Select.displayName = 'Select'

export { Select }
