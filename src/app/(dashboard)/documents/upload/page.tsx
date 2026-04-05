'use client'

import { useState, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft,
  Upload,
  File,
  X,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

const CATEGORIES = [
  'certificate',
  'license',
  'policy',
  'procedure',
  'training',
  'audit',
  'insurance',
  'other',
]

const ACCESS_LEVELS = [
  { value: 'all', label: 'All staff' },
  { value: 'managers_only', label: 'Managers only' },
  { value: 'owner_only', label: 'Owner only' },
]

export default function UploadDocumentPage() {
  const { profile, business } = useAuthStore()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [accessLevel, setAccessLevel] = useState('all')
  const [expiresAt, setExpiresAt] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Please select a file')
      if (!category) throw new Error('Please select a category')

      const fileExt = file.name.split('.').pop()
      const filePath = `${business!.id}/${crypto.randomUUID()}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      const { error: insertError } = await supabase.from('documents').insert({
        title: title.trim(),
        description: description.trim() || null,
        category,
        file_url: filePath,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type || null,
        uploaded_by: profile!.id,
        business_id: business!.id,
        access_level: accessLevel,
        expires_at: expiresAt || null,
      })

      if (insertError) throw insertError
    },
    onSuccess: () => {
      toast.success('Document uploaded')
      router.push('/documents')
    },
    onError: (err) => toast.error(err.message),
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      setFile(selected)
      if (!title) setTitle(selected.name.replace(/\.[^/.]+$/, ''))
    }
  }

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
        <PageHeader
          title="Upload Document"
          description="Upload a compliance document, certificate, or policy"
        />
      </div>

      <div className="max-w-lg rounded-lg border border-border bg-white p-6">
        <div className="space-y-4">
          {/* File upload */}
          <div className="space-y-1.5">
            <Label className="text-[13px]">File</Label>
            {file ? (
              <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                <File className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">{file.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-gray-200 p-8 text-center transition-colors hover:border-gray-300 hover:bg-accent/50"
              >
                <Upload className="h-6 w-6 text-muted-foreground" />
                <div>
                  <p className="text-[13px] font-medium">Click to upload</p>
                  <p className="text-[11px] text-muted-foreground">PDF, DOC, JPG, PNG up to 10MB</p>
                </div>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Document title"
              className="text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              className="min-h-[60px] text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Select category..." />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat} className="capitalize">
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">Access Level</Label>
            <Select value={accessLevel} onValueChange={(v) => setAccessLevel(v ?? "")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCESS_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">Expiry Date (optional)</Label>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/documents')}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={!title.trim() || !file || !category || uploadMutation.isPending}
            onClick={() => uploadMutation.mutate()}
          >
            {uploadMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Upload Document
          </Button>
        </div>
      </div>
    </div>
  )
}
