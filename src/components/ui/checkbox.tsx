import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        type="checkbox"
        ref={ref}
        className={cn(
          'h-4 w-4 rounded border-border text-emerald-600 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer',
          className,
        )}
        {...props}
      />
    )
  },
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
