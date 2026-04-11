'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Loader2, GripVertical, Sparkles, ArrowRight, Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { CHECKLIST_FREQUENCIES, CHECKLIST_ITEM_TYPES, CHECKLIST_TYPES, DEFAULT_EQUIPMENT, USER_ROLES, ROLE_LABELS, type UserRole } from '@/lib/constants'

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
  const queryClient = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const [submitting, setSubmitting] = useState(false)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardData, setWizardData] = useState({
    checklistType: '',
    equipment: [] as string[],
    customEquipmentInput: '',
    assignedRoles: ['owner', 'manager'] as string[],
    supervisorSignOff: false,
    supervisorRole: '',
    additionalNotes: '',
  })

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

  const { fields, append, remove, move, replace } = useFieldArray({
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

  function buildPrompt(): string {
    const parts: string[] = []
    const typeLabel = CHECKLIST_TYPES.find((t) => t.id === wizardData.checklistType)?.label ?? wizardData.checklistType
    parts.push(`Create a ${typeLabel} checklist.`)

    if (wizardData.equipment.length > 0) {
      parts.push(`Equipment in the kitchen: ${wizardData.equipment.join(', ')}.`)
      parts.push('Include temperature checks for all fridges and freezers listed.')
    }

    if (wizardData.assignedRoles.length > 0) {
      const labels = wizardData.assignedRoles.map((r) => ROLE_LABELS[r as UserRole] ?? r)
      parts.push(`This checklist will be filled by: ${labels.join(', ')}.`)
    }

    if (wizardData.supervisorSignOff && wizardData.supervisorRole) {
      parts.push(`Requires supervisor sign-off by ${ROLE_LABELS[wizardData.supervisorRole as UserRole] ?? wizardData.supervisorRole}.`)
    }

    if (wizardData.additionalNotes.trim()) {
      parts.push(`Additional requirements: ${wizardData.additionalNotes.trim()}`)
    }

    return parts.join('\n')
  }

  async function handleAiGenerate() {
    if (!wizardData.checklistType) {
      toast.error('Please select a checklist type')
      return
    }
    setAiGenerating(true)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 45000)

      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
      const fnUrl = `${baseUrl}/functions/v1/ai-generate-checklist`

      const resp = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({
          prompt: buildPrompt(),
          business_name: business?.name,
          business_type: null,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!resp.ok) {
        const errText = await resp.text()
        throw new Error(errText || `HTTP ${resp.status}`)
      }

      const result = await resp.json()
      const checklist = typeof result === 'string' ? JSON.parse(result) : result

      // Fill form with AI-generated data
      if (checklist.name) setValue('name', checklist.name)
      if (checklist.description) setValue('description', checklist.description)
      if (checklist.frequency) setValue('frequency', checklist.frequency)
      if (checklist.supervisor_role) setValue('supervisor_role', checklist.supervisor_role)
      if (checklist.assigned_roles?.length) setValue('assigned_roles', checklist.assigned_roles)

      // Replace all items at once (avoids re-render loop)
      if (checklist.items?.length) {
        replace(
          checklist.items.map((item: any) => ({
            name: item.name ?? '',
            item_type: item.item_type ?? 'tick',
            required: item.required ?? true,
            min_value: item.min_value ?? null,
            max_value: item.max_value ?? null,
            unit: item.unit ?? null,
          })),
        )
      }

      toast.success(`Generated "${checklist.name}" with ${checklist.items?.length ?? 0} items`)
      setWizardOpen(false)
      setWizardStep(1)

      // Offer to save new equipment to business profile
      const bizEquipment = business?.equipment ?? []
      const newItems = wizardData.equipment.filter((e) => !bizEquipment.includes(e))
      if (newItems.length > 0 && business?.id) {
        toast('New equipment detected', {
          description: `Save ${newItems.join(', ')} to your business profile?`,
          action: {
            label: 'Save',
            onClick: async () => {
              const merged = [...new Set([...bizEquipment, ...newItems])]
              await supabase.from('businesses').update({ equipment: merged }).eq('id', business.id)
              useAuthStore.getState().setBusiness({ ...business, equipment: merged })
              toast.success('Equipment saved to profile')
            },
          },
        })
      }
    } catch (err: any) {
      console.error('[AI Generate] Error:', err)
      const msg = err?.name === 'AbortError' ? 'Request timed out (45s). Try again.' : (err?.message ?? 'Failed to generate checklist')
      toast.error(msg)
    } finally {
      setAiGenerating(false)
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
      queryClient.invalidateQueries({ queryKey: ['all-checklists'] })
      queryClient.invalidateQueries({ queryKey: ['my-checklists'] })
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

      {/* AI Wizard */}
      {!wizardOpen ? (
        <button
          type="button"
          onClick={() => {
            setWizardData((d) => ({ ...d, equipment: business?.equipment ?? [] }))
            setWizardStep(1)
            setWizardOpen(true)
          }}
          className="flex w-full items-center gap-3 rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50 px-4 py-3 text-left transition-colors hover:bg-emerald-50"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
            <Sparkles className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <div className="text-[13px] font-medium text-emerald-800">Generate with AI</div>
            <div className="text-[11px] text-emerald-600">Answer a few questions and AI will create a complete checklist</div>
          </div>
        </button>
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-5 space-y-4">
          {/* Step indicator */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              <span className="text-[13px] font-medium text-emerald-800">AI Checklist Generator</span>
            </div>
            <span className="text-[11px] text-muted-foreground">Step {wizardStep} of 4</span>
          </div>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={cn('h-1 flex-1 rounded-full', s <= wizardStep ? 'bg-emerald-500' : 'bg-gray-200')} />
            ))}
          </div>

          {/* Step 1: Type */}
          {wizardStep === 1 && (
            <div className="space-y-2">
              <p className="text-[13px] font-medium text-foreground">What type of checklist?</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CHECKLIST_TYPES.map((t) => {
                  const selected = wizardData.checklistType === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setWizardData((d) => ({ ...d, checklistType: t.id }))}
                      className={cn(
                        'relative rounded-lg border p-3 text-left transition-colors',
                        selected ? 'border-emerald-400 bg-emerald-50' : 'border-border bg-white hover:border-emerald-200',
                      )}
                    >
                      {selected && <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-emerald-600" />}
                      <div className="text-[16px] mb-1">{t.icon}</div>
                      <div className="text-[12px] font-medium text-foreground">{t.label}</div>
                      <div className="text-[10px] text-muted-foreground">{t.description}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Step 2: Equipment */}
          {wizardStep === 2 && (
            <div className="space-y-3">
              <p className="text-[13px] font-medium text-foreground">What equipment is in your kitchen?</p>
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                {[...DEFAULT_EQUIPMENT, ...wizardData.equipment.filter((e) => !(DEFAULT_EQUIPMENT as readonly string[]).includes(e))].map((item) => {
                  const selected = wizardData.equipment.includes(item)
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setWizardData((d) => ({
                        ...d,
                        equipment: selected ? d.equipment.filter((e) => e !== item) : [...d.equipment, item],
                      }))}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors',
                        selected ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-white text-muted-foreground border-border hover:border-emerald-200',
                      )}
                    >
                      {item}
                    </button>
                  )
                })}
              </div>
              <div className="flex gap-2">
                <input
                  value={wizardData.customEquipmentInput}
                  onChange={(e) => setWizardData((d) => ({ ...d, customEquipmentInput: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const v = wizardData.customEquipmentInput.trim()
                      if (v && !wizardData.equipment.includes(v)) {
                        setWizardData((d) => ({ ...d, equipment: [...d.equipment, v], customEquipmentInput: '' }))
                      }
                    }
                  }}
                  placeholder="Add custom..."
                  className="flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-[12px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const v = wizardData.customEquipmentInput.trim()
                    if (v && !wizardData.equipment.includes(v)) {
                      setWizardData((d) => ({ ...d, equipment: [...d.equipment, v], customEquipmentInput: '' }))
                    }
                  }}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Team */}
          {wizardStep === 3 && (
            <div className="space-y-3">
              <p className="text-[13px] font-medium text-foreground">Who will fill this checklist?</p>
              <div className="flex flex-wrap gap-1.5">
                {USER_ROLES.map((role) => {
                  const selected = wizardData.assignedRoles.includes(role)
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setWizardData((d) => ({
                        ...d,
                        assignedRoles: selected ? d.assignedRoles.filter((r) => r !== role) : [...d.assignedRoles, role],
                      }))}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors',
                        selected ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-white text-muted-foreground border-border hover:border-emerald-200',
                      )}
                    >
                      {ROLE_LABELS[role]}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wizardData.supervisorSignOff}
                    onChange={(e) => setWizardData((d) => ({ ...d, supervisorSignOff: e.target.checked }))}
                    className="h-4 w-4 rounded border-border accent-emerald-600"
                  />
                  <span className="text-[12px] text-foreground">Requires supervisor sign-off</span>
                </label>
                {wizardData.supervisorSignOff && (
                  <select
                    value={wizardData.supervisorRole}
                    onChange={(e) => setWizardData((d) => ({ ...d, supervisorRole: e.target.value }))}
                    className="rounded-md border border-border bg-white px-2 py-1 text-[12px] focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="">Select role</option>
                    {USER_ROLES.filter((r) => r === 'owner' || r === 'manager').map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Notes */}
          {wizardStep === 4 && (
            <div className="space-y-2">
              <p className="text-[13px] font-medium text-foreground">Anything specific to include?</p>
              <textarea
                value={wizardData.additionalNotes}
                onChange={(e) => setWizardData((d) => ({ ...d, additionalNotes: e.target.value }))}
                placeholder="e.g. We serve raw fish, have an outdoor terrace, use colour-coded chopping boards..."
                rows={3}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] text-foreground outline-none resize-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center gap-2 pt-1">
            {wizardStep > 1 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setWizardStep((s) => s - 1)}>
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            )}
            {wizardStep < 4 ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setWizardStep((s) => s + 1)}
                disabled={wizardStep === 1 && !wizardData.checklistType}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={handleAiGenerate}
                disabled={aiGenerating}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              >
                {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {aiGenerating ? 'Generating...' : 'Generate checklist'}
              </Button>
            )}
            {aiGenerating && (
              <span className="text-[11px] text-muted-foreground">AI is thinking — 15–20 seconds</span>
            )}
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setWizardOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

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
