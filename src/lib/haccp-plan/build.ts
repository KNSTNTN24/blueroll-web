import { HACCP_METHODS, type HaccpField, type SectionId } from '@/lib/haccp-pack/methods'
import { computeAutoData, AUTO_SOURCE_LABEL } from '@/lib/haccp-pack/auto-data'
import { menuHasAllergens, packFields } from '@/lib/haccp-pack/scope'
import { resolveAllergens } from '@/lib/dishes'
import { ALLERGEN_LABELS, type EUAllergen } from '@/lib/constants'
import { METHOD_COPY, SECTION_NAME, SECTION_ORDER } from './copy'
import { mergeDays, proofForMethod } from './proof-map'
import type { PackData, PlanAnswer, PlanBundle, PlanDoc, PlanMethod, PlanSection } from './types'

const DAY_MS = 86_400_000
const SIGNOFF_TOLERANCE_MS = 60_000

function parseFileRef(raw: string | undefined): { id: string; title: string } | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.id && parsed?.title) return { id: String(parsed.id), title: String(parsed.title) }
  } catch {
    // Old placeholder format — not a document reference.
  }
  return null
}

function slug(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Address + postcode, without repeating a postcode the address line already ends with or contains. */
function joinAddress(address: string | null, postcode: string | null): string | null {
  const norm = (x: string) => x.replace(/\s+/g, '').toUpperCase()
  if (address && postcode && norm(address).includes(norm(postcode))) return address
  return [address, postcode].filter(Boolean).join(', ') || null
}

const label = (a: string) => ALLERGEN_LABELS[a as EUAllergen] ?? a

/** Effective value of a text/select field: manual wins, else auto when allowed. */
function answerFor(field: HaccpField, data: PackData, auto: Record<string, string>): PlanAnswer | null {
  const manual = (field.type === 'select' ? data.selects[field.id] : data.texts[field.id]) ?? ''
  if (manual.trim()) return { label: field.label, value: manual, autoLabel: null }
  if (field.autoSource && !data.overrides[field.id] && auto[field.id]) {
    return { label: field.label, value: auto[field.id], autoLabel: AUTO_SOURCE_LABEL[field.id] ?? 'Auto-filled' }
  }
  return null
}

export function buildPlan(bundle: PlanBundle, now: Date = new Date()): PlanDoc {
  const data = bundle.pack.data
  const auto = bundle.business.autoFill ? computeAutoData(bundle.sources) : {}
  const scope = { menuHasAllergens: menuHasAllergens(bundle.sources.dishes, bundle.site?.id ?? null) }

  let filled = 0
  let total = 0
  const sections: PlanSection[] = SECTION_ORDER.map((sectionId: SectionId, si) => {
    const methods = HACCP_METHODS.filter((m) => m.section === sectionId)
    let sFilled = 0
    let sTotal = 0
    const planMethods: PlanMethod[] = methods.map((m, mi) => {
      const ref = `${si + 1}.${mi + 1}`
      const copy = METHOD_COPY[m.id]
      const fields = packFields(m, scope)
      const toggles = fields.filter((f) => f.type === 'toggle')
      const doList: string[] = []
      const answers: PlanAnswer[] = []
      const attachments: { title: string }[] = []
      const open: { ref: string; label: string }[] = []
      let otherFilled = 0
      // Attached documents show even when the pack no longer asks for them.
      for (const f of m.fields) {
        if (f.type !== 'file' || fields.includes(f)) continue
        const ref = parseFileRef(data.files[f.id])
        if (ref) attachments.push({ title: ref.title })
      }
      for (const f of fields) {
        let isFilled = false
        if (f.type === 'toggle') {
          isFilled = data.toggles[f.id] === true
          if (isFilled) doList.push(f.label)
        } else if (f.type === 'file') {
          const ref = parseFileRef(data.files[f.id])
          isFilled = !!ref
          if (ref) attachments.push({ title: ref.title })
        } else {
          const a = answerFor(f, data, auto)
          isFilled = !!a
          if (a) answers.push(a)
        }
        if (!isFilled) open.push({ ref, label: f.label })
        else if (f.type !== 'toggle') otherFilled++
        sTotal++
        if (isFilled) sFilled++
      }
      const inPlace = doList.length
      const nonToggle = fields.length - toggles.length
      let status: PlanMethod['status']
      if (toggles.length) status = inPlace === toggles.length ? 'in_place' : inPlace === 0 ? 'open' : 'partial'
      else status = otherFilled === nonToggle ? 'in_place' : otherFilled === 0 ? 'open' : 'partial'
      return {
        id: m.id, ref, name: m.name, section: sectionId, sectionName: SECTION_NAME[sectionId],
        safetyPoint: copy.safetyPoint, why: copy.why, infographic: copy.infographic,
        inPlace, toggleTotal: toggles.length, status, doList, answers, attachments, open,
        proof: proofForMethod(m.id, bundle.proof),
      }
    })
    filled += sFilled
    total += sTotal
    return {
      id: sectionId, num: si + 1, name: SECTION_NAME[sectionId], filled: sFilled, total: sTotal,
      pct: sTotal ? Math.round((sFilled / sTotal) * 100) : 0, methods: planMethods,
    }
  })
  const pct = total ? Math.round((filled / total) * 100) : 0

  // ── Sign-off and review ──
  const signoff = bundle.signoff
    ? {
        name: bundle.signoff.signedByName ?? 'Unknown',
        at: bundle.signoff.signedAt,
        editedAfter: !!bundle.pack.updatedAt &&
          new Date(bundle.pack.updatedAt).getTime() > new Date(bundle.signoff.signedAt).getTime() + SIGNOFF_TOLERANCE_MS,
      }
    : null
  const lastAt = bundle.proof.lastReview?.at ?? bundle.business.lastReviewedAt
  const lastBy = bundle.proof.lastReview ? bundle.proof.lastReview.by : null
  const nextDue = lastAt ? new Date(new Date(lastAt.slice(0, 10) + 'T00:00:00Z').getTime() + 28 * DAY_MS).toISOString().slice(0, 10) : null
  const review = { lastAt: lastAt ?? null, lastBy, nextDue, overdue: nextDue ? now.toISOString().slice(0, 10) > nextDue : true }

  // ── Stats ──
  const allDays = mergeDays(bundle.proof.templates.map((t) => t.days))
  const daysRecorded = allDays.filter((d) => d === 'ok' || d === 'flagged' || d === 'corrected').length
  const flagged = bundle.proof.templates.reduce((n, t) => n + t.flagged, 0)
  const corrected = bundle.proof.templates.reduce((n, t) => n + t.corrected, 0)
  const trainingDocs = bundle.sources.documents.filter((d) => d.category === 'training' || d.category === 'certificate').length
  const stats: PlanDoc['stats'] = [
    { value: `${pct}%`, label: 'Plan complete', sub: `${filled} of ${total} points`, tone: 'default' },
    { value: `${daysRecorded}/28`, label: 'Days recorded', sub: 'Any check completed', tone: 'default' },
    { value: String(flagged), label: 'Out-of-range readings', sub: `${corrected} corrected`, tone: flagged > corrected ? 'amber' : 'default' },
    { value: String(trainingDocs), label: 'Training documents', sub: 'Certificates on file', tone: 'default' },
  ]

  // ── People ──
  const people: PlanDoc['people'] = []
  if (bundle.people.operator) people.push({ role: 'Food business operator', name: bundle.people.operator })
  if (bundle.people.siteManager) people.push({ role: 'Site manager', name: bundle.people.siteManager })
  const trField = HACCP_METHODS.find((m) => m.id === 'training')!.fields.find((f) => f.id === 'tr_responsible')!
  const tr = answerFor(trField, data, auto)
  if (tr) people.push({ role: 'Responsible for training', name: tr.value })

  const openPoints = sections.flatMap((s) => s.methods.flatMap((m) => m.open.map((o) => ({ ref: o.ref, method: m.name, label: o.label }))))

  // ── Allergen matrix ──
  const site = bundle.site
  const dishes = bundle.sources.dishes
    .filter((d) => d.active && (!site || !Array.isArray(d.site_ids) || d.site_ids.length === 0 || d.site_ids.includes(site.id)))
    .map((d) => ({ name: d.name, allergens: resolveAllergens(d).map(label), mayContain: (d.may_contain ?? []).map(label) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // ── Cleaning frequency ──
  const cleaning = bundle.sources.templates.filter((t) => t.sfbb_section === 'cleaning' || /clean/i.test(t.name))
  const bucket = (freqs: string[]) => cleaning.filter((t) => freqs.includes(t.frequency)).map((t) => t.name)
  const cleaningFrequency = [
    { label: 'After use / as needed', items: bucket(['custom']) },
    { label: 'Daily', items: bucket(['daily']) },
    { label: 'Weekly', items: bucket(['weekly']) },
    { label: 'Monthly', items: bucket(['monthly', 'four_weekly']) },
  ].map((b) => ({ ...b, count: b.items.length }))

  const businessName = bundle.business.name
  const siteName = site?.name ?? null
  return {
    businessName, siteName,
    address: joinAddress(site?.address ?? bundle.business.address, site?.postcode ?? bundle.business.postCode),
    fsaRating: site?.fsaRating ?? bundle.business.fsaRating,
    generatedAt: bundle.generatedAt, periodStart: bundle.periodStart, periodEnd: bundle.periodEnd,
    filled, total, pct,
    inspectionReady: pct >= 90 && !!signoff && !signoff.editedAfter,
    menuHasAllergens: scope.menuHasAllergens,
    sections, stats, people, openPoints,
    corrective: bundle.proof.corrective,
    review, signoff, dishes, cleaningFrequency,
    footerLabel: `${businessName}${siteName ? ' · ' + siteName : ''} — HACCP Plan`,
    fileName: `HACCP-Plan-${slug(businessName)}${siteName ? '-' + slug(siteName) : ''}-${bundle.generatedAt.slice(0, 10)}.pdf`,
  }
}
