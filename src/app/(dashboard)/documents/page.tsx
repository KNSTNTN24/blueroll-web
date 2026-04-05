'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  FileText,
  Upload,
  Search,
  Eye,
  AlertTriangle,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, differenceInDays } from 'date-fns'

const CATEGORIES = [
  'all',
  'certificate',
  'license',
  'policy',
  'procedure',
  'training',
  'audit',
  'insurance',
  'other',
]

type DocumentRow = {
  id: string
  title: string
  description: string | null
  category: string
  file_url: string
  file_name: string
  file_size: number | null
  file_type: string | null
  uploaded_by: string
  business_id: string
  access_level: string
  expires_at: string | null
  created_at: string
  updated_at: string | null
  uploader: { full_name: string | null } | null
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getExpiryStatus(expiresAt: string | null): { status: 'success' | 'warning' | 'error' | 'neutral'; label: string } {
  if (!expiresAt) return { status: 'neutral', label: 'No expiry' }
  const days = differenceInDays(new Date(expiresAt), new Date())
  if (days < 0) return { status: 'error', label: 'Expired' }
  if (days <= 30) return { status: 'warning', label: `${days}d left` }
  return { status: 'success', label: format(new Date(expiresAt), 'dd MMM yyyy') }
}

export default function DocumentsPage() {
  const { profile, business } = useAuthStore()
  const router = useRouter()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')

  const { data: documents, isLoading } = useQuery({
    queryKey: ['documents', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('documents')
        .select('*, uploader:profiles!documents_uploaded_by_fkey(full_name)')
        .eq('business_id', business!.id)
        .order('created_at', { ascending: false })
      return (data ?? []) as unknown as DocumentRow[]
    },
    enabled: !!business?.id,
  })

  const filtered = documents?.filter((doc) => {
    if (category !== 'all' && doc.category !== category) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        doc.title.toLowerCase().includes(q) ||
        doc.file_name.toLowerCase().includes(q) ||
        doc.category.toLowerCase().includes(q)
      )
    }
    return true
  }) ?? []

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
        title="Documents"
        description="Certificates, licences, policies, and compliance documents"
      >
        {isManager && (
          <Button
            onClick={() => router.push('/documents/upload')}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Upload
          </Button>
        )}
      </PageHeader>

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="pl-9 text-[13px]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={cn(
                'rounded-full border px-3 py-1 text-[11px] font-medium capitalize transition-colors',
                category === cat
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-gray-200 text-muted-foreground hover:bg-accent'
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents"
          description={search || category !== 'all' ? 'No documents match your filters.' : 'Upload your first compliance document.'}
          action={isManager && !search ? { label: 'Upload Document', onClick: () => router.push('/documents/upload') } : undefined}
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
                const expiry = getExpiryStatus(doc.expires_at)
                return (
                  <tr key={doc.id} className="transition-colors hover:bg-accent/50">
                    <td className="px-4 py-3 text-[13px] font-medium">{doc.title}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                        {doc.category}
                      </span>
                    </td>
                    <td className="max-w-[180px] px-4 py-3 text-[13px] text-muted-foreground truncate">
                      {doc.file_name}
                    </td>
                    <td className="px-4 py-3 text-[13px] tabular-nums text-muted-foreground">
                      {formatFileSize(doc.file_size)}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-muted-foreground">
                      {doc.uploader?.full_name ?? 'Unknown'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={expiry.status} label={expiry.label} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        <Link
                          href={`/documents/${doc.id}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Link>
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
