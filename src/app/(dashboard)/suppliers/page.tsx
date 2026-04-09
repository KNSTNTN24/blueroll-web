'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Store, Plus, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Supplier {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  address: string | null
  goods_supplied: string | null
  delivery_days: string[] | null
  business_id: string
  created_at: string
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function DayToggles({ selected, onChange }: { selected: string[]; onChange: (days: string[]) => void }) {
  return (
    <div className="flex gap-1">
      {DAYS.map((d) => {
        const active = selected.includes(d)
        return (
          <button
            key={d}
            type="button"
            onClick={() => onChange(active ? selected.filter((x) => x !== d) : [...selected, d])}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium border transition-colors',
              active
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white text-muted-foreground border-border hover:border-emerald-200'
            )}
          >
            {d}
          </button>
        )
      })}
    </div>
  )
}

export default function SuppliersPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const queryClient = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)

  // Form state
  const [fName, setFName] = useState('')
  const [fContact, setFContact] = useState('')
  const [fPhone, setFPhone] = useState('')
  const [fAddress, setFAddress] = useState('')
  const [fGoods, setFGoods] = useState('')
  const [fDays, setFDays] = useState<string[]>([])

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['suppliers', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('business_id', business.id)
        .order('name')
      if (error) throw error
      return (data ?? []) as Supplier[]
    },
    enabled: !!business?.id,
  })

  function openCreate() {
    setEditing(null)
    setFName('')
    setFContact('')
    setFPhone('')
    setFAddress('')
    setFGoods('')
    setFDays([])
    setShowDialog(true)
  }

  function openEdit(s: Supplier) {
    setEditing(s)
    setFName(s.name)
    setFContact(s.contact_name ?? '')
    setFPhone(s.phone ?? '')
    setFAddress(s.address ?? '')
    setFGoods(s.goods_supplied ?? '')
    setFDays(s.delivery_days ?? [])
    setShowDialog(true)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!business?.id) throw new Error('No business')
      const payload = {
        name: fName,
        contact_name: fContact || null,
        phone: fPhone || null,
        address: fAddress || null,
        goods_supplied: fGoods || null,
        delivery_days: fDays.length > 0 ? fDays : null,
        business_id: business.id,
      }
      if (editing) {
        const { error } = await supabase.from('suppliers').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('suppliers').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      toast.success(editing ? 'Supplier updated' : 'Supplier added')
      setShowDialog(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('suppliers').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      toast.success('Supplier deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Suppliers" description="Manage your suppliers" />
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Suppliers" description="Manage your suppliers">
        {isManager && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            Add supplier
          </Button>
        )}
      </PageHeader>

      {/* Create / Edit Dialog */}
      {showDialog && (
        <div className="rounded-lg border border-border bg-white p-4">
          <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate() }} className="space-y-4">
            <h3 className="text-[14px] font-medium text-foreground">
              {editing ? 'Edit supplier' : 'Add supplier'}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-foreground">Name</label>
                <input
                  required
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Supplier name"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-foreground">Contact name</label>
                <input
                  value={fContact}
                  onChange={(e) => setFContact(e.target.value)}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Contact person"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-foreground">Phone</label>
                <input
                  value={fPhone}
                  onChange={(e) => setFPhone(e.target.value)}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Phone number"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-foreground">Goods supplied</label>
                <input
                  value={fGoods}
                  onChange={(e) => setFGoods(e.target.value)}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="e.g. Fresh produce, dairy"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Address</label>
              <input
                value={fAddress}
                onChange={(e) => setFAddress(e.target.value)}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Full address"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Delivery days</label>
              <DayToggles selected={fDays} onChange={setFDays} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" type="button" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button size="sm" type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving...' : editing ? 'Update' : 'Add'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {suppliers.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No suppliers"
          description="Add your first supplier to start tracking deliveries."
          action={isManager ? { label: 'Add supplier', onClick: openCreate } : undefined}
        />
      ) : (
        <div className="rounded-lg border border-border bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Contact</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Phone</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Address</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Goods</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Delivery days</th>
                {isManager && (
                  <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-accent/50">
                  <td className="px-4 py-2.5 text-[13px] font-medium text-foreground">{s.name}</td>
                  <td className="px-4 py-2.5 text-[13px] text-muted-foreground">{s.contact_name || '-'}</td>
                  <td className="px-4 py-2.5 text-[13px] text-muted-foreground">{s.phone || '-'}</td>
                  <td className="max-w-[200px] truncate px-4 py-2.5 text-[13px] text-muted-foreground">{s.address || '-'}</td>
                  <td className="max-w-[150px] truncate px-4 py-2.5 text-[13px] text-muted-foreground">{s.goods_supplied || '-'}</td>
                  <td className="px-4 py-2.5">
                    {s.delivery_days && s.delivery_days.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {s.delivery_days.map((d) => (
                          <span key={d} className="rounded border border-border bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {d}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">-</span>
                    )}
                  </td>
                  {isManager && (
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(s)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => { if (confirm('Delete this supplier?')) deleteMutation.mutate(s.id) }}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
