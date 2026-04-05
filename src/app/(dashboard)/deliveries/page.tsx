'use client'

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Truck,
  Plus,
  Thermometer,
  Camera,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'

type DeliveryRow = {
  id: string
  supplier_id: string | null
  received_by: string | null
  received_at: string
  product_temperature: number | null
  notes: string | null
  business_id: string
  created_at: string
  supplier: { name: string } | null
  receiver: { full_name: string | null } | null
  delivery_photos: { id: string }[]
}

export default function DeliveriesPage() {
  const { business } = useAuthStore()
  const router = useRouter()

  const { data: deliveries, isLoading } = useQuery({
    queryKey: ['deliveries', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('deliveries')
        .select('*, supplier:suppliers(name), receiver:profiles!deliveries_received_by_fkey(full_name), delivery_photos(id)')
        .eq('business_id', business!.id)
        .order('received_at', { ascending: false })
      return (data ?? []) as unknown as DeliveryRow[]
    },
    enabled: !!business?.id,
  })

  const tempColor = (temp: number | null) => {
    if (temp === null) return 'text-muted-foreground'
    if (temp > 8 || temp < -25) return 'text-red-600 font-medium'
    if (temp > 5) return 'text-amber-600 font-medium'
    return 'text-emerald-600'
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deliveries"
        description="Record and track goods-in deliveries"
      >
        <Button
          onClick={() => router.push('/deliveries/new')}
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New Delivery
        </Button>
      </PageHeader>

      {!deliveries || deliveries.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No deliveries recorded"
          description="Record your first goods-in delivery to track supplier temperatures and compliance."
          action={{
            label: 'Record Delivery',
            onClick: () => router.push('/deliveries/new'),
          }}
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
              {deliveries.map((delivery) => (
                <tr key={delivery.id} className="transition-colors hover:bg-accent/50">
                  <td className="px-4 py-3 text-[13px] tabular-nums text-muted-foreground">
                    {format(new Date(delivery.received_at), 'dd MMM yyyy HH:mm')}
                  </td>
                  <td className="px-4 py-3 text-[13px] font-medium">
                    {delivery.supplier?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-muted-foreground">
                    {delivery.receiver?.full_name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {delivery.product_temperature !== null ? (
                      <span className={cn('flex items-center gap-1 text-[13px] tabular-nums', tempColor(delivery.product_temperature))}>
                        <Thermometer className="h-3.5 w-3.5" />
                        {delivery.product_temperature}°C
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {delivery.delivery_photos.length > 0 ? (
                      <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
                        <Camera className="h-3.5 w-3.5" />
                        {delivery.delivery_photos.length}
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-[13px] text-muted-foreground truncate">
                    {delivery.notes ?? '—'}
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
