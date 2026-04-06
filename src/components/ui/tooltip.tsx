'use client'

import * as React from 'react'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { cn } from '@/lib/utils'

const TooltipProvider = BaseTooltip.Provider

const Tooltip = BaseTooltip.Root

const TooltipTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof BaseTooltip.Trigger>
>((props, ref) => <BaseTooltip.Trigger ref={ref} {...props} />)
TooltipTrigger.displayName = 'TooltipTrigger'

const TooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseTooltip.Popup> & {
    side?: 'top' | 'right' | 'bottom' | 'left'
    sideOffset?: number
  }
>(({ className, side = 'right', sideOffset = 8, children, ...props }, ref) => (
  <BaseTooltip.Portal>
    <BaseTooltip.Positioner side={side} sideOffset={sideOffset}>
      <BaseTooltip.Popup
        ref={ref}
        className={cn(
          'z-50 rounded-md bg-foreground px-2.5 py-1 text-[12px] text-background animate-in fade-in-0 zoom-in-95',
          className
        )}
        {...props}
      >
        {children}
      </BaseTooltip.Popup>
    </BaseTooltip.Positioner>
  </BaseTooltip.Portal>
))
TooltipContent.displayName = 'TooltipContent'

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
