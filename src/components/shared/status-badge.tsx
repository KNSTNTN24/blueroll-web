import { cn } from '@/lib/utils'

type Status = 'success' | 'warning' | 'error' | 'info' | 'neutral'

const statusStyles: Record<Status, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  neutral: 'bg-gray-50 text-gray-600 border-gray-200',
}

const dotStyles: Record<Status, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-gray-400',
}

interface StatusBadgeProps {
  status: Status
  label: string
  className?: string
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        statusStyles[status],
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dotStyles[status])} />
      {label}
    </span>
  )
}
