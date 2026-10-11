import type { PlanDoc } from '@/lib/haccp-plan/types'
import { OGL_ATTRIBUTION } from '@/lib/haccp-plan/copy'
import { Logo, RunHead, SectionIcon, SheetFooter, fmtDate } from './parts'

const RATING_TEXT: Record<string, string> = { '5': 'Very good', '4': 'Good', '3': 'Generally satisfactory', '2': 'Improvement necessary', '1': 'Major improvement necessary', '0': 'Urgent improvement necessary' }

function StatusLine({ doc }: { doc: PlanDoc }) {
  if (doc.inspectionReady) return <span style={{ color: '#1f7a52' }}>Inspection-ready · {doc.filled} of {doc.total} points complete</span>
  if (!doc.signoff) return <span style={{ color: '#8a5a0c' }}>Draft — not signed off · {doc.pct}% complete</span>
  if (doc.signoff.editedAfter) return <span style={{ color: '#8a5a0c' }}>Edited after sign-off · {doc.pct}% complete</span>
  return <span style={{ color: '#8a5a0c' }}>{doc.pct}% complete · {doc.total - doc.filled} points open</span>
}

export function Cover({ doc, qrUrl }: { doc: PlanDoc; qrUrl?: string | null }) {
  return (
    <section className="plan-sheet pd-cover-sheet" aria-label="Cover">
      <div className="pd-cover-band">
        <div className="pd-row" style={{ alignItems: 'center' }}>
          <div className="pd-row-c">
            <Logo size={22} color="#ffffff" />
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.2 }}>Blueroll</span>
          </div>
          <span className="pd-cover-chip">Generated {fmtDate(doc.generatedAt)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.88)' }}>Food Safety Management System</div>
          <h1 className="pd-cover-title">HACCP Plan</h1>
          <p style={{ fontSize: 17, lineHeight: 1.5, color: 'rgba(255,255,255,0.92)', maxWidth: 520 }}>
            Based on the Food Standards Agency’s Safer Food, Better Business for Caterers. Kept live in Blueroll and backed by daily records.
          </p>
        </div>
      </div>

      <div className="pd-cover-body">
        <div className="pd-grid-2" style={{ gap: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="pd-sub" style={{ fontWeight: 600, letterSpacing: 1.4, textTransform: 'uppercase' }}>Food business</div>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.15 }}>{doc.businessName}</div>
            <div style={{ fontSize: 16, lineHeight: 1.5, color: '#3b3f47' }}>
              {doc.siteName && <>{doc.siteName}<br /></>}
              {doc.address}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '16px 20px', alignContent: 'start' }}>
            {doc.people.slice(0, 3).map((p) => (
              <div key={p.role} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div className="pd-sub">{p.role}</div>
                <div style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{p.name}</div>
              </div>
            ))}
            {doc.fsaRating && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div className="pd-sub">Food hygiene rating</div>
                <div className="pd-row-c" style={{ gap: 8 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 6, background: '#1f9d63', color: '#fff', fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{doc.fsaRating}</span>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{RATING_TEXT[doc.fsaRating] ?? ''}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="pd-box plan-keep" style={{ overflow: 'hidden', borderRadius: 12 }}>
          <div className="pd-row" style={{ alignItems: 'center', padding: '14px 20px', background: '#f6f7f8', borderBottom: '1px solid #d9dce1', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Plan status</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}><StatusLine doc={doc} /></div>
          </div>
          <div className="pd-grid-5" style={{ gap: 0 }}>
            {doc.sections.map((s) => (
              <div key={s.id} style={{ padding: '16px 16px 18px', borderRight: '1px solid #e9eaed', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="pd-row" style={{ alignItems: 'center' }}>
                  <SectionIcon icon={s.id} size={32} />
                  <span className="pd-sub" style={{ fontWeight: 600 }}>{s.num}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25, minHeight: 36 }}>{s.name}</div>
                <div style={{ height: 4, borderRadius: 9, background: '#e9eaed', overflow: 'hidden' }}>
                  <div style={{ height: 4, background: '#1f9d63', width: `${s.pct}%` }} />
                </div>
                <div style={{ fontSize: 12, color: '#3b3f47' }}>{s.pct}% · {s.num}.1–{s.num}.{s.methods.length}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: '2px solid #16181d', paddingTop: 14 }}>
            <div className="pd-sub" style={{ fontWeight: 600, letterSpacing: 1.4, textTransform: 'uppercase' }}>Signed off</div>
            <p style={{ fontSize: 15, lineHeight: 1.5 }}>This plan reflects how food is handled at this site. Reviewed every four weeks and after any change to menu, equipment or suppliers.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, fontSize: 13 }}>
              <div><div style={{ color: '#5f6670' }}>Signed by</div><div style={{ fontWeight: 600, marginTop: 3 }}>{doc.signoff?.name ?? 'Not yet'}</div></div>
              <div><div style={{ color: '#5f6670' }}>Last review</div><div style={{ fontWeight: 600, marginTop: 3 }}>{fmtDate(doc.review.lastAt)}</div></div>
              <div><div style={{ color: '#5f6670' }}>Next review</div><div style={{ fontWeight: 600, marginTop: 3, color: doc.review.overdue ? '#8a5a0c' : undefined }}>{doc.review.nextDue ? fmtDate(doc.review.nextDue) : 'Due now'}</div></div>
            </div>
          </div>
          {qrUrl && (
            <div className="pd-box" style={{ width: 200, padding: 14, display: 'flex', flexDirection: 'column', gap: 6, borderRadius: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Live records, read-only</div>
              <div style={{ fontSize: 11.5, lineHeight: 1.4, color: '#3b3f47', overflowWrap: 'anywhere' }}>{qrUrl}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export function AtAGlance({ doc }: { doc: PlanDoc }) {
  const open = doc.openPoints.slice(0, 8)
  return (
    <section className="plan-sheet" aria-labelledby="pd-glance">
      <RunHead doc={doc} right="At a glance" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 className="pd-h1" id="pd-glance">At a glance</h2>
        <p style={{ fontSize: 16, lineHeight: 1.55, color: '#3b3f47', maxWidth: 600 }}>What this plan covers, who is responsible, and what the last 28 days of records show.</p>
      </div>
      <div className="pd-grid-4 plan-keep">
        {doc.stats.map((s) => (
          <div key={s.label} className="pd-box" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.6, fontVariantNumeric: 'tabular-nums', color: s.tone === 'amber' ? '#8a5a0c' : undefined }}>{s.value}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
            <div className="pd-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700 }}>Contents</h3>
        <div style={{ borderTop: '1px solid #16181d' }}>
          {doc.sections.map((s) => (
            <a key={s.id} href={`#section-${s.id}`} style={{ display: 'grid', gridTemplateColumns: '40px minmax(0,1fr) auto', gap: 14, alignItems: 'center', padding: '11px 0', borderBottom: '1px solid #d9dce1', color: 'inherit', textDecoration: 'none' }}>
              <SectionIcon icon={s.id} size={40} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{s.num} · {s.name}</div>
                <div style={{ fontSize: 12, lineHeight: 1.45, color: '#5f6670' }}>{s.methods.map((m) => m.name).join(' · ')}</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: s.pct === 100 ? '#1f7a52' : '#8a5a0c', whiteSpace: 'nowrap' }}>
                {s.pct === 100 ? 'Complete' : `${s.total - s.filled} open`} · {s.num}.1–{s.num}.{s.methods.length}
              </div>
            </a>
          ))}
        </div>
      </div>

      <div className="pd-grid-2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700 }}>Who is responsible</h3>
          <div>
            {doc.people.length === 0 && <div className="pd-sub">Add owners and managers in Team.</div>}
            {doc.people.map((p) => (
              <div key={p.role} className="pd-row" style={{ padding: '9px 0', borderBottom: '1px solid #e9eaed', fontSize: 13 }}>
                <span style={{ color: '#5f6670' }}>{p.role}</span>
                <span style={{ fontWeight: 600, textAlign: 'right', overflowWrap: 'anywhere' }}>{p.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700 }}>Open points</h3>
          {open.length === 0 ? (
            <div style={{ fontSize: 13, color: '#1f7a52', fontWeight: 600 }}>Nothing open.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {open.map((o, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 12px', borderRadius: 8, background: '#fbf1e1', fontSize: 13, lineHeight: 1.45 }}>
                  <span style={{ fontWeight: 700, color: '#8a5a0c', whiteSpace: 'nowrap' }}>{o.ref}</span>
                  <span>{o.label}</span>
                </div>
              ))}
              {doc.openPoints.length > open.length && <div className="pd-sub">+{doc.openPoints.length - open.length} more, listed under each method</div>}
            </div>
          )}
        </div>
      </div>
      <SheetFooter doc={doc} />
    </section>
  )
}

export function CorrectivePage({ doc }: { doc: PlanDoc }) {
  return (
    <section className="plan-sheet" aria-labelledby="pd-corrective">
      <RunHead doc={doc} right="Corrective actions" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="pd-kicker">Prove it · last 28 days</div>
        <h2 className="pd-h1" id="pd-corrective">Corrective actions</h2>
        <p className="pd-text-2">Every reading that was out of range, and what happened next.</p>
      </div>
      {doc.corrective.length === 0 ? (
        <div className="pd-box" style={{ padding: 16, fontSize: 14, color: '#1f7a52', fontWeight: 600 }}>No out-of-range readings in the last 28 days.</div>
      ) : (
        <div className="pd-box pd-scroll-x" style={{ overflow: 'hidden' }}>
          <table className="pd-table">
            <thead><tr><th>Date</th><th>Check</th><th>Item</th><th>Reading</th><th>Action</th><th>By</th></tr></thead>
            <tbody>
              {doc.corrective.map((c, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtDate(c.at, { day: '2-digit', month: 'short' })}</td>
                  <td>{c.template}</td>
                  <td>{c.item}{c.notes ? <div className="pd-sub">{c.notes}</div> : null}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{c.value ?? '—'}</td>
                  <td style={{ fontWeight: 600, color: c.status === 'done' ? '#1f7a52' : '#8a5a0c' }}>{c.status === 'done' ? 'Corrected' : 'Open'}</td>
                  <td>{c.by ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SheetFooter doc={doc} />
    </section>
  )
}

export function SignoffPage({ doc }: { doc: PlanDoc }) {
  const where = `${doc.businessName}${doc.siteName ? `, ${doc.siteName}` : ''}`
  return (
    <section className="plan-sheet" aria-labelledby="pd-signoff">
      <RunHead doc={doc} right="Review & sign-off" />
      <div className="pd-row-c" style={{ gap: 16 }}>
        <SectionIcon icon="management" size={56} tone="solid" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="pd-kicker">Management</div>
          <h2 className="pd-h1" id="pd-signoff">Review &amp; sign-off</h2>
        </div>
      </div>
      <p className="pd-text-2">We review this plan every four weeks, and straight away when the menu, equipment, suppliers or staff change.</p>

      <div className="pd-grid-2">
        <div className="pd-box" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="pd-sub">Last 4-weekly review</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtDate(doc.review.lastAt)}</div>
          <div className="pd-sub">{doc.review.lastBy ? `by ${doc.review.lastBy}` : 'No review recorded yet'}</div>
        </div>
        <div className="pd-box" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="pd-sub">Next review due</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: doc.review.overdue ? '#8a5a0c' : undefined }}>{doc.review.nextDue ? fmtDate(doc.review.nextDue) : 'Now'}</div>
          <div className="pd-sub">{doc.review.overdue ? 'Overdue' : 'On schedule'}</div>
        </div>
      </div>

      {doc.signoff?.editedAfter && (
        <div style={{ background: '#fbf1e1', color: '#8a5a0c', borderRadius: 10, padding: '12px 14px', fontSize: 13.5, fontWeight: 600 }}>
          The plan was edited after it was signed off. A manager should review it and sign again.
        </div>
      )}

      <div className="plan-keep" style={{ border: '1px solid #16181d', borderRadius: 12, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="pd-sub" style={{ fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase' }}>Declaration</div>
        <p style={{ fontSize: 16, lineHeight: 1.6 }}>
          I confirm that this food safety management system has been put in place at {where}, that staff have been trained in the safe methods that apply to their work, and that it will be reviewed at least every four weeks.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 600, borderBottom: '1px solid #16181d', paddingBottom: 6, minHeight: 28 }}>{doc.signoff?.name ?? ''}</div>
            <div className="pd-sub">Name</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 600, borderBottom: '1px solid #16181d', paddingBottom: 6, minHeight: 28 }}>{doc.signoff ? fmtDate(doc.signoff.at, { day: 'numeric', month: 'long', year: 'numeric' }) : ''}</div>
            <div className="pd-sub">Date</div>
          </div>
        </div>
        <div className="pd-sub" style={{ lineHeight: 1.45 }}>
          {doc.signoff ? 'Signed in Blueroll. Any edit after sign-off is flagged until a manager signs again.' : 'Not yet signed off in Blueroll.'}
        </div>
      </div>

      <p className="pd-sub" style={{ lineHeight: 1.5 }}>{OGL_ATTRIBUTION}</p>
      <SheetFooter doc={doc} />
    </section>
  )
}
