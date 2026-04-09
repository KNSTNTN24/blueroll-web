'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { useRouter } from 'next/navigation'
import { FileText, Plus, Search, Eye } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DOCUMENT_CATEGORIES } from '@/lib/constants'
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

function expiryStatus(expiresAt: string | null): { label: string; color: string } | null {
  if (!expiresAt) return null
  const daysLeft = differenceInDays(new Date(expiresAt), new Date())
  if (daysLeft < 0) return { label: 'Expired', color: 'text-red-700 bg-red-50' }
  if (daysLeft <= 30) return { label: `${daysLeft}d left`, color: 'text-amber-700 bg-amber-50' }
  return null
}

export default function DocumentsPage() {
  const business = useAuthStore((s) => s.business)
  const router = useRouter()

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('documents')
        .select('*, uploader:profiles!documents_uploaded_by_fkey(full_name, email)')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Document[]
    },
    enabled: !!business?.id,
  })

  const filtered = documents.filter((d) => {
    if (category !== 'all' && d.category !== category) return false
    if (search && !d.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Documents" description="Manage certificates, policies and more" />
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Documents" description="Manage certificates, policies and more">
        <Button size="sm" onClick={() => router.push('/documents/upload')}>
          <Plus className="h-3.5 w-3.5" />
          Upload
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setCategory('all')}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              category === 'all'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white text-muted-foreground border-border hover:border-emerald-200'
            )}
          >
            All
          </button>
          {DOCUMENT_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors',
                category === c
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-white text-muted-foreground border-border hover:border-emerald-200'
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="rounded-md border border-border bg-white pl-8 pr-3 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-56"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents"
          description={documents.length === 0 ? 'Upload your first document to get started.' : 'No documents match your filters.'}
          action={documents.length === 0 ? { label: 'Upload document', onClick: () => router.push('/documents/upload') } : undefined}
        />
      ) : (
        <div className="rounded-lg border border-border bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Title</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Category</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">File</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Size</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Uploaded by</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Expires</th>
                <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((doc) => {
                const expiry = expiryStatus(doc.expires_at)
                return (
                  <tr key={doc.id} className="hover:bg-accent/50">
                    <td className="px-4 py-2.5 text-[13px] font-medium text-foreground">{doc.title}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center rounded-full border border-border bg-gray-50 px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                        {doc.category}
                      </span>
                    </td>
                    <td className="max-w-[150px] truncate px-4 py-2.5 text-[13px] text-muted-foreground">{doc.file_name}</td>
                    <td className="px-4 py-2.5 text-[13px] tabular-nums text-muted-foreground">{formatFileSize(doc.file_size)}</td>
                    <td className="px-4 py-2.5 text-[13px] text-muted-foreground">
                      {doc.uploader?.full_name || doc.uploader?.email || 'Unknown'}
                    </td>
                    <td className="px-4 py-2.5">
                      {doc.expires_at ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] tabular-nums text-muted-foreground">
                            {format(new Date(doc.expires_at), 'dd MMM yyyy')}
                          </span>
                          {expiry && (
                            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', expiry.color)}>
                              {expiry.label}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => router.push(`/documents/${doc.id}`)} title="View">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
