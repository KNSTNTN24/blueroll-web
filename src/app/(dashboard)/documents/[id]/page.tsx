'use client'

import { use } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  Download,
  Trash2,
  FileText,
  Calendar,
  User,
  Shield,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, differenceInDays } from 'date-fns'
import { toast } from 'sonner'

interface DocumentDetailPageProps {
  params: Promise<{ id: string }>
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getExpiryInfo(expiresAt: string | null): { status: 'success' | 'warning' | 'error' | 'neutral'; label: string } {
  if (!expiresAt) return { status: 'neutral', label: 'No expiry date set' }
  const days = differenceInDays(new Date(expiresAt), new Date())
  if (days < 0) return { status: 'error', label: `Expired ${Math.abs(days)} days ago` }
  if (days <= 30) return { status: 'warning', label: `Expires in ${days} days` }
  return { status: 'success', label: `Expires ${format(new Date(expiresAt), 'dd MMM yyyy')}` }
}

const ACCESS_LABELS: Record<string, string> = {
  all: 'All staff',
  managers_only: 'Managers only',
  owner_only: 'Owner only',
}

export default function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { id } = use(params)
  const { profile, business } = useAuthStore()
  const router = useRouter()
  const queryClient = useQueryClient()
  const isOwner = (docOwnerId: string) => profile?.id === docOwnerId
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const { data: doc, isLoading } = useQuery({
    queryKey: ['document', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('documents')
        .select('*, uploader:profiles!documents_uploaded_by_fkey(full_name)')
        .eq('id', id)
        .single()
      return data as (typeof data) & { uploader: { full_name: string | null } | null }
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (doc?.file_url) {
        await supabase.storage.from('documents').remove([doc.file_url])
      }
      const { error } = await supabase.from('documents').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      toast.success('Document deleted')
      router.push('/documents')
    },
    onError: (err) => toast.error(err.message),
  })

  const handleDownload = async () => {
    if (!doc?.file_url) return
    const { data } = await supabase.storage
      .from('documents')
      .createSignedUrl(doc.file_url, 60)
    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank')
    } else {
      toast.error('Failed to generate download link')
    }
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

  if (!doc) {
    return (
      <div className="space-y-6">
        <Link
          href="/documents"
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Documents
        </Link>
        <p className="text-[13px] text-muted-foreground">Document not found.</p>
      </div>
    )
  }

  const expiry = getExpiryInfo(doc.expires_at)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/documents"
          className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Documents
        </Link>
        <PageHeader title={doc.title}>
          <Button
            onClick={handleDownload}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download
          </Button>
          {(isOwner(doc.uploaded_by) || isManager) && (
            <Button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              size="sm"
              variant="outline"
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Delete
            </Button>
          )}
        </PageHeader>
      </div>

      <div className="max-w-2xl rounded-lg border border-border bg-white">
        {doc.description && (
          <div className="border-b border-border px-6 py-4">
            <p className="text-[13px] text-muted-foreground">{doc.description}</p>
          </div>
        )}

        <div className="divide-y divide-border">
          <div className="flex items-center gap-3 px-6 py-3">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-[11px] text-muted-foreground">File</p>
              <p className="text-[13px]">{doc.file_name}</p>
            </div>
            <span className="text-[13px] tabular-nums text-muted-foreground">
              {formatFileSize(doc.file_size)}
            </span>
          </div>

          <div className="flex items-center gap-3 px-6 py-3">
            <span className="flex h-4 w-4 items-center justify-center">
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                {doc.category}
              </span>
            </span>
            <div className="flex-1">
              <p className="text-[11px] text-muted-foreground">Category</p>
              <p className="text-[13px] capitalize">{doc.category}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 px-6 py-3">
            <User className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-[11px] text-muted-foreground">Uploaded by</p>
              <p className="text-[13px]">{doc.uploader?.full_name ?? 'Unknown'}</p>
            </div>
            <span className="text-[13px] tabular-nums text-muted-foreground">
              {format(new Date(doc.created_at), 'dd MMM yyyy')}
            </span>
          </div>

          <div className="flex items-center gap-3 px-6 py-3">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-[11px] text-muted-foreground">Access Level</p>
              <p className="text-[13px]">{ACCESS_LABELS[doc.access_level] ?? doc.access_level}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 px-6 py-3">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-[11px] text-muted-foreground">Expiry</p>
              <StatusBadge status={expiry.status} label={expiry.label} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
