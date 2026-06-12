'use client'

import { use, useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Upload, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { DOCUMENT_CATEGORIES } from '@/lib/constants'

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

export default function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const router = useRouter()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [loaded, setLoaded] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<string>('other')
  const [expiresAt, setExpiresAt] = useState('')

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

  // Pre-fill form when document loads
  useEffect(() => {
    if (doc && !loaded) {
      setTitle(doc.title ?? '')
      setDescription(doc.description ?? '')
      setCategory(doc.category)
      setExpiresAt(doc.expires_at ? doc.expires_at.slice(0, 10) : '')
      setLoaded(true)
    }
  }, [doc, loaded])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!business?.id) throw new Error('No business found')
      if (!doc) throw new Error('No document')
      const update: Record<string, any> = {
        title: title.trim() || doc.file_name,
        description: description.trim() || null,
        category,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      }
      let oldFileUrl: string | null = null
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const filePath = `${business.id}/${Date.now()}_${safeName}`
        const { error: upErr } = await supabase.storage.from('documents').upload(filePath, file)
        if (upErr) throw upErr
        oldFileUrl = doc.file_url
        update.file_url = filePath
        update.file_name = file.name
        update.file_size = file.size
        update.file_type = file.type || null
      }
      const { error: updErr } = await supabase.from('documents').update(update).eq('id', id)
      if (updErr) throw updErr
      if (oldFileUrl) {
        try { await supabase.storage.from('documents').remove([oldFileUrl]) } catch { /* best-effort */ }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['document', id] })
      toast.success('Document updated')
      router.push(`/documents/${id}`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) setFile(f)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) setFile(f)
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit Document" />
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit Document" />
        <p className="text-[13px] text-muted-foreground">Document not found.</p>
      </div>
    )
  }

  if (!isManager) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit Document">
          <Button variant="outline" size="sm" onClick={() => router.push(`/documents/${id}`)}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
        </PageHeader>
        <p className="text-[13px] text-muted-foreground">You don&apos;t have permission to edit this document.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Document" description="Update document details or replace the file">
        <Button variant="outline" size="sm" onClick={() => router.push(`/documents/${id}`)}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      </PageHeader>

      <div className="max-w-lg">
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate() }} className="space-y-4">
          <div className="rounded-lg border border-border bg-white p-4 space-y-4">
            {/* File Replace */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">File</label>
              {file ? (
                <div className="flex items-center justify-between rounded-md border border-border bg-gray-50 px-3 py-2">
                  <span className="text-[13px] text-foreground truncate">{file.name}</span>
                  <button type="button" onClick={() => setFile(null)} className="ml-2 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleFileDrop}
                  onClick={() => fileRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border py-8 text-center hover:border-emerald-300 transition-colors"
                >
                  <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
                  <p className="text-[13px] text-foreground truncate max-w-full px-4">{doc.file_name}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Replace file (optional) — drop or <span className="text-emerald-600 font-medium">browse</span>
                  </p>
                </div>
              )}
              <input ref={fileRef} type="file" className="hidden" onChange={handleFileSelect} />
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Document title"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Optional description"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value ?? '')}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] capitalize focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Expires at</label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <p className="text-[12px] text-muted-foreground">Leave empty if the document does not expire</p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" type="button" onClick={() => router.push(`/documents/${id}`)}>Cancel</Button>
            <Button size="sm" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
