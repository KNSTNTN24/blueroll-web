'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  Store,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Tables } from '@/types/database'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function SuppliersPage() {
  const { profile, business } = useAuthStore()
  const queryClient = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [showDialog, setShowDialog] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Tables<'suppliers'> | null>(null)

  const [name, setName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [goodsSupplied, setGoodsSupplied] = useState('')
  const [deliveryDays, setDeliveryDays] = useState<string[]>([])

  const { data: suppliers, isLoading } = useQuery({
    queryKey: ['suppliers', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('suppliers')
        .select('*')
        .eq('business_id', business!.id)
        .order('name')
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingSupplier) {
        const { error } = await supabase
          .from('suppliers')
          .update({
            name,
            contact_name: contactName || null,
            phone: phone || null,
            address: address || null,
            goods_supplied: goodsSupplied || null,
            delivery_days: deliveryDays,
          })
          .eq('id', editingSupplier.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('suppliers').insert({
          name,
          contact_name: contactName || null,
          phone: phone || null,
          address: address || null,
          goods_supplied: goodsSupplied || null,
          delivery_days: deliveryDays,
          business_id: business!.id,
        })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      toast.success(editingSupplier ? 'Supplier updated' : 'Supplier added')
      closeDialog()
    },
    onError: (err) => toast.error(err.message),
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
    onError: (err) => toast.error(err.message),
  })

  const openNew = () => {
    setEditingSupplier(null)
    setName('')
    setContactName('')
    setPhone('')
    setAddress('')
    setGoodsSupplied('')
    setDeliveryDays([])
    setShowDialog(true)
  }

  const openEdit = (supplier: Tables<'suppliers'>) => {
    setEditingSupplier(supplier)
    setName(supplier.name)
    setContactName(supplier.contact_name ?? '')
    setPhone(supplier.phone ?? '')
    setAddress(supplier.address ?? '')
    setGoodsSupplied(supplier.goods_supplied ?? '')
    setDeliveryDays(supplier.delivery_days ?? [])
    setShowDialog(true)
  }

  const closeDialog = () => {
    setShowDialog(false)
    setEditingSupplier(null)
  }

  const toggleDay = (day: string) => {
    setDeliveryDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
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
        title="Suppliers"
        description="Manage your approved supplier list"
      >
        {isManager && (
          <Button
            onClick={openNew}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Supplier
          </Button>
        )}
      </PageHeader>

      {!suppliers || suppliers.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No suppliers"
          description="Add your first approved supplier to track deliveries and compliance."
          action={isManager ? { label: 'Add Supplier', onClick: openNew } : undefined}
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
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Goods Supplied</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Delivery Days</th>
                {isManager && (
                  <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="transition-colors hover:bg-accent/50">
                  <td className="px-4 py-3 text-[13px] font-medium">{supplier.name}</td>
                  <td className="px-4 py-3 text-[13px] text-muted-foreground">
                    {supplier.contact_name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-muted-foreground">
                    {supplier.phone ?? '—'}
                  </td>
                  <td className="max-w-[200px] px-4 py-3 text-[13px] text-muted-foreground truncate">
                    {supplier.address ?? '—'}
                  </td>
                  <td className="max-w-[200px] px-4 py-3 text-[13px] text-muted-foreground truncate">
                    {supplier.goods_supplied ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {supplier.delivery_days.length > 0 ? (
                        supplier.delivery_days.map((day) => (
                          <span
                            key={day}
                            className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {day}
                          </span>
                        ))
                      ) : (
                        <span className="text-[13px] text-muted-foreground">—</span>
                      )}
                    </div>
                  </td>
                  {isManager && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger>
                            <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(supplier)}>
                              <Pencil className="mr-2 h-3.5 w-3.5" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => deleteMutation.mutate(supplier.id)}
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Supplier Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSupplier ? 'Edit Supplier' : 'Add Supplier'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Supplier name"
                className="text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Contact Name</Label>
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Contact person"
                className="text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Phone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone number"
                className="text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Address</Label>
              <Textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Supplier address"
                className="min-h-[60px] text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Goods Supplied</Label>
              <Input
                value={goodsSupplied}
                onChange={(e) => setGoodsSupplied(e.target.value)}
                placeholder="e.g. Fresh produce, dairy"
                className="text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Delivery Days</Label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors',
                      deliveryDays.includes(day)
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-gray-200 hover:bg-accent'
                    )}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!name.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {editingSupplier ? 'Save' : 'Add Supplier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
