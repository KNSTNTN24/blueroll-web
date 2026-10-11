'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Download, FileSignature, Link2, MonitorPlay, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { EmptyState } from '@/components/shared/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PlanDocument } from '@/components/haccp-plan/PlanDocument'
import { PresentOverlay } from '@/components/haccp-plan/PresentOverlay'
import { ShareDialog } from '@/components/haccp-plan/ShareDialog'
import { fetchPlanBundleForSite, signOffPlan } from '@/lib/haccp-plan/api'
import { buildPlan } from '@/lib/haccp-plan/build'
import { createShare, TTL } from '@/lib/haccp-plan/share'

const btn = 'inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-[12.5px] font-medium hover:bg-accent disabled:opacity-60'

export default function HaccpPlanDocumentPage() {
  const { business, profile } = useAuthStore()
  const sites = useAuthStore((s) => s.sites)
  const currentSiteId = useAuthStore((s) => s.currentSiteId)
  const qc = useQueryClient()
  const businessId = business?.id ?? ''
  // Same rule as the pack page: packs are per-site.
  const packSiteId = currentSiteId ?? (sites.length === 1 ? sites[0].id : null)
  const isAllSites = sites.length > 1 && !currentSiteId

  const [present, setPresent] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [signing, setSigning] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)

  const key = ['haccp-plan', businessId, packSiteId]
  const { data: bundle, isLoading, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => fetchPlanBundleForSite(packSiteId),
    enabled: !!businessId && !isAllSites,
    staleTime: 30_000,
  })
  const doc = useMemo(() => (bundle ? buildPlan(bundle) : null), [bundle])
  const canManage = !!bundle?.viewer?.canManage

  async function downloadPdf() {
    if (!profile || !doc) return
    setPdfBusy(true)
    try {
      const { token } = await createShare({ kind: 'pdf', businessId, siteId: packSiteId, userId: profile.id, ttlMs: TTL.pdf })
      const res = await fetch(`/api/haccp-plan/pdf?t=${token}`)
      if (!res.ok) throw new Error(`pdf ${res.status}`)
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = doc.fileName
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      toast.error('Could not prepare the PDF. Try again in a moment.')
    } finally {
      setPdfBusy(false)
    }
  }

  async function confirmSignOff() {
    if (!profile || !packSiteId) return
    try {
      await signOffPlan({ businessId, siteId: packSiteId, userId: profile.id, name: profile.full_name ?? 'Manager' })
      toast.success('Plan signed off')
      setSigning(false)
      qc.invalidateQueries({ queryKey: key })
    } catch {
      toast.error('Could not sign off')
    }
  }

  if (isAllSites) {
    return (
      <EmptyState icon={ShieldCheck} title="Pick a site to view its HACCP Plan" description="Each site has its own plan. Choose a site in the site switcher." />
    )
  }

  return (
    <div className="flex flex-col gap-5 pb-10">
      <div className="plan-no-print sticky top-0 z-10 -mx-6 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/haccp-pack" className={btn}><ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} /> Back to pack</Link>
          {doc && (
            <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${doc.inspectionReady ? 'bg-[#e9f4ee] text-[#1f7a52]' : 'bg-[#fbf1e1] text-[#8a5a0c]'}`}>
              {doc.inspectionReady ? 'Inspection-ready' : `${doc.pct}% complete`}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btn} onClick={() => setPresent(true)} disabled={!doc}>
            <MonitorPlay className="h-3.5 w-3.5" strokeWidth={1.8} /> Present
          </button>
          {canManage && (
            <button type="button" className={btn} onClick={() => setSharing(true)} disabled={!doc}>
              <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} /> Share with inspector
            </button>
          )}
          {canManage && packSiteId && (
            <button type="button" className={btn} onClick={() => setSigning(true)} disabled={!doc}>
              <FileSignature className="h-3.5 w-3.5" strokeWidth={1.8} /> {doc?.signoff ? 'Sign again' : 'Sign off'}
            </button>
          )}
          <button type="button" onClick={downloadPdf} disabled={!doc || pdfBusy}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3.5 text-[12.5px] font-medium text-background disabled:opacity-60">
            <Download className="h-3.5 w-3.5" strokeWidth={1.8} /> {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="mx-auto flex w-full max-w-[794px] flex-col gap-4">
          <Skeleton className="h-[420px] w-full rounded-xl" />
          <Skeleton className="h-[300px] w-full rounded-xl" />
        </div>
      )}
      {error && (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
          <p className="text-[14px] font-medium">Couldn’t load the HACCP Plan.</p>
          <button type="button" className={btn} onClick={() => refetch()}>Try again</button>
        </div>
      )}
      {doc && <PlanDocument doc={doc} mode="screen" />}

      {present && doc && <PresentOverlay doc={doc} onClose={() => setPresent(false)} />}
      {sharing && profile && (
        <ShareDialog open={sharing} onOpenChange={setSharing} businessId={businessId} siteId={packSiteId} userId={profile.id} />
      )}
      <Dialog open={signing} onOpenChange={setSigning}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Sign off this HACCP Plan</DialogTitle>
            <DialogDescription>
              You confirm the plan matches how food is handled at {doc?.siteName ?? 'this site'}, staff are trained in the methods that apply to them, and it will be reviewed every four weeks.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn} onClick={() => setSigning(false)}>Cancel</button>
            <button type="button" onClick={confirmSignOff} className="inline-flex h-9 items-center rounded-lg bg-[#1f9d63] px-4 text-[13px] font-semibold text-white">
              Sign as {profile?.full_name ?? 'manager'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
