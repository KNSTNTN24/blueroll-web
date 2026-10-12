import type { PlanDoc, PlanMethod, MethodProof } from '@/lib/haccp-plan/types'
import { RunHead, SectionIcon, SheetFooter, Tick, type IconKey } from './parts'
import { AllergenMatrix, CleaningFrequency, CookCombos, PanToPass, TempScale, TwoStageClean } from './infographics'

const METHOD_ICON: Record<string, IconKey> = { food_allergies: 'allergens', chilled_storage: 'fridge', freezing: 'fridge' }

const DAY_LABEL = [
  ['ok', 'Recorded'],
  ['corrected', 'Out of range, corrected'],
  ['flagged', 'Out of range, not yet corrected'],
  ['missed', 'Missed'],
] as const

export function ProofPanel({ proof, period }: { proof: MethodProof | null; period: string }) {
  if (!proof) {
    return (
      <div className="pd-proof plan-keep" data-empty="1">
        <div className="pd-row-c">
          <SectionIcon icon="thermometer" size={32} tone="tint" />
          <div>
            <div className="pd-kicker">Prove it</div>
            <div style={{ fontSize: 13.5, color: '#3b3f47', marginTop: 2 }}>No records linked yet — add a checklist in Blueroll.</div>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="pd-proof plan-keep">
      <div className="pd-row" style={{ alignItems: 'center' }}>
        <div className="pd-row-c">
          <SectionIcon icon="thermometer" size={32} tone="tint" />
          <div>
            <div className="pd-kicker">Prove it</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{proof.title}</div>
          </div>
        </div>
        <div className="pd-sub" style={{ textAlign: 'right' }}>Last 28 days · {period}</div>
      </div>
      <div className="pd-strip" role="img" aria-label={`28-day record: ${proof.days.join(', ')}`}>
        {proof.days.map((d, i) => <span key={i} className={`pd-day-${d}`} />)}
      </div>
      <div className="pd-stats3">
        {proof.stats.map((s) => (
          <div key={s.label}>
            <div className="pd-stat-v" style={{ color: s.tone === 'amber' ? '#8a5a0c' : undefined }}>{s.value}</div>
            <div style={{ color: '#3b3f47' }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div className="pd-legend">
        {DAY_LABEL.map(([k, l]) => <span key={k}><i className={`pd-day-${k}`} />{l}</span>)}
      </div>
      {proof.sourceNames.length > 0 && <div className="pd-sub">From: {proof.sourceNames.join(' · ')}</div>}
    </div>
  )
}

function statusPill(m: PlanMethod) {
  if (m.status === 'in_place') return <span className="pd-pill" data-tone="ok">In place{m.toggleTotal ? ` · ${m.inPlace} of ${m.toggleTotal}` : ''}</span>
  if (m.status === 'partial') return <span className="pd-pill" data-tone="amber">{m.toggleTotal ? `${m.inPlace} of ${m.toggleTotal} in place` : 'Partly complete'}</span>
  return <span className="pd-pill" data-tone="open">To complete</span>
}

export function MethodPage({ doc, method, first }: { doc: PlanDoc; method: PlanMethod; first: boolean }) {
  const section = doc.sections.find((s) => s.id === method.section)!
  const period = `${new Date(doc.periodStart + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(doc.periodEnd + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
  return (
    <section className="plan-sheet" id={first ? `section-${method.section}` : `method-${method.id}`} aria-labelledby={`m-${method.id}`}>
      <RunHead doc={doc} right={`${section.num} · ${section.name}`} />

      {first && (
        <div className="pd-row-c plan-keep" style={{ gap: 12, background: '#f6f7f8', borderRadius: 10, padding: '10px 14px' }}>
          <SectionIcon icon={method.section} size={28} tone="tint" />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Section {section.num} · {section.name}</span>
          <span className="pd-sub" style={{ marginLeft: 'auto' }}>{section.filled} of {section.total} points · {section.pct}%</span>
        </div>
      )}

      <div className="pd-row plan-keep" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="pd-row-c" style={{ gap: 16 }}>
          <SectionIcon icon={METHOD_ICON[method.id] ?? method.section} size={56} tone="solid" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="pd-kicker">Safe method {method.ref} · {method.sectionName}</div>
            <h2 className="pd-h1" id={`m-${method.id}`}>{method.name}</h2>
          </div>
        </div>
        {statusPill(method)}
      </div>

      <div className="pd-label-grid">
        <div className="pd-label">Safety point</div>
        <div className="pd-text">{method.safetyPoint}</div>
        <div className="pd-label">Why?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="pd-text-2">{method.why}</p>
          {method.infographic.includes('tempScale') && <TempScale />}
          {method.infographic.includes('cookCombos') && <CookCombos />}
        </div>
        <div className="pd-label">What we do</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {method.doList.length > 0 && (
            <ul className="pd-ticks" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {method.doList.map((d) => <li key={d} className="pd-tick"><Tick /><span>{d}</span></li>)}
            </ul>
          )}
          {method.answers.map((a) => (
            <div key={a.label} className="pd-answer">
              <div className="pd-answer-label">{a.label}</div>
              {a.value.split('\n').filter((l) => l.trim()).map((l, i) => <p key={i}>{l}</p>)}
              {a.autoLabel && <div className="pd-answer-auto">{a.autoLabel}</div>}
            </div>
          ))}
          {method.attachments.length > 0 && (
            <div className="pd-answer">
              <div className="pd-answer-label">Attached</div>
              {method.attachments.map((f) => <p key={f.title}>{f.title}</p>)}
            </div>
          )}
          {!method.doList.length && !method.answers.length && !method.attachments.length && (
            <p className="pd-text-2" style={{ color: '#5f6670' }}>Not described yet.</p>
          )}
        </div>
      </div>

      {method.infographic.includes('twoStageClean') && <TwoStageClean />}
      {method.infographic.includes('cleaningFrequency') && <CleaningFrequency buckets={doc.cleaningFrequency} />}
      {method.infographic.includes('panToPass') && <PanToPass />}
      {method.infographic.includes('allergenMatrix') && (doc.menuHasAllergens ? <AllergenMatrix dishes={doc.dishes} /> : (
        <div className="pd-box plan-keep" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="pd-h2">Allergen matrix</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: '#3b3f47' }}>
            {method.attachments.length
              ? `See the attached allergen matrix: ${method.attachments.map((f) => f.title).join(', ')}.`
              : 'No dish on this site’s menu has allergens recorded in Blueroll yet. Add allergens to the menu, or attach your allergen matrix.'}
          </div>
        </div>
      ))}

      {method.open.length > 0 && (
        <div className="pd-open plan-keep">
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: '#8a5a0c' }}>Still to complete</div>
          <ul>{method.open.map((o) => <li key={o.label}>{o.label}</li>)}</ul>
        </div>
      )}

      <ProofPanel proof={method.proof} period={period} />

      <SheetFooter doc={doc} note={`SFBB: ${method.sectionName} — ${method.name}`} />
    </section>
  )
}
