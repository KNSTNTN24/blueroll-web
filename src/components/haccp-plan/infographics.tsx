import { ALLERGEN_LABELS, EU_ALLERGENS } from '@/lib/constants'
import type { PlanDoc } from '@/lib/haccp-plan/types'

/* Static SFBB infographics + the two data-driven ones (cleaning frequency, allergen matrix). */

export function TempScale() {
  const segs = [
    { w: 2, c: '#2f4a63' }, { w: 18, c: '#c9d3dc' }, { w: 5, c: '#1f9d63' },
    { w: 3, c: '#a8d8bf' }, { w: 55, c: '#e0a43a' }, { w: 17, c: '#1f7a52' },
  ]
  const ticks = [['−18', 0], ['0', 19.2], ['5', 24.2], ['8', 27.4], ['63', 81.6], ['75 °C', 93.6]] as const
  return (
    <div
      className="plan-keep"
      role="img"
      aria-label="Temperature scale: freezer at minus 18 or below, fridge 0 to 5, legal maximum 8, danger zone 8 to 63, hot holding 63 and above, cook to 75"
      style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
    >
      <div style={{ position: 'relative', height: 16, fontSize: 11.5, fontWeight: 700 }}>
        <span style={{ position: 'absolute', left: 0, color: '#2f4a63' }}>Freezer</span>
        <span style={{ position: 'absolute', left: '19%', color: '#1f7a52' }}>Fridge 0–5</span>
        <span style={{ position: 'absolute', left: '46%', color: '#8a5a0c' }}>Danger zone</span>
        <span style={{ position: 'absolute', right: 0, color: '#1f7a52' }}>Hot ≥ 63</span>
      </div>
      <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden' }}>
        {segs.map((s, i) => <div key={i} style={{ width: `${s.w}%`, background: s.c }} />)}
      </div>
      <div style={{ position: 'relative', height: 14, fontSize: 11.5, color: '#3b3f47', fontVariantNumeric: 'tabular-nums' }}>
        {ticks.map(([t, l]) => <span key={t} style={{ position: 'absolute', left: `${l}%` }}>{t}</span>)}
      </div>
    </div>
  )
}

const COMBOS = [
  { temp: '60 °C', time: '45 min', w: '100%' },
  { temp: '65 °C', time: '10 min', w: '42%' },
  { temp: '70 °C', time: '2 min', w: '20%' },
  { temp: '75 °C', time: '30 sec', w: '10%', ours: true },
  { temp: '80 °C', time: '6 sec', w: '4%' },
]

export function CookCombos() {
  return (
    <div
      className="plan-keep"
      role="img"
      aria-label="Core temperature and time combinations: 60 degrees for 45 minutes, 65 for 10 minutes, 70 for 2 minutes, 75 for 30 seconds, 80 for 6 seconds"
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '56px minmax(0,1fr) 72px', gap: 10, fontSize: 11.5, fontWeight: 700, color: '#5f6670' }}>
        <span>Core</span><span>Hold for at least</span><span style={{ textAlign: 'right' }}>Time</span>
      </div>
      {COMBOS.map((c) => (
        <div key={c.temp} style={{ display: 'grid', gridTemplateColumns: '56px minmax(0,1fr) 72px', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: c.ours ? '#1f7a52' : '#16181d', fontVariantNumeric: 'tabular-nums' }}>{c.temp}</span>
          <div style={{ height: 14, background: '#f1f2f4', borderRadius: 7, overflow: 'hidden' }}>
            <div style={{ height: 14, borderRadius: 7, width: c.w, background: c.ours ? '#1f7a52' : '#a8d8bf' }} />
          </div>
          <span style={{ fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.time}</span>
        </div>
      ))}
      <div style={{ fontSize: 12, color: '#3b3f47' }}>Our standard: <strong>75 °C</strong> core, checked with a probe.</div>
    </div>
  )
}

const STEPS = [
  { n: '1', value: '≥ 75 °C', label: 'Cook — core temperature, probed', dot: '#1f7a52', line: '#1f7a52', fg: '#1f7a52' },
  { n: '2', value: '≥ 63 °C', label: 'Hot hold — checked every 2 hours', dot: '#1f7a52', line: '#1f7a52', fg: '#1f7a52' },
  { n: '3', value: '2 hours', label: 'Max once below 63 °C, then discard', dot: '#c8861a', line: '#c8861a', fg: '#8a5a0c' },
  { n: '4', value: '90 min', label: 'Chill leftovers within, or discard', dot: '#2f4a63', line: 'transparent', fg: '#2f4a63' },
]

export function PanToPass() {
  return (
    <div className="plan-keep" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 className="pd-h2">From pan to pass</h3>
      <div
        className="pd-grid-4"
        style={{ gap: 0 }}
        role="img"
        aria-label="Cook to 75 degrees, hold at 63 or above, at most 2 hours once below 63, chill leftovers within 90 minutes"
      >
        {STEPS.map((s) => (
          <div key={s.n} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 12, paddingBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ width: 28, height: 28, borderRadius: 99, background: s.dot, color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{s.n}</span>
              <span style={{ flex: 1, height: 2, background: s.line }} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.3, color: s.fg }}>{s.value}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.4, color: '#3b3f47' }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TwoStageClean() {
  const clean = { bg: '#f1f2f4', fg: '#3b3f47', stage: 'Clean' }
  const dis = { bg: '#e9f4ee', fg: '#1f7a52', stage: 'Disinfect' }
  const steps = [
    { n: '1', title: 'Pre-clean', body: 'Scrape off food and loose dirt.', ...clean },
    { n: '2', title: 'Clean', body: 'Hot water and detergent remove grease.', ...clean },
    { n: '3', title: 'Rinse', body: 'Clean water removes detergent.', ...clean },
    { n: '4', title: 'Disinfect', body: 'Apply sanitiser; leave for the contact time on the label.', ...dis },
    { n: '5', title: 'Dry', body: 'Air-dry or single-use paper towel.', ...dis },
  ]
  return (
    <div className="plan-keep" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="pd-row">
        <h3 className="pd-h2">The two-stage clean</h3>
        <span className="pd-sub">Sanitiser to BS EN 1276 or BS EN 13697</span>
      </div>
      <div className="pd-grid-5" role="img" aria-label="Five steps: pre-clean, clean with hot soapy water, rinse, disinfect for the contact time, dry">
        {steps.map((s) => (
          <div key={s.n} style={{ borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6, background: s.bg }}>
            <div className="pd-row" style={{ alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: s.fg }}>{s.n}</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: s.fg }}>{s.stage}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>{s.title}</div>
            <div style={{ fontSize: 12, lineHeight: 1.4, color: '#3b3f47' }}>{s.body}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CleaningFrequency({ buckets }: { buckets: PlanDoc['cleaningFrequency'] }) {
  if (!buckets.some((b) => b.count)) return null
  const max = Math.max(4, ...buckets.map((b) => b.count))
  return (
    <div className="plan-keep" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="pd-row">
        <h3 className="pd-h2">How often</h3>
        <span className="pd-sub">From cleaning checklists in Blueroll</span>
      </div>
      <div className="pd-grid-4" role="img" aria-label={buckets.map((b) => `${b.count} ${b.label}`).join(', ')}>
        {buckets.map((b) => (
          <div key={b.label} className="pd-box" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="pd-row">
              <span style={{ fontSize: 13, fontWeight: 700 }}>{b.label}</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#1f7a52' }}>{b.count}</span>
            </div>
            <div style={{ display: 'flex', gap: 3 }}>
              {Array.from({ length: max }, (_, i) => (
                <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i < b.count ? '#1f9d63' : '#e9eaed' }} />
              ))}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.4, color: '#3b3f47' }}>{b.items.join(', ') || '—'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AllergenMatrix({ dishes }: { dishes: PlanDoc['dishes'] }) {
  const cols = EU_ALLERGENS.map((a) => ALLERGEN_LABELS[a])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="pd-row">
        <h3 className="pd-h2">Allergen matrix</h3>
        <span className="pd-sub">From the menu in Blueroll · {dishes.length} {dishes.length === 1 ? 'dish' : 'dishes'}</span>
      </div>
      {dishes.length === 0 ? (
        <div className="pd-box" style={{ padding: 14, fontSize: 13, color: '#5f6670' }}>No dishes on this site’s menu yet.</div>
      ) : (
        <div className={`pd-box pd-scroll-x${dishes.length <= 30 ? ' plan-keep' : ''}`}>
          <table className="pd-matrix">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 10px', verticalAlign: 'bottom', minWidth: 150 }}>Dish</th>
                {cols.map((c) => <th key={c} className="pd-vert"><span>{c}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {dishes.map((d) => (
                <tr key={d.name}>
                  <td style={{ fontWeight: 600 }}>{d.name}</td>
                  {cols.map((c) => (
                    <td key={c} className="pd-cell">
                      {d.allergens.includes(c) ? <span className="pd-has" aria-label="contains" /> : d.mayContain.includes(c) ? <span className="pd-trace" aria-label="may contain">T</span> : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pd-legend">
        <span><i style={{ background: '#16181d', borderRadius: 3 }} />Contains</span>
        <span><b style={{ color: '#8a5a0c' }}>T</b>May contain traces</span>
      </div>
    </div>
  )
}
