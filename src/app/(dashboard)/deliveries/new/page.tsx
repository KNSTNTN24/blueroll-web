'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'

export default function NewDeliveryPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const router = useRouter()

  const [supplierId, setSupplierId] = useState('')
  const [deliveredAt, setDeliveredAt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
  const [temperature, setTemperature] = useState('')
  const [notes, setNotes] = useState('')

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('business_id', business.id)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const mutation = useMutation({
    mutationFn: async () => {
      if (!business?.id || !profile?.id) throw new Error('No business')
      if (!supplierId) throw new Error('Select a supplier')

      const { error } = await supabase.from('deliveries').insert({
        business_id: business.id,
        supplier_id: supplierId,
        received_by: profile.id,
        delivered_at: new Date(deliveredAt).toISOString(),
        product_temperature: temperature ? parseFloat(temperature) : null,
        notes: notes || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Delivery recorded')
      router.push('/deliveries')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="space-y-6">
      <PageHeader title="New Delivery" description="Record an incoming delivery">
        <Button variant="outline" size="sm" onClick={() => router.push('/deliveries')}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      </PageHeader>

      <div className="max-w-lg">
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate() }} className="space-y-4">
          <div className="rounded-lg border border-border bg-white p-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Supplier</label>
              <select
                required
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value ?? '')}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">Select a supplier</option>
                {suppliers.map((s: { id: string; name: string }) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Date and time</label>
              <input
                type="datetime-local"
                required
                value={deliveredAt}
                onChange={(e) => setDeliveredAt(e.target.value)}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Temperature (°C)</label>
              <input
                type="number"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] text-foreground tabular-nums focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="e.g. 3.5"
              />
              <p className="text-[12px] text-muted-foreground">Leave empty if not applicable</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Any notes about the delivery..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" type="button" onClick={() => router.push('/deliveries')}>
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Record delivery'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
