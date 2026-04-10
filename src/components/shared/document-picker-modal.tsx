'use client'

import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Upload, FileText, X, Search, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DOCUMENT_CATEGORIES } from '@/lib/constants'
import { cn } from '@/lib/utils'

export interface PickedDocument {
  id: string
  title: string
}

interface DocumentPickerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (doc: PickedDocument) => void
  label?: string
}

type TabId = 'existing' | 'upload'

export function DocumentPickerModal({
  open,
  onOpenChange,
  onSelect,
  label,
}: DocumentPickerModalProps) {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<TabId>('existing')
  const [search, setSearch] = useState('')

  // ── Upload form state (mirrors documents/upload/page.tsx) ──
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('other')
  const [accessLevel, setAccessLevel] = useState('all')
  const [expiresAt, setExpiresAt] = useState('')
  const [uploading, setUploading] = useState(false)

  // ── Existing documents query ──
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('documents')
        .select('id, title, category, file_name, created_at')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id && open,
  })

  const filtered = documents.filter((d: any) =>
    !search || d.title.toLowerCase().includes(search.toLowerCase()) || d.file_name?.toLowerCase().includes(search.toLowerCase()),
  )

  function resetUploadForm() {
    setFile(null)
    setTitle('')
    setDescription('')
    setCategory('other')
    setAccessLevel('all')
    setExpiresAt('')
  }

  function handleFileSelect(f: File) {
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ''))
  }

  async function handleUpload() {
    if (!file || !business?.id || !profile?.id) return

    setUploading(true)
    try {
      const timestamp = Date.now()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const filePath = `${business.id}/${timestamp}_${safeName}`

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file, { contentType: file.type || undefined })
      if (uploadError) throw uploadError

      const { data: doc, error: insertError } = await supabase
        .from('documents')
        .insert({
          business_id: business.id,
          title: title || file.name,
          description: description || null,
          category,
          file_url: filePath,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type || null,
          access_level: accessLevel,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          uploaded_by: profile.id,
        })
        .select('id, title')
        .single()
      if (insertError) throw insertError

      queryClient.invalidateQueries({ queryKey: ['documents'] })
      toast.success('Document uploaded')
      resetUploadForm()
      onSelect({ id: doc.id, title: doc.title })
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload document')
    } finally {
      setUploading(false)
    }
  }

  function handlePickExisting(doc: { id: string; title: string }) {
    onSelect({ id: doc.id, title: doc.title })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            {label || 'Attach document'}
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border border-border p-1 bg-muted/30">
          {([
            { id: 'existing' as TabId, label: 'Choose existing' },
            { id: 'upload' as TabId, label: 'Upload new' },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                tab === t.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab: Choose existing ── */}
        {tab === 'existing' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search documents..."
                className="w-full rounded-md border border-border bg-white pl-8 pr-3 py-1.5 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center text-[13px] text-muted-foreground">
                {documents.length === 0 ? 'No documents uploaded yet.' : 'No documents match your search.'}
              </div>
            ) : (
              <div className="max-h-[40vh] overflow-y-auto space-y-1">
                {filtered.map((doc: any) => (
                  <button
                    key={doc.id}
                    onClick={() => handlePickExisting(doc)}
                    className="flex w-full items-center gap-3 rounded-md border border-border bg-white px-3 py-2.5 text-left hover:border-emerald-300 transition-colors"
                  >
                    <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-foreground truncate">{doc.title}</div>
                      <div className="text-[11px] text-muted-foreground">{doc.category} · {doc.file_name}</div>
                    </div>
                    <Check className="h-4 w-4 text-emerald-600 opacity-0 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Upload new ── */}
        {tab === 'upload' && (
          <div className="space-y-4">
            {/* File drop zone */}
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
                  onDrop={(e) => {
                    e.preventDefault()
                    const f = e.dataTransfer.files?.[0]
                    if (f) handleFileSelect(f)
                  }}
                  onClick={() => fileRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border py-6 text-center hover:border-emerald-300 transition-colors"
                >
                  <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
                  <p className="text-[13px] text-muted-foreground">
                    Drop a file here or <span className="text-emerald-600 font-medium">browse</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">PDF, images, documents up to 50MB</p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFileSelect(f)
                }}
              />
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Document title"
              />
            </div>

            {/* Description */}
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

            {/* Category + Access level */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-foreground">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] capitalize focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-foreground">Access level</label>
                <select
                  value={accessLevel}
                  onChange={(e) => setAccessLevel(e.target.value)}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="all">All team members</option>
                  <option value="managers_only">Managers only</option>
                  <option value="owner_only">Owner only</option>
                </select>
              </div>
            </div>

            {/* Expires at */}
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

            {/* Submit */}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  resetUploadForm()
                  onOpenChange(false)
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={uploading || !file}
                onClick={handleUpload}
              >
                {uploading ? 'Uploading...' : 'Upload & attach'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
