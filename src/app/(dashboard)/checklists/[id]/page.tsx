'use client'

import { use, useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  ArrowLeft, CheckCircle2, AlertTriangle, Camera, Thermometer,
  CheckSquare, FileText, ThumbsUp, ThumbsDown, ShieldCheck, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/shared/status-badge'
import { cn } from '@/lib/utils'
import { notifyFlaggedItem, notifySignOffRequired } from '@/lib/notifications'
import { startOfDay, startOfWeek, startOfMonth, format } from 'date-fns'

function getPeriodStart(frequency: string): Date {
  const now = new Date()
  if (frequency === 'weekly') return startOfWeek(now, { weekStartsOn: 1 })
  if (frequency === 'monthly') return startOfMonth(now)
  if (frequency === 'four_weekly') {
    const d = startOfWeek(now, { weekStartsOn: 1 })
    d.setDate(d.getDate() - 21)
    return d
  }
  return startOfDay(now)
}

interface ItemResponse {
  value: string
  notes: string
  flagged: boolean
}

export default function ChecklistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const queryClient = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const [responses, setResponses] = useState<Record<string, ItemResponse>>({})
  const [submitting, setSubmitting] = useState(false)

  // ── Load template with items ──
  const { data: template, isLoading: loadingTemplate } = useQuery({
    queryKey: ['checklist-template', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklist_templates')
        .select('*, checklist_template_items(*)')
        .eq('id', id)
        .single()
      if (error) throw error
      // Sort items by sort_order
      if (data?.checklist_template_items) {
        data.checklist_template_items.sort((a: any, b: any) => a.sort_order - b.sort_order)
      }
      return data
    },
  })

  // ── Check for existing completion in current period ──
  const { data: existingCompletion } = useQuery({
    queryKey: ['existing-completion', id, business?.id],
    queryFn: async () => {
      if (!business?.id || !template) return null
      const periodStart = getPeriodStart(template.frequency)
      const { data, error } = await supabase
        .from('checklist_completions')
        .select('*, checklist_responses(*), completed_by_profile:profiles!checklist_completions_completed_by_fkey(full_name)')
        .eq('template_id', id)
        .eq('business_id', business.id)
        .gte('completed_at', periodStart.toISOString())
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!business?.id && !!template,
  })

  const isCompleted = !!existingCompletion
  const canSignOff = isCompleted && template?.supervisor_role && !existingCompletion?.signed_off_by && isManager

  function getResponse(itemId: string): ItemResponse {
    return responses[itemId] ?? { value: '', notes: '', flagged: false }
  }

  function setResponse(itemId: string, updates: Partial<ItemResponse>) {
    setResponses((prev) => ({
      ...prev,
      [itemId]: { ...getResponse(itemId), ...updates },
    }))
  }

  function checkAutoFlag(item: any, value: string): boolean {
    if (item.item_type === 'yes_no' && value === 'no') return true
    if (item.item_type === 'temperature' && value !== '') {
      const num = parseFloat(value)
      if (isNaN(num)) return false
      if (item.min_value != null && num < item.min_value) return true
      if (item.max_value != null && num > item.max_value) return true
    }
    return false
  }

  // ── Submit completion ──
  async function handleSubmit() {
    if (!template || !profile || !business) return
    setSubmitting(true)

    try {
      const items: any[] = template.checklist_template_items ?? []

      // Validate required items
      for (const item of items) {
        if (!item.required) continue
        const resp = getResponse(item.id)
        if (item.item_type === 'tick' && resp.value !== 'true') {
          toast.error(`"${item.name}" is required`)
          setSubmitting(false)
          return
        }
        if (item.item_type === 'temperature' && resp.value === '') {
          toast.error(`"${item.name}" is required`)
          setSubmitting(false)
          return
        }
        if (item.item_type === 'text' && resp.value.trim() === '') {
          toast.error(`"${item.name}" is required`)
          setSubmitting(false)
          return
        }
        if (item.item_type === 'yes_no' && resp.value === '') {
          toast.error(`"${item.name}" is required`)
          setSubmitting(false)
          return
        }
      }

      // Create completion
      const { data: completion, error: compError } = await supabase
        .from('checklist_completions')
        .insert({
          template_id: id,
          business_id: business.id,
          completed_by: profile.id,
          completed_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (compError) throw compError

      // Create responses
      const responseRows = items.map((item: any) => {
        const resp = getResponse(item.id)
        const flagged = checkAutoFlag(item, resp.value)
        return {
          completion_id: completion.id,
          item_id: item.id,
          value: resp.value,
          notes: resp.notes || null,
          flagged,
        }
      })

      const { error: respError } = await supabase
        .from('checklist_responses')
        .insert(responseRows)

      if (respError) throw respError

      // Send notifications for flagged items
      const flaggedItems = items.filter((item: any) => checkAutoFlag(item, getResponse(item.id).value))
      for (const item of flaggedItems) {
        await notifyFlaggedItem(business.id, template.name, item.name)
      }

      // Notify supervisor for sign-off
      if (template.supervisor_role) {
        await notifySignOffRequired(business.id, template.name, template.supervisor_role)
      }

      toast.success('Checklist submitted')
      queryClient.invalidateQueries({ queryKey: ['existing-completion', id] })
      queryClient.invalidateQueries({ queryKey: ['checklist-completions'] })
      queryClient.invalidateQueries({ queryKey: ['my-completions'] })
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to submit checklist')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Sign-off mutation ──
  const signOffMutation = useMutation({
    mutationFn: async () => {
      if (!existingCompletion?.id || !profile?.id) throw new Error('Missing data')
      const { error } = await supabase
        .from('checklist_completions')
        .update({
          signed_off_by: profile.id,
          signed_off_at: new Date().toISOString(),
        })
        .eq('id', existingCompletion.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Signed off')
      queryClient.invalidateQueries({ queryKey: ['existing-completion', id] })
    },
    onError: () => toast.error('Failed to sign off'),
  })

  // ── Photo upload (matches mobile: stores storage path in `value`) ──
  async function handlePhotoUpload(itemId: string, file: File) {
    if (!business?.id) return
    const storagePath = `${business.id}/checklist-photos/${Date.now()}_${file.name}`
    const { error } = await supabase.storage
      .from('documents')
      .upload(storagePath, file, { contentType: file.type || 'image/jpeg' })
    if (error) {
      toast.error('Failed to upload photo')
      return
    }
    setResponse(itemId, { value: storagePath })
    toast.success('Photo uploaded')
  }

  async function openPhoto(storagePath: string) {
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 3600)
    if (error || !data) {
      toast.error('Failed to open photo')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  if (loadingTemplate) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
      </div>
    )
  }

  if (!template) {
    return (
      <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">
        Checklist not found
      </div>
    )
  }

  const items: any[] = template.checklist_template_items ?? []

  // ── Get existing responses map for read-only mode ──
  const existingResponses = new Map<string, any>()
  if (existingCompletion?.checklist_responses) {
    for (const r of existingCompletion.checklist_responses) {
      existingResponses.set(r.item_id, r)
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
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {template.name}
            </h1>
            {isCompleted && (
              <StatusBadge
                status={existingCompletion.signed_off_by ? 'success' : template.supervisor_role ? 'warning' : 'success'}
                label={existingCompletion.signed_off_by ? 'Signed Off' : template.supervisor_role ? 'Awaiting Sign-off' : 'Completed'}
              />
            )}
          </div>
          {template.description && (
            <p className="mt-1 text-[13px] text-muted-foreground">{template.description}</p>
          )}
          {isCompleted && existingCompletion && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              Completed by {existingCompletion.completed_by_profile?.full_name ?? 'Unknown'} on{' '}
              {format(new Date(existingCompletion.completed_at), 'dd MMM yyyy HH:mm')}
            </p>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="space-y-3">
        {items.map((item: any) => {
          const existingResp = existingResponses.get(item.id)
          const readOnly = isCompleted

          return (
            <div
              key={item.id}
              className={cn(
                'rounded-lg border bg-white p-4',
                existingResp?.flagged ? 'border-red-200 bg-red-50/30' : 'border-border',
              )}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-foreground">{item.name}</span>
                    {item.required && (
                      <span className="text-[10px] font-medium text-red-500">Required</span>
                    )}
                  </div>
                  {item.item_type === 'temperature' && (item.min_value != null || item.max_value != null) && (
                    <p className="text-[12px] text-muted-foreground">
                      Range: {item.min_value ?? '—'} to {item.max_value ?? '—'} {item.unit ?? ''}
                    </p>
                  )}
                </div>
                {existingResp?.flagged && (
                  <div className="flex items-center gap-1 text-red-600">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">Flagged</span>
                  </div>
                )}
              </div>

              {/* ── Render by type ── */}
              {item.item_type === 'tick' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={readOnly ? existingResp?.value === 'true' : getResponse(item.id).value === 'true'}
                    onChange={(e) => setResponse(item.id, { value: e.target.checked ? 'true' : 'false' })}
                    className="h-4 w-4 rounded border-border text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-[13px] text-muted-foreground">Done</span>
                </label>
              )}

              {item.item_type === 'temperature' && (
                <div className="flex items-center gap-2">
                  <Thermometer className="h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="number"
                    step="0.1"
                    disabled={readOnly}
                    value={readOnly ? (existingResp?.value ?? '') : getResponse(item.id).value}
                    onChange={(e) => {
                      const val = e.target.value
                      const flagged = checkAutoFlag(item, val)
                      setResponse(item.id, { value: val, flagged })
                    }}
                    className={cn(
                      'w-32',
                      !readOnly && checkAutoFlag(item, getResponse(item.id).value) && 'border-red-300 bg-red-50',
                    )}
                    placeholder={item.unit ?? '°C'}
                  />
                  <span className="text-[12px] text-muted-foreground">{item.unit ?? '°C'}</span>
                  {!readOnly && checkAutoFlag(item, getResponse(item.id).value) && (
                    <span className="text-[12px] font-medium text-red-600">Out of range</span>
                  )}
                </div>
              )}

              {item.item_type === 'text' && (
                <Textarea
                  disabled={readOnly}
                  value={readOnly ? (existingResp?.value ?? '') : getResponse(item.id).value}
                  onChange={(e) => setResponse(item.id, { value: e.target.value })}
                  placeholder="Enter notes..."
                  rows={2}
                />
              )}

              {item.item_type === 'yes_no' && (
                <div className="flex items-center gap-2">
                  {readOnly ? (
                    <StatusBadge
                      status={existingResp?.value === 'yes' ? 'success' : existingResp?.value === 'no' ? 'error' : 'neutral'}
                      label={existingResp?.value === 'yes' ? 'Yes' : existingResp?.value === 'no' ? 'No' : 'N/A'}
                    />
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant={getResponse(item.id).value === 'yes' ? 'default' : 'outline'}
                        className={cn(
                          'gap-1.5',
                          getResponse(item.id).value === 'yes' && 'bg-emerald-600 hover:bg-emerald-700',
                        )}
                        onClick={() => setResponse(item.id, { value: 'yes', flagged: false })}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        Yes
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={getResponse(item.id).value === 'no' ? 'destructive' : 'outline'}
                        className="gap-1.5"
                        onClick={() => setResponse(item.id, { value: 'no', flagged: true })}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                        No
                      </Button>
                    </>
                  )}
                </div>
              )}

              {item.item_type === 'photo' && (
                <div>
                  {readOnly ? (
                    existingResp?.value ? (
                      <button
                        type="button"
                        onClick={() => openPhoto(existingResp.value)}
                        className="text-[13px] text-emerald-600 hover:underline"
                      >
                        View photo
                      </button>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">No photo uploaded</span>
                    )
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => fileInputRefs.current[item.id]?.click()}
                      >
                        <Camera className="h-3.5 w-3.5" />
                        Upload Photo
                      </Button>
                      <input
                        ref={(el) => { fileInputRefs.current[item.id] = el }}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handlePhotoUpload(item.id, file)
                        }}
                      />
                      {getResponse(item.id).value && (
                        <span className="text-[12px] text-emerald-600">Photo uploaded</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Notes for non-text items */}
              {item.item_type !== 'text' && !readOnly && (
                <div className="mt-2">
                  <Input
                    value={getResponse(item.id).notes}
                    onChange={(e) => setResponse(item.id, { notes: e.target.value })}
                    placeholder="Add notes (optional)"
                    className="text-[12px]"
                  />
                </div>
              )}
              {item.item_type !== 'text' && readOnly && existingResp?.notes && (
                <p className="mt-2 text-[12px] text-muted-foreground italic">{existingResp.notes}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-white py-4">
        {!isCompleted && (
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="gap-1.5"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Submit Checklist
              </>
            )}
          </Button>
        )}
        {canSignOff && (
          <Button
            onClick={() => signOffMutation.mutate()}
            disabled={signOffMutation.isPending}
            className="gap-1.5"
          >
            {signOffMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Signing off...
              </>
            ) : (
              <>
                <ShieldCheck className="h-3.5 w-3.5" />
                Sign Off
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
