'use client'

import { useState, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Upload, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { DOCUMENT_CATEGORIES } from '@/lib/constants'

export default function DocumentUploadPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<string>('other')
  const [accessLevel, setAccessLevel] = useState<string>('all')
  const [expiresAt, setExpiresAt] = useState('')

  const mutation = useMutation({
    mutationFn: async () => {
      if (!business?.id || !profile?.id || !file) throw new Error('Missing data')

      const timestamp = Date.now()
      const filePath = `${business.id}/${timestamp}_${file.name}`

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file)
      if (uploadError) throw uploadError

      const { error: insertError } = await supabase.from('documents').insert({
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
      if (insertError) throw insertError
    },
    onSuccess: () => {
      toast.success('Document uploaded')
      router.push('/documents')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) {
      setFile(f)
      if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ''))
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) {
      setFile(f)
      if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ''))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Upload Document" description="Add a new document to your library">
        <Button variant="outline" size="sm" onClick={() => router.push('/documents')}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      </PageHeader>

      <div className="max-w-lg">
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate() }} className="space-y-4">
          <div className="rounded-lg border border-border bg-white p-4 space-y-4">
            {/* File Upload */}
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
                  <p className="text-[13px] text-muted-foreground">
                    Drop a file here or <span className="text-emerald-600 font-medium">browse</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">PDF, images, documents up to 50MB</p>
                </div>
              )}
              <input ref={fileRef} type="file" className="hidden" onChange={handleFileSelect} />
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Title</label>
              <input
                required
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

            <div className="grid gap-4 sm:grid-cols-2">
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
                <label className="text-[13px] font-medium text-foreground">Access level</label>
                <select
                  value={accessLevel}
                  onChange={(e) => setAccessLevel(e.target.value ?? '')}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="all">All team members</option>
                  <option value="managers_only">Managers only</option>
                  <option value="owner_only">Owner only</option>
                </select>
              </div>
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
            <Button variant="outline" size="sm" type="button" onClick={() => router.push('/documents')}>Cancel</Button>
            <Button size="sm" type="submit" disabled={mutation.isPending || !file}>
              {mutation.isPending ? 'Uploading...' : 'Upload document'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
