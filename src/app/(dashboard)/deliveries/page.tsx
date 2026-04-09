'use client'

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { useRouter } from 'next/navigation'
import { Truck, Plus, Image as ImageIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

interface Delivery {
  id: string
  supplier_id: string
  received_by: string
  product_temperature: number | null
  notes: string | null
  photos: string[] | null
  received_at: string
  created_at: string
  supplier?: { name: string }
  receiver?: { full_name: string | null; email: string }
}

function tempColor(temp: number | null): string {
  if (temp === null) return 'text-muted-foreground'
  if (temp <= 5) return 'text-emerald-700'
  if (temp <= 8) return 'text-amber-700'
  return 'text-red-700'
}

function tempBg(temp: number | null): string {
  if (temp === null) return ''
  if (temp <= 5) return 'bg-emerald-50'
  if (temp <= 8) return 'bg-amber-50'
  return 'bg-red-50'
}

export default function DeliveriesPage() {
  const business = useAuthStore((s) => s.business)
  const router = useRouter()

  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: ['deliveries', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('deliveries')
        .select('*, supplier:suppliers(name), receiver:profiles!deliveries_received_by_fkey(full_name, email)')
        .eq('business_id', business.id)
        .order('received_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Delivery[]
    },
    enabled: !!business?.id,
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Deliveries" description="Track incoming deliveries" />
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Deliveries" description="Track incoming deliveries">
        <Button size="sm" onClick={() => router.push('/deliveries/new')}>
          <Plus className="h-3.5 w-3.5" />
          New delivery
        </Button>
      </PageHeader>

      {deliveries.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No deliveries"
          description="Record your first delivery to start tracking."
          action={{ label: 'New delivery', onClick: () => router.push('/deliveries/new') }}
        />
      ) : (
        <div className="rounded-lg border border-border bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Date</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Supplier</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Received by</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Temperature</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Photos</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deliveries.map((d) => (
                <tr key={d.id} className="hover:bg-accent/50">
                  <td className="px-4 py-2.5 text-[13px] tabular-nums text-muted-foreground">
                    {format(new Date(d.received_at || d.created_at), 'dd MMM yyyy HH:mm')}
                  </td>
                  <td className="px-4 py-2.5 text-[13px] font-medium text-foreground">
                    {d.supplier?.name ?? 'Unknown'}
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-muted-foreground">
                    {d.receiver?.full_name || d.receiver?.email || 'Unknown'}
                  </td>
                  <td className="px-4 py-2.5">
                    {d.product_temperature !== null ? (
                      <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[13px] font-medium tabular-nums', tempColor(d.product_temperature), tempBg(d.product_temperature))}>
                        {d.product_temperature}°C
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {(d.photos?.length ?? 0) > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                        <ImageIcon className="h-3.5 w-3.5" />
                        {d.photos!.length}
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="max-w-xs truncate px-4 py-2.5 text-[13px] text-muted-foreground">
                    {d.notes || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
