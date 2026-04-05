'use client'
import { use, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  Check,
  Thermometer,
  Type,
  CheckCircle2,
  Camera,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, startOfDay, endOfDay } from 'date-fns'
import { toast } from 'sonner'

interface ChecklistDetailPageProps {
  params: Promise<{ id: string }>
}

export default function ClientPage({ params }: ChecklistDetailPageProps) {
  const { id: templateId } = use(params)
  const { profile, business } = useAuthStore()
  const router = useRouter()
  const queryClient = useQueryClient()
  const today = new Date()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [responses, setResponses] = useState<Record<string, { value: string; notes: string; flagged: boolean }>>({})
  const [completionNotes, setCompletionNotes] = useState('')

  const { data: template } = useQuery({
    queryKey: ['checklist-template', templateId],
    queryFn: async () => {
      const { data } = await supabase
        .from('checklist_templates')
        .select('*, checklist_template_items(*)')
        .eq('id', templateId)
        .single()
      return data
    },
  })

  const { data: existingCompletion } = useQuery({
    queryKey: ['checklist-completion-today', templateId],
    queryFn: async () => {
      const todayStart = startOfDay(today).toISOString()
      const todayEnd = endOfDay(today).toISOString()
      const { data } = await supabase
        .from('checklist_completions')
        .select('*, checklist_responses(*), profiles!checklist_completions_completed_by_fkey(full_name)')
        .eq('template_id', templateId)
        .eq('business_id', business!.id)
        .gte('completed_at', todayStart)
        .lte('completed_at', todayEnd)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data
    },
    enabled: !!business?.id,
  })

  const items = (template?.checklist_template_items as Array<{
    id: string
    name: string
    item_type: string
    required: boolean
    sort_order: number
    min_value: number | null
    max_value: number | null
    unit: string | null
    description: string | null
  }>) ?? []

  const sortedItems = [...items].sort((a, b) => a.sort_order - b.sort_order)
  const isReadOnly = !!existingCompletion
  const canSignOff = isManager && existingCompletion && !existingCompletion.signed_off_by && template?.supervisor_role

  const updateResponse = (itemId: string, value: string) => {
    const item = items.find((i) => i.id === itemId)
    let flagged = false

    if (item?.item_type === 'temperature' && item.min_value != null && item.max_value != null) {
      const num = parseFloat(value)
      if (!isNaN(num) && (num < item.min_value || num > item.max_value)) {
        flagged = true
      }
    }
    if (item?.item_type === 'yes_no' && value === 'no') {
      flagged = true
    }

    setResponses((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], value, flagged, notes: prev[itemId]?.notes ?? '' },
    }))
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const { data: completion, error: compError } = await supabase
        .from('checklist_completions')
        .insert({
          template_id: templateId,
          completed_by: profile!.id,
          business_id: business!.id,
          notes: completionNotes || null,
        })
        .select()
        .single()

      if (compError) throw compError

      const responseRows = sortedItems.map((item) => ({
        completion_id: completion.id,
        item_id: item.id,
        value: responses[item.id]?.value ?? '',
        notes: responses[item.id]?.notes || null,
        flagged: responses[item.id]?.flagged ?? false,
      }))

      const { error: respError } = await supabase
        .from('checklist_responses')
        .insert(responseRows)

      if (respError) throw respError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-completion-today', templateId] })
      queryClient.invalidateQueries({ queryKey: ['checklist-completions-today'] })
      toast.success('Checklist completed')
    },
    onError: (err) => toast.error(err.message),
  })

  const signOffMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('checklist_completions')
        .update({
          signed_off_by: profile!.id,
          signed_off_at: new Date().toISOString(),
        })
        .eq('id', existingCompletion!.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-completion-today', templateId] })
      toast.success('Signed off')
    },
  })

  const allRequired = sortedItems
    .filter((i) => i.required)
    .every((i) => responses[i.id]?.value)

  const itemIcon = (type: string) => {
    switch (type) {
      case 'temperature': return Thermometer
      case 'text': return Type
      case 'yes_no': return CheckCircle2
      case 'photo': return Camera
      default: return Check
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/checklists"
          className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Checklists
        </Link>
        <PageHeader
          title={template?.name ?? 'Checklist'}
          description={template?.description ?? undefined}
        >
          {canSignOff && (
            <Button
              onClick={() => signOffMutation.mutate()}
              disabled={signOffMutation.isPending}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              Sign Off
            </Button>
          )}
        </PageHeader>
      </div>

      {/* Completion banner */}
      {existingCompletion && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div>
            <p className="text-[13px] font-medium text-emerald-800">
              Completed by{' '}
              {(existingCompletion.profiles as { full_name: string | null } | null)?.full_name ?? 'Unknown'}{' '}
              at {format(new Date(existingCompletion.completed_at), 'HH:mm')}
            </p>
            {existingCompletion.signed_off_by && (
              <p className="text-[12px] text-emerald-700">Signed off</p>
            )}
          </div>
          <StatusBadge
            status="success"
            label={existingCompletion.signed_off_by ? 'Signed Off' : 'Completed'}
            className="ml-auto"
          />
        </div>
      )}

      {/* Items */}
      <div className="space-y-3">
        {sortedItems.map((item) => {
          const Icon = itemIcon(item.item_type)
          const existingResponse = (existingCompletion?.checklist_responses as Array<{
            item_id: string; value: string; notes: string | null; flagged: boolean
          }>)?.find((r) => r.item_id === item.id)
          const currentValue = isReadOnly ? (existingResponse?.value ?? '') : (responses[item.id]?.value ?? '')
          const isFlagged = isReadOnly ? (existingResponse?.flagged ?? false) : (responses[item.id]?.flagged ?? false)

          return (
            <div
              key={item.id}
              className={cn(
                'rounded-lg border bg-white p-4',
                isFlagged ? 'border-red-200 bg-red-50/50' : 'border-border'
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                  isFlagged ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                )}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium">{item.name}</p>
                    {item.required && (
                      <span className="text-[10px] text-red-500">Required</span>
                    )}
                    {isFlagged && (
                      <span className="flex items-center gap-0.5 text-[10px] font-medium text-red-600">
                        <AlertTriangle className="h-3 w-3" />
                        Flagged
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{item.description}</p>
                  )}

                  <div className="mt-3">
                    {item.item_type === 'tick' && (
                      <button
                        disabled={isReadOnly}
                        onClick={() => updateResponse(item.id, currentValue === 'true' ? '' : 'true')}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
                          currentValue === 'true'
                            ? 'border-emerald-300 bg-emerald-500 text-white'
                            : 'border-gray-300 hover:bg-accent'
                        )}
                      >
                        {currentValue === 'true' && <Check className="h-4 w-4" />}
                      </button>
                    )}

                    {item.item_type === 'temperature' && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step="0.1"
                          value={currentValue}
                          onChange={(e) => updateResponse(item.id, e.target.value)}
                          disabled={isReadOnly}
                          placeholder="0.0"
                          className="w-24 tabular-nums"
                        />
                        <span className="text-[12px] text-muted-foreground">
                          {item.unit ?? '°C'}
                        </span>
                        {item.min_value != null && item.max_value != null && (
                          <span className="text-[11px] text-muted-foreground">
                            Range: {item.min_value}–{item.max_value}{item.unit ?? '°C'}
                          </span>
                        )}
                      </div>
                    )}

                    {item.item_type === 'text' && (
                      <Textarea
                        value={currentValue}
                        onChange={(e) => updateResponse(item.id, e.target.value)}
                        disabled={isReadOnly}
                        placeholder="Enter your response..."
                        className="min-h-[60px] text-[13px]"
                      />
                    )}

                    {item.item_type === 'yes_no' && (
                      <div className="flex gap-2">
                        {['yes', 'no'].map((opt) => (
                          <button
                            key={opt}
                            disabled={isReadOnly}
                            onClick={() => updateResponse(item.id, opt)}
                            className={cn(
                              'rounded-md border px-4 py-1.5 text-[13px] font-medium capitalize transition-colors',
                              currentValue === opt
                                ? opt === 'yes'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                  : 'border-red-300 bg-red-50 text-red-700'
                                : 'border-gray-200 hover:bg-accent'
                            )}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}

                    {item.item_type === 'photo' && (
                      <div className="text-[12px] text-muted-foreground">
                        Photo upload available on mobile
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Submit */}
      {!isReadOnly && (
        <div className="sticky bottom-0 border-t border-border bg-white/80 px-6 py-4 -mx-6 -mb-6 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 mr-4">
              <Input
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                placeholder="Add notes (optional)..."
                className="text-[13px]"
              />
            </div>
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={!allRequired || submitMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {submitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Complete Checklist
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
