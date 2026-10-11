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
  const bundle = sp.get('empty') === '1' ? makeBundle() : makeRichBundle()
  if (sp.get('stress') === '1') {
    // Review focus: unbreakable strings and a long menu must not overflow A4.
    const long = 'Chargrilled-halloumi-and-roasted-pepper-flatbread-with-pomegranate-molasses-XL'
    bundle.sources.dishes = [...bundle.sources.dishes, ...Array.from({ length: 60 }, (_, i) => ({ ...bundle.sources.dishes[0], id: `x${i}`, name: i === 0 ? long : `Special ${i + 1}` }))]
    bundle.proof.corrective = [...bundle.proof.corrective, { ...bundle.proof.corrective[0], notes: 'x'.repeat(160) }]
  }
  const doc = buildPlan(bundle, new Date('2026-10-11T09:00:00Z'))
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
