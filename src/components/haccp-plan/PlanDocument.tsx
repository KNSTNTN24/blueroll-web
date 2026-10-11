import type { PlanDoc } from '@/lib/haccp-plan/types'
import { MethodPage } from './MethodPage'
import { AtAGlance, CorrectivePage, Cover, SignoffPage } from './pages'
import './plan.css'

/** The HACCP Plan document. One renderer for the in-app view, the inspector link and the PDF. */
export function PlanDocument({ doc, mode, qrUrl }: { doc: PlanDoc; mode: 'screen' | 'print'; qrUrl?: string | null }) {
  return (
    <article className="plan-doc" data-mode={mode} lang="en-GB">
      <Cover doc={doc} qrUrl={qrUrl} />
      <AtAGlance doc={doc} />
      {doc.sections.flatMap((s) => s.methods.map((m, i) => <MethodPage key={m.id} doc={doc} method={m} first={i === 0} />))}
      <CorrectivePage doc={doc} />
      <SignoffPage doc={doc} />
    </article>
  )
}
