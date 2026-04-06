'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Loader2, GripVertical,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { CHECKLIST_FREQUENCIES, CHECKLIST_ITEM_TYPES, USER_ROLES, ROLE_LABELS, type UserRole } from '@/lib/constants'

const itemSchema = z.object({
  name: z.string().min(1, 'Item name is required'),
  item_type: z.string().min(1),
  required: z.boolean(),
  min_value: z.union([z.number(), z.nan()]).optional().nullable(),
  max_value: z.union([z.number(), z.nan()]).optional().nullable(),
  unit: z.string().optional().nullable(),
})

const templateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  frequency: z.string().min(1, 'Frequency is required'),
  assigned_roles: z.array(z.string()).min(1, 'At least one role is required'),
  supervisor_role: z.string().optional().nullable(),
  deadline_time: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1, 'At least one item is required'),
})

type FormData = z.infer<typeof templateSchema>

const ITEM_TYPE_LABELS: Record<string, string> = {
  tick: 'Checkbox',
  temperature: 'Temperature',
  text: 'Text',
  yes_no: 'Yes / No',
  photo: 'Photo',
}

export default function NewChecklistPage() {
  const router = useRouter()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(templateSchema) as any,
    defaultValues: {
      name: '',
      description: '',
      frequency: 'daily',
      assigned_roles: ['owner', 'manager'],
      supervisor_role: null,
      deadline_time: null,
      items: [
        { name: '', item_type: 'tick', required: true, min_value: null, max_value: null, unit: null },
      ],
    },
  })

  const { fields, append, remove, move } = useFieldArray({
    control,
    name: 'items',
  })

  const watchedItems = watch('items')
  const watchedRoles = watch('assigned_roles')

  function handleRoleToggle(role: string) {
    const current = watchedRoles ?? []
    if (current.includes(role)) {
      setValue('assigned_roles', current.filter((r) => r !== role))
    } else {
      setValue('assigned_roles', [...current, role])
    }
  }

  async function onSubmit(data: FormData) {
    if (!business?.id) return
    setSubmitting(true)

    try {
      const { items, ...templateData } = data
      const { data: tmpl, error: tErr } = await supabase
        .from('checklist_templates')
        .insert({
          ...templateData,
          business_id: business.id,
          active: true,
          supervisor_role: data.supervisor_role || null,
          deadline_time: data.deadline_time || null,
        })
        .select('id')
        .single()

      if (tErr) throw tErr

      const itemRows = items.map((item, idx) => ({
        template_id: tmpl.id,
        name: item.name,
        item_type: item.item_type,
        required: item.required,
        sort_order: idx,
        min_value: item.item_type === 'temperature' && item.min_value != null && !isNaN(item.min_value) ? item.min_value : null,
        max_value: item.item_type === 'temperature' && item.max_value != null && !isNaN(item.max_value) ? item.max_value : null,
        unit: item.item_type === 'temperature' ? (item.unit || '°C') : null,
      }))

      const { error: iErr } = await supabase.from('checklist_template_items').insert(itemRows)
      if (iErr) throw iErr

      toast.success('Template created')
      router.push('/checklists')
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create template')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 h-7 w-7 p-0"
          onClick={() => router.push('/checklists')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            New Checklist Template
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Create a new checklist for your team
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic info */}
        <div className="rounded-lg border border-border bg-white p-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              {...register('name')}
              placeholder="e.g. Morning Opening Checks"
            />
            {errors.name && <p className="text-[12px] text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder="Brief description of this checklist"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="frequency">Frequency</Label>
              <select
                id="frequency"
                {...register('frequency')}
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                {CHECKLIST_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1).replace('_', ' ')}</option>
                ))}
              </select>
              {errors.frequency && <p className="text-[12px] text-destructive">{errors.frequency.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supervisor_role">Supervisor Role (optional)</Label>
              <select
                id="supervisor_role"
                {...register('supervisor_role')}
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <option value="">None</option>
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="deadline_time">Deadline Time (optional)</Label>
              <Input
                id="deadline_time"
                type="time"
                {...register('deadline_time')}
              />
            </div>
          </div>

          {/* Assigned roles */}
          <div className="space-y-1.5">
            <Label>Assigned Roles</Label>
            <div className="flex flex-wrap gap-2">
              {USER_ROLES.map((role) => (
                <label
                  key={role}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] cursor-pointer transition-colors',
                    watchedRoles?.includes(role)
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-border bg-white text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={watchedRoles?.includes(role) ?? false}
                    onChange={() => handleRoleToggle(role)}
                    className="sr-only"
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </div>
            {errors.assigned_roles && <p className="text-[12px] text-destructive">{errors.assigned_roles.message}</p>}
          </div>
        </div>

        {/* Items */}
        <div className="rounded-lg border border-border bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <Label>Checklist Items</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => append({ name: '', item_type: 'tick', required: true, min_value: null, max_value: null, unit: null })}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Item
            </Button>
          </div>

          {errors.items && typeof errors.items.message === 'string' && (
            <p className="text-[12px] text-destructive">{errors.items.message}</p>
          )}

          <div className="space-y-3">
            {fields.map((field, idx) => (
              <div key={field.id} className="rounded-lg border border-border p-3 space-y-3">
                <div className="flex items-start gap-2">
                  <span className="mt-2 text-[12px] font-medium text-muted-foreground tabular-nums w-5 text-center shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-2">
                      <Input
                        {...register(`items.${idx}.name`)}
                        placeholder="Item name"
                        className="flex-1"
                      />
                      <select
                        {...register(`items.${idx}.item_type`)}
                        className="h-9 rounded-md border border-border bg-white px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                      >
                        {CHECKLIST_ITEM_TYPES.map((t) => (
                          <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground shrink-0">
                        <input
                          type="checkbox"
                          {...register(`items.${idx}.required`)}
                          className="h-3.5 w-3.5 rounded border-border text-emerald-600 focus:ring-emerald-500"
                        />
                        Required
                      </label>
                    </div>

                    {/* Temperature range fields */}
                    {watchedItems?.[idx]?.item_type === 'temperature' && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step="0.1"
                          {...register(`items.${idx}.min_value`, { valueAsNumber: true })}
                          placeholder="Min"
                          className="w-24"
                        />
                        <span className="text-[12px] text-muted-foreground">to</span>
                        <Input
                          type="number"
                          step="0.1"
                          {...register(`items.${idx}.max_value`, { valueAsNumber: true })}
                          placeholder="Max"
                          className="w-24"
                        />
                        <Input
                          {...register(`items.${idx}.unit`)}
                          placeholder="°C"
                          className="w-20"
                        />
                      </div>
                    )}

                    {errors.items?.[idx]?.name && (
                      <p className="text-[12px] text-destructive">{errors.items[idx].name?.message}</p>
                    )}
                  </div>

                  {/* Move / Delete buttons */}
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={idx === 0}
                      onClick={() => move(idx, idx - 1)}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={idx === fields.length - 1}
                      onClick={() => move(idx, idx + 1)}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-red-500 hover:text-red-700"
                      disabled={fields.length === 1}
                      onClick={() => remove(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-white py-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push('/checklists')}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={submitting} className="gap-1.5">
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Template'
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
