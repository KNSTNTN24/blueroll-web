'use client'

import { use, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Download, Trash2, FileText, Eye, EyeOff } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { format, differenceInDays } from 'date-fns'

interface Document {
  id: string
  title: string
  description: string | null
  category: string
  file_url: string
  file_name: string
  file_size: number | null
  file_type: string | null
  access_level: string
  expires_at: string | null
  uploaded_by: string
  created_at: string
  uploader?: { full_name: string | null; email: string }
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const profile = useAuthStore((s) => s.profile)
  const router = useRouter()
  const queryClient = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const { data: doc, isLoading } = useQuery({
    queryKey: ['document', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*, uploader:profiles!documents_uploaded_by_fkey(full_name, email)')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Document
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!doc) throw new Error('No document')
      // Delete file from storage
      await supabase.storage.from('documents').remove([doc.file_url])
      // Delete record
      const { error } = await supabase.from('documents').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      toast.success('Document deleted')
      router.push('/documents')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  async function handleDownload() {
    if (!doc) return
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(doc.file_url, 3600)
    if (error) {
      toast.error('Failed to generate download link')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  async function handleTogglePreview() {
    if (!doc) return
    if (previewUrl) {
      setPreviewUrl(null)
      return
    }
    setPreviewLoading(true)
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(doc.file_url, 3600)
    setPreviewLoading(false)
    if (error) {
      toast.error('Failed to generate preview link')
      return
    }
    setPreviewUrl(data.signedUrl)
  }

  function renderPreview() {
    if (!doc || !previewUrl) return null
    const type = (doc.file_type ?? '').toLowerCase()
    const isPdf = type.includes('pdf') || doc.file_name.toLowerCase().endsWith('.pdf')
    const isImage = type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(doc.file_name)

    if (isPdf) {
      return (
        <iframe
          src={previewUrl}
          title={doc.title}
          className="h-[70vh] w-full rounded-md border border-border bg-white"
        />
      )
    }
    if (isImage) {
      return (
        <div className="flex items-center justify-center rounded-md border border-border bg-gray-50 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={doc.title} className="max-h-[70vh] max-w-full object-contain" />
        </div>
      )
    }
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-gray-50 p-8 text-center">
        <FileText className="h-8 w-8 text-muted-foreground" />
        <p className="text-[13px] text-muted-foreground">Inline preview not available for this file type.</p>
        <Button size="sm" variant="outline" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />
          Open in new tab
        </Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Document" />
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="space-y-6">
        <PageHeader title="Document" />
        <p className="text-[13px] text-muted-foreground">Document not found.</p>
      </div>
    )
  }

  const daysLeft = doc.expires_at ? differenceInDays(new Date(doc.expires_at), new Date()) : null

  return (
    <div className="space-y-6">
      <PageHeader title={doc.title} description={doc.description ?? undefined}>
        <Button variant="outline" size="sm" onClick={() => router.push('/documents')}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      </PageHeader>

      <div className="max-w-3xl space-y-4">
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[12px] font-medium text-muted-foreground">Category</p>
              <p className="mt-0.5 text-[13px] capitalize text-foreground">{doc.category}</p>
            </div>
            <div>
              <p className="text-[12px] font-medium text-muted-foreground">File</p>
              <p className="mt-0.5 text-[13px] text-foreground">{doc.file_name}</p>
            </div>
            <div>
              <p className="text-[12px] font-medium text-muted-foreground">Size</p>
              <p className="mt-0.5 text-[13px] tabular-nums text-foreground">{formatFileSize(doc.file_size)}</p>
            </div>
            <div>
              <p className="text-[12px] font-medium text-muted-foreground">Uploaded by</p>
              <p className="mt-0.5 text-[13px] text-foreground">{doc.uploader?.full_name || doc.uploader?.email || 'Unknown'}</p>
            </div>
            <div>
              <p className="text-[12px] font-medium text-muted-foreground">Uploaded on</p>
              <p className="mt-0.5 text-[13px] tabular-nums text-foreground">{format(new Date(doc.created_at), 'dd MMM yyyy HH:mm')}</p>
            </div>
            <div>
              <p className="text-[12px] font-medium text-muted-foreground">Access level</p>
              <p className="mt-0.5 text-[13px] text-foreground">
                {doc.access_level === 'all' ? 'All team members' : doc.access_level === 'managers_only' ? 'Managers only' : 'Owner only'}
              </p>
            </div>
            {doc.expires_at && (
              <div>
                <p className="text-[12px] font-medium text-muted-foreground">Expires</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="text-[13px] tabular-nums text-foreground">
                    {format(new Date(doc.expires_at), 'dd MMM yyyy')}
                  </span>
                  {daysLeft !== null && daysLeft < 0 && (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">Expired</span>
                  )}
                  {daysLeft !== null && daysLeft >= 0 && daysLeft <= 30 && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">{daysLeft}d left</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={handleTogglePreview} disabled={previewLoading}>
            {previewUrl ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {previewLoading ? 'Loading...' : previewUrl ? 'Hide preview' : 'Preview'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
          {isManager && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { if (confirm('Delete this document? This cannot be undone.')) deleteMutation.mutate() }}
              className="text-red-600 hover:text-red-700"
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          )}
        </div>

        {previewUrl && <div className="mt-2">{renderPreview()}</div>}
      </div>
    </div>
  )
}
