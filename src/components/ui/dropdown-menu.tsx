'use client'

import * as React from 'react'
import { Menu as BaseMenu } from '@base-ui/react/menu'
import { cn } from '@/lib/utils'

const DropdownMenu = BaseMenu.Root

const DropdownMenuTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof BaseMenu.Trigger>
>((props, ref) => <BaseMenu.Trigger ref={ref} {...props} />)
DropdownMenuTrigger.displayName = 'DropdownMenuTrigger'

const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseMenu.Popup> & {
    align?: 'start' | 'center' | 'end'
    sideOffset?: number
    side?: 'top' | 'right' | 'bottom' | 'left'
  }
>(({ className, align = 'end', sideOffset = 4, side = 'bottom', ...props }, ref) => (
  <BaseMenu.Portal>
    <BaseMenu.Positioner side={side} alignment={align} sideOffset={sideOffset}>
      <BaseMenu.Popup
        ref={ref}
        className={cn(
          'z-50 min-w-[180px] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground animate-in fade-in-0 zoom-in-95',
          className
        )}
        {...props}
      />
    </BaseMenu.Positioner>
  </BaseMenu.Portal>
))
DropdownMenuContent.displayName = 'DropdownMenuContent'

const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseMenu.Item>
>(({ className, ...props }, ref) => (
  <BaseMenu.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none transition-colors hover:bg-accent focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = 'DropdownMenuItem'

const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border', className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator'

const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('px-2 py-1.5 text-[12px] font-medium text-muted-foreground', className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = 'DropdownMenuLabel'

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
}
