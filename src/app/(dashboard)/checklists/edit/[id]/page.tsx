'use client'

import { use, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  USER_ROLES,
  ROLE_LABELS,
  CHECKLIST_FREQUENCIES,
  CHECKLIST_ITEM_TYPES,
} from '@/lib/constants'

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  four_weekly: 'Four Weekly',
  custom: 'Custom',
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  tick: 'Tick / Check',
  temperature: 'Temperature',
  text: 'Free Text',
  yes_no: 'Yes / No',
  photo: 'Photo',
}

const itemSchema = z.object({
  name: z.string().min(1, 'Item name is required'),
  item_type: z.enum(['tick', 'temperature', 'text', 'yes_no', 'photo']),
  required: z.boolean(),
  min_value: z.number().nullable().optional(),
  max_value: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
})

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'four_weekly', 'custom']),
  assigned_roles: z.array(z.string()).min(1, 'Select at least one role'),
  supervisor_role: z.string().optional(),
  deadline_time: z.string().optional(),
  items: z.array(itemSchema).min(1, 'Add at least one item'),
})

type FormValues = z.infer<typeof formSchema>

const defaultItem: FormValues['items'][number] = {
  name: '',
  item_type: 'tick',
  required: true,
  min_value: null,
  max_value: null,
  unit: null,
}

export default function EditChecklistPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const queryClient = useQueryClient()
  const { business } = useAuthStore()

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      name: '',
      description: '',
      frequency: 'daily',
      assigned_roles: [],
      supervisor_role: '',
      deadline_time: '',
      items: [{ ...defaultItem }],
    },
  })

  const { fields, append, remove, swap } = useFieldArray({
    control,
    name: 'items',
  })

  const watchedItems = watch('items')
  const watchedRoles = watch('assigned_roles')

  const toggleRole = (role: string) => {
    const current = watchedRoles ?? []
    if (current.includes(role)) {
      setValue(
        'assigned_roles',
        current.filter((r) => r !== role),
        { shouldValidate: true }
      )
    } else {
      setValue('assigned_roles', [...current, role], { shouldValidate: true })
    }
  }

  const { data: template, isLoading } = useQuery({
    queryKey: ['checklist-template', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklist_templates')
        .select('*, checklist_template_items(*)')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  useEffect(() => {
    if (!template) return

    const items = (
      template.checklist_template_items as Array<{
        name: string
        item_type: string
        required: boolean
        sort_order: number
        min_value: number | null
        max_value: number | null
        unit: string | null
      }>
    )
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        name: item.name,
        item_type: item.item_type as FormValues['items'][number]['item_type'],
        required: item.required,
        min_value: item.min_value,
        max_value: item.max_value,
        unit: item.unit,
      }))

    reset({
      name: template.name,
      description: template.description ?? '',
      frequency: template.frequency as FormValues['frequency'],
      assigned_roles: template.assigned_roles,
      supervisor_role: template.supervisor_role ?? '',
      deadline_time: template.deadline_time ?? '',
      items: items.length > 0 ? items : [{ ...defaultItem }],
    })
  }, [template, reset])

  const updateMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!business?.id) throw new Error('No business found')

      const { error: templateError } = await supabase
        .from('checklist_templates')
        .update({
          name: values.name,
          description: values.description || null,
          frequency: values.frequency,
          assigned_roles: values.assigned_roles,
          supervisor_role: values.supervisor_role || null,
          deadline_time: values.deadline_time || null,
        })
        .eq('id', id)

      if (templateError) throw templateError

      // Delete existing items and re-insert
      const { error: deleteError } = await supabase
        .from('checklist_template_items')
        .delete()
        .eq('template_id', id)

      if (deleteError) throw deleteError

      const items = values.items.map((item, index) => ({
        template_id: id,
        name: item.name,
        item_type: item.item_type,
        required: item.required,
        sort_order: index,
        min_value:
          item.item_type === 'temperature' ? (item.min_value ?? null) : null,
        max_value:
          item.item_type === 'temperature' ? (item.max_value ?? null) : null,
        unit:
          item.item_type === 'temperature' ? (item.unit || null) : null,
      }))

      const { error: itemsError } = await supabase
        .from('checklist_template_items')
        .insert(items)

      if (itemsError) throw itemsError
    },
    onSuccess: () => {
      toast.success('Checklist template updated')
      queryClient.invalidateQueries({ queryKey: ['checklist-templates'] })
      queryClient.invalidateQueries({ queryKey: ['checklist-template', id] })
      router.push('/checklists')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update checklist')
    },
  })

  const onSubmit = (values: FormValues) => {
    updateMutation.mutate(values)
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/checklists"
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Checklists
        </Link>
        <PageHeader
          title="Edit Checklist Template"
          description="Update the checklist template and its items"
        />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Basic details */}
        <div className="rounded-lg border border-border bg-white p-5 space-y-4">
          <h2 className="text-[13px] font-semibold text-foreground">Details</h2>

          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-[13px]">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              placeholder="e.g. Opening Checks"
              className="text-[13px]"
              {...register('name')}
            />
            {errors.name && (
              <p className="text-[12px] text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-[13px]">
              Description
            </Label>
            <Textarea
              id="description"
              placeholder="Optional description of this checklist..."
              className="text-[13px]"
              {...register('description')}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-[13px]">
                Frequency <span className="text-destructive">*</span>
              </Label>
              <Select
                value={watch('frequency')}
                onValueChange={(val) =>
                  setValue('frequency', val as FormValues['frequency'], {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger className="w-full text-[13px]">
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  {CHECKLIST_FREQUENCIES.map((freq) => (
                    <SelectItem key={freq} value={freq}>
                      {FREQUENCY_LABELS[freq]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px]">Supervisor Role</Label>
              <Select
                value={watch('supervisor_role') ?? ''}
                onValueChange={(val) =>
                  setValue('supervisor_role', val === '__none__' ? '' : (val ?? ''))
                }
              >
                <SelectTrigger className="w-full text-[13px]">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {USER_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="deadline_time" className="text-[13px]">
                Deadline Time
              </Label>
              <Input
                id="deadline_time"
                type="time"
                className="text-[13px]"
                {...register('deadline_time')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">
              Assigned Roles <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-3">
              {USER_ROLES.map((role) => (
                <label
                  key={role}
                  className="flex items-center gap-2 cursor-pointer text-[13px]"
                >
                  <Checkbox
                    checked={watchedRoles?.includes(role)}
                    onCheckedChange={() => toggleRole(role)}
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </div>
            {errors.assigned_roles && (
              <p className="text-[12px] text-destructive">
                {errors.assigned_roles.message}
              </p>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="rounded-lg border border-border bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-foreground">
              Checklist Items
            </h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ ...defaultItem })}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Item
            </Button>
          </div>

          {errors.items?.root && (
            <p className="text-[12px] text-destructive">
              {errors.items.root.message}
            </p>
          )}

          <div className="space-y-3">
            {fields.map((field, index) => {
              const itemType = watchedItems?.[index]?.item_type
              return (
                <div
                  key={field.id}
                  className="rounded-md border border-border p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-gray-100 text-[11px] font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => swap(index, index - 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={index === fields.length - 1}
                        onClick={() => swap(index, index + 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => fields.length > 1 && remove(index)}
                        disabled={fields.length <= 1}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-5 space-y-1.5">
                      <Label className="text-[12px] text-muted-foreground">
                        Item Name
                      </Label>
                      <Input
                        placeholder="e.g. Fridge temperature"
                        className="text-[13px]"
                        {...register(`items.${index}.name`)}
                      />
                      {errors.items?.[index]?.name && (
                        <p className="text-[12px] text-destructive">
                          {errors.items[index].name?.message}
                        </p>
                      )}
                    </div>

                    <div className="sm:col-span-4 space-y-1.5">
                      <Label className="text-[12px] text-muted-foreground">
                        Type
                      </Label>
                      <Select
                        value={watchedItems?.[index]?.item_type ?? 'tick'}
                        onValueChange={(val) =>
                          setValue(
                            `items.${index}.item_type`,
                            val as FormValues['items'][number]['item_type'],
                            { shouldValidate: true }
                          )
                        }
                      >
                        <SelectTrigger className="w-full text-[13px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CHECKLIST_ITEM_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {ITEM_TYPE_LABELS[type]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="sm:col-span-3 flex items-end pb-1">
                      <label className="flex items-center gap-2 cursor-pointer text-[13px]">
                        <Checkbox
                          checked={watchedItems?.[index]?.required ?? true}
                          onCheckedChange={(checked) =>
                            setValue(`items.${index}.required`, !!checked)
                          }
                        />
                        Required
                      </label>
                    </div>
                  </div>

                  {itemType === 'temperature' && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-[12px] text-muted-foreground">
                          Min Value
                        </Label>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="e.g. 0"
                          className="text-[13px]"
                          {...register(`items.${index}.min_value`, {
                            setValueAs: (v) =>
                              v === '' || v === undefined ? null : Number(v),
                          })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[12px] text-muted-foreground">
                          Max Value
                        </Label>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="e.g. 8"
                          className="text-[13px]"
                          {...register(`items.${index}.max_value`, {
                            setValueAs: (v) =>
                              v === '' || v === undefined ? null : Number(v),
                          })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[12px] text-muted-foreground">
                          Unit
                        </Label>
                        <Input
                          placeholder="°C"
                          className="text-[13px]"
                          {...register(`items.${index}.unit`)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push('/checklists')}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
