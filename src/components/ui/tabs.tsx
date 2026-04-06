'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const TabsContext = createContext<{ value: string; onChange: (v: string) => void }>({
  value: '',
  onChange: () => {},
})

interface TabsProps {
  defaultValue: string
  value?: string
  onValueChange?: (v: string) => void
  children: ReactNode
  className?: string
}

export function Tabs({ defaultValue, value: controlledValue, onValueChange, children, className }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue)
  const value = controlledValue ?? internal
  const onChange = (v: string) => {
    setInternal(v)
    onValueChange?.(v)
  }
  return (
    <TabsContext.Provider value={{ value, onChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('inline-flex h-9 items-center gap-1 rounded-lg bg-gray-100/80 p-1', className)}>
      {children}
    </div>
  )
}

export function TabsTrigger({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useContext(TabsContext)
  const active = ctx.value === value
  return (
    <button
      type="button"
      onClick={() => ctx.onChange(value)}
      className={cn(
        'inline-flex items-center justify-center rounded-md px-3 py-1 text-[13px] font-medium transition-colors',
        active ? 'bg-white text-foreground' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useContext(TabsContext)
  if (ctx.value !== value) return null
  return <div className={className}>{children}</div>
}
