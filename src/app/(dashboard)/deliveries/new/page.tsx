'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { toast } from 'sonner'

export default function NewDeliveryPage() {
  const { profile, business } = useAuthStore()
  const router = useRouter()

  const [supplierId, setSupplierId] = useState('')
  const [receivedAt, setReceivedAt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
  const [productTemperature, setProductTemperature] = useState('')
  const [notes, setNotes] = useState('')

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('business_id', business!.id)
        .order('name')
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const temp = productTemperature.trim() ? parseFloat(productTemperature) : null
      const { error } = await supabase.from('deliveries').insert({
        supplier_id: supplierId || null,
        received_by: profile!.id,
        received_at: new Date(receivedAt).toISOString(),
        product_temperature: temp,
        notes: notes.trim() || null,
        business_id: business!.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Delivery recorded')
      router.push('/deliveries')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/deliveries"
          className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Deliveries
        </Link>
        <PageHeader
          title="Record Delivery"
          description="Log a new goods-in delivery"
        />
      </div>

      <div className="max-w-lg rounded-lg border border-border bg-white p-6">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[13px]">Supplier</Label>
            <Select value={supplierId} onValueChange={(val) => setSupplierId(val ?? '')}>
              <SelectTrigger>
                <SelectValue placeholder="Select supplier..." />
              </SelectTrigger>
              <SelectContent>
                {suppliers?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">Received at</Label>
            <Input
              type="datetime-local"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">Product Temperature (°C)</Label>
            <Input
              type="number"
              step="0.1"
              value={productTemperature}
              onChange={(e) => setProductTemperature(e.target.value)}
              placeholder="e.g. 3.5"
              className="w-32 tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about the delivery..."
              className="min-h-[80px] text-[13px]"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/deliveries')}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Record Delivery
          </Button>
        </div>
      </div>
    </div>
  )
}
