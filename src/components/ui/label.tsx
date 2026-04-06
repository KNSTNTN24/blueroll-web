import { forwardRef, type LabelHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn('text-[13px] font-medium text-foreground', className)}
        {...props}
      />
    )
  },
)
Label.displayName = 'Label'

export { Label }
