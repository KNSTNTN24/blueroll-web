'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { buildPlan } from '@/lib/haccp-plan/build'
import { makeBundle, makeRichBundle } from '@/lib/haccp-plan/fixtures'
import { PlanDocument } from '@/components/haccp-plan/PlanDocument'

// Dev-only visual check of the HACCP Plan renderer against docs/design/haccp-plan.
function Preview() {
  const sp = useSearchParams()
  const mode = sp.get('mode') === 'print' ? 'print' : 'screen'
  const doc = buildPlan(sp.get('empty') === '1' ? makeBundle() : makeRichBundle(), new Date('2026-10-11T09:00:00Z'))
  return (
    <div style={{ background: mode === 'screen' ? '#f6f7f8' : '#fff', minHeight: '100vh', padding: mode === 'screen' ? '24px 0' : 0 }}>
      <PlanDocument doc={doc} mode={mode} qrUrl={sp.get('qr') === '1' ? 'https://app.blueroll.app/plan/example-token' : null} />
    </div>
  )
}

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <Suspense>
      <Preview />
    </Suspense>
  )
}
