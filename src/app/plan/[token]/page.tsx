'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { fetchPlanBundleByToken } from '@/lib/haccp-plan/api'
import { buildPlan } from '@/lib/haccp-plan/build'
import { PlanDocument } from '@/components/haccp-plan/PlanDocument'
import { SectionChips } from '@/components/haccp-plan/SectionChips'
import { Logo, fmtDate } from '@/components/haccp-plan/parts'

function Message({ text }: { text: string }) {
  return (
    <div data-plan-state="error" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#f6f7f8', fontFamily: 'var(--font-geist), system-ui' }}>
      <div style={{ maxWidth: 420, background: '#fff', border: '1px solid #e9eaed', borderRadius: 14, padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Logo size={20} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>HACCP Plan</h1>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: '#3b3f47' }}>{text}</p>
      </div>
    </div>
  )
}

function PublicPlan() {
  const { token } = useParams<{ token: string }>()
  const print = useSearchParams().get('print') === '1'
  const { data, isLoading, error } = useQuery({
    queryKey: ['public-plan', token],
    queryFn: () => fetchPlanBundleByToken(token),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const doc = useMemo(() => (data && data !== 'expired' ? buildPlan(data) : null), [data])
  const [fontsReady, setFontsReady] = useState(false)
  useEffect(() => {
    if (!doc) return
    let alive = true
    document.fonts.ready.then(() => { if (alive) setFontsReady(true) })
    return () => { alive = false }
  }, [doc])

  if (isLoading) return <div data-plan-state="loading" style={{ minHeight: '100vh', background: print ? '#fff' : '#f6f7f8' }} />
  if (data === 'expired') return <Message text="This link has expired or was withdrawn. Ask the business for a new one." />
  if (error || !doc || data === undefined) return <Message text="Couldn’t load this plan. Try again in a moment." />

  const state = fontsReady ? 'ready' : 'loading'
  if (print) {
    return (
      <div data-plan-state={state} data-plan-filename={doc.fileName} data-plan-footer={doc.footerLabel} style={{ background: '#fff' }}>
        <PlanDocument doc={doc} mode="print" />
      </div>
    )
  }
  return (
    <div data-plan-state={state} data-plan-filename={doc.fileName} data-plan-footer={doc.footerLabel} style={{ minHeight: '100vh', background: '#f6f7f8' }}>
      <header className="plan-no-print" style={{ background: '#14161b', color: '#fff', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--font-geist), system-ui' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
          <span style={{ width: 8, height: 8, borderRadius: 9, background: '#1f9d63' }} />
          HACCP Plan · read-only
          {data.share && <span style={{ fontWeight: 400, color: '#a3a8b0' }}>· shared until {fmtDate(data.share.expiresAt, { day: 'numeric', month: 'short' })}</span>}
        </div>
        <a href={`/api/haccp-plan/pdf?t=${token}`} rel="nofollow"
          style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 14px', borderRadius: 10, background: '#1f9d63', color: '#fff', fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}>
          <Download size={16} strokeWidth={1.8} /> Download PDF
        </a>
      </header>
      <SectionChips doc={doc} />
      <main style={{ padding: '24px 0 48px' }}>
        <PlanDocument doc={doc} mode="screen" />
      </main>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div data-plan-state="loading" />}>
      <PublicPlan />
    </Suspense>
  )
}
