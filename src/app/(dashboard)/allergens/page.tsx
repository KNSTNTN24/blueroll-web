'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { Search, Download, Printer, Check, Plus, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InspectionEmpty, EmptyPrimary, EmptySecondary, AllergenArt } from '@/components/shared/inspection-empty'
import {
  EU_ALLERGENS,
  ALLERGEN_LABELS,
  type EUAllergen,
} from '@/lib/constants'

/** 3-letter codes, aligned to EU_ALLERGENS order. */
const ALLERGEN_CODES: Record<EUAllergen, string> = {
  gluten: 'GLU', crustaceans: 'CRU', eggs: 'EGG', fish: 'FSH',
  peanuts: 'PNT', soybeans: 'SOY', milk: 'MLK', nuts: 'NUT',
  celery: 'CEL', mustard: 'MUS', sesame: 'SES', sulphites: 'SUL',
  lupin: 'LUP', molluscs: 'MOL',
}

function getAllergens(recipe: any): string[] {
  const set = new Set<string>()
  recipe.recipe_ingredients?.forEach((ri: any) => {
    ri.ingredient?.allergens?.forEach((a: string) => set.add(a))
  })
  return Array.from(set)
}

export default function AllergensPage() {
  const business = useAuthStore((s) => s.business)
  const router = useRouter()
  const [search, setSearch] = useState('')

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ['allergen-recipes', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('recipes')
        .select(`*, recipe_ingredients ( ingredient:ingredients (name, allergens) )`)
        .eq('business_id', business.id)
        .eq('active', true)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const enriched = useMemo(
    () => recipes.map((r: any) => ({ ...r, _allergens: getAllergens(r) })),
    [recipes]
  )
  const filtered = useMemo(
    () => enriched.filter((r: any) => !search || r.name.toLowerCase().includes(search.toLowerCase())),
    [enriched, search]
  )

  // Column totals (across all active recipes, not just the search subset)
  const colTotals = useMemo(() => {
    const t: Record<string, number> = {}
    EU_ALLERGENS.forEach((a) => { t[a] = enriched.filter((r: any) => r._allergens.includes(a)).length })
    return t
  }, [enriched])
  const maxCol = Math.max(1, ...Object.values(colTotals))

  function exportCSV() {
    const header = ['Recipe', ...EU_ALLERGENS.map((a) => ALLERGEN_LABELS[a])]
    const rows = filtered.map((r: any) => [
      r.name,
      ...EU_ALLERGENS.map((a) => (r._allergens.includes(a) ? 'Y' : '')),
    ])
    const csv = [header, ...rows].map((row) => row.map((c: string) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'allergen-matrix.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function handlePrint() {
    const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
    const CHECK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#c8861a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 12 10 16 18 7"></polyline></svg>'
    const gen = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    const isHot = (a: EUAllergen) => colTotals[a] >= maxCol * 0.55 && colTotals[a] > 0

    const headCells = EU_ALLERGENS.map((a) =>
      `<th class="al${isHot(a) ? ' hot' : ''}" title="${esc(ALLERGEN_LABELS[a])}"><span class="code">${ALLERGEN_CODES[a]}</span><span class="cnt">${colTotals[a]}</span></th>`
    ).join('')

    const bodyRows = filtered.map((r: any) => {
      const count = r._allergens.length
      const cells = EU_ALLERGENS.map((a) => r._allergens.includes(a)
        ? `<td class="c"><span class="tile">${CHECK}</span></td>`
        : `<td class="c"><span class="dot"></span></td>`).join('')
      const total = count ? `<td class="tot"><span class="tnum">${count}</span></td>` : `<td class="tot"><span class="free">Free</span></td>`
      return `<tr><td class="rec"><span class="lead" style="background:${count ? '#e7c79a' : '#1f9d63'}"></span>${esc(r.name)}</td>${cells}${total}</tr>`
    }).join('')

    const footCells = EU_ALLERGENS.map((a) => {
      const cls = colTotals[a] === 0 ? 'z' : isHot(a) ? 'h' : 'm'
      return `<td class="pa ${cls}">${colTotals[a]}</td>`
    }).join('')

    const legend = EU_ALLERGENS.map((a) =>
      `<div class="lg"><span class="lgc">${ALLERGEN_CODES[a]}</span><span>${esc(ALLERGEN_LABELS[a])}</span></div>`).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(business?.name ?? 'Blueroll')} — Allergen Matrix</title>
    <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { font-family: 'Geist', system-ui, -apple-system, sans-serif; color: #16181d; background: #fff; padding: 20px; }
      h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
      .sub { font-size: 11px; color: #6b7280; margin-top: 3px; }
      .keys { display: flex; gap: 18px; margin: 12px 0 14px; font-size: 10.5px; color: #6b7280; }
      .keys .k { display: inline-flex; align-items: center; gap: 6px; }
      .ktile { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 5px; background: #f6e6cf; }
      .kdot { width: 5px; height: 5px; border-radius: 50%; background: #e7e9ec; }
      table { width: 100%; border-collapse: collapse; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
      th, td { border-bottom: 1px solid #eef0f2; }
      th.rh { text-align: left; padding: 6px 8px; font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #8a9099; border-bottom: 1.5px solid #e9eaed; }
      th.al { padding: 4px 2px 6px; text-align: center; vertical-align: bottom; border-bottom: 1.5px solid #e9eaed; }
      th.al.hot { background: #fbf3e6; }
      th.al .code { display: block; font-size: 10px; font-weight: 600; letter-spacing: 0.03em; color: #1c1f24; }
      th.al.hot .code { color: #b07d1e; }
      th.al .cnt { display: block; font-size: 8.5px; color: #9aa0a8; margin-top: 1px; }
      th.th-tot { text-align: center; padding: 6px 8px; font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #8a9099; border-bottom: 1.5px solid #e9eaed; }
      td.rec { text-align: left; padding: 5px 8px; font-size: 11px; font-weight: 500; white-space: nowrap; }
      td.rec .lead { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
      td.c { text-align: center; padding: 4px 2px; }
      td.c .tile { display: inline-flex; align-items: center; justify-content: center; width: 21px; height: 21px; border-radius: 6px; background: #f6e6cf; }
      td.c .dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: #e7e9ec; }
      td.tot { text-align: center; padding: 5px 8px; }
      td.tot .tnum { font-size: 11px; font-weight: 600; color: #16181d; }
      td.tot .free { font-size: 11px; font-weight: 600; color: #1f7a52; }
      tfoot td { border-bottom: none; padding-top: 6px; }
      td.pa { text-align: center; font-size: 10px; font-weight: 600; }
      td.pa.z { color: #c2c6cc; } td.pa.h { color: #b07d1e; } td.pa.m { color: #8a9099; }
      td.pa-lbl { text-align: left; padding: 6px 8px; font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #8a9099; }
      .legend { margin-top: 20px; border: 1px solid #e9eaed; border-radius: 12px; padding: 14px 16px; }
      .legend h2 { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #8a9099; margin-bottom: 10px; }
      .lgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 22px; }
      .lg { display: flex; align-items: center; gap: 8px; font-size: 11px; }
      .lg .lgc { width: 34px; flex: none; font-size: 10px; font-weight: 600; color: #8a9099; }
      .foot { margin-top: 16px; font-size: 8.5px; color: #b0b5bc; text-align: center; }
      @page { size: A4 landscape; margin: 10mm; }
    </style></head><body>
      <h1>${esc(business?.name ?? 'Allergen Matrix')}</h1>
      <div class="sub">EU 14 allergens across ${filtered.length} active recipes · Generated ${gen}</div>
      <div class="keys">
        <span class="k"><span class="ktile">${CHECK}</span> contains allergen</span>
        <span class="k"><span class="kdot"></span> free from</span>
      </div>
      <table>
        <thead><tr><th class="rh">Recipe</th>${headCells}<th class="th-tot">Total</th></tr></thead>
        <tbody>${bodyRows}</tbody>
        <tfoot><tr><td class="pa-lbl">Per allergen</td>${footCells}<td></td></tr></tfoot>
      </table>
      <div class="legend"><h2>Allergen codes</h2><div class="lgrid">${legend}</div></div>
      <div class="foot">Generated by Blueroll · blueroll.app</div>
      <script>window.onload=function(){(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(function(){setTimeout(function(){window.focus();window.print();},120);});};</script>
    </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-foreground">Allergen Matrix</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">EU 14 allergens across {enriched.length} active recipes</p>
        </div>
        {recipes.length > 0 && (
        <div className="flex items-center gap-2.5">
          <button onClick={exportCSV} className="inline-flex items-center gap-2 rounded-[11px] border border-input bg-card px-4 py-[11px] text-[14px] font-semibold text-foreground transition-colors hover:bg-accent">
            <Download className="h-4 w-4 text-brand" strokeWidth={1.8} /> CSV
          </button>
          <button onClick={handlePrint} className="inline-flex items-center gap-2 rounded-[11px] border border-input bg-card px-4 py-[11px] text-[14px] font-semibold text-foreground transition-colors hover:bg-accent">
            <Printer className="h-4 w-4" strokeWidth={1.8} /> PDF
          </button>
        </div>
        )}
      </div>

      {/* Toolbar: search + inline legend — hidden in the empty state */}
      {recipes.length > 0 && (
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative max-w-[380px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search recipes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-[38px] w-full rounded-[10px] border border-input bg-card pl-9 pr-3 text-[13px] text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:border-brand focus:ring-[3px] focus:ring-[rgba(31,157,99,.12)]"
          />
        </div>
        <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] bg-[#f6e6cf] text-amber"><Check className="h-2.5 w-2.5" strokeWidth={3} /></span>
            contains allergen
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[5px] w-[5px] rounded-full bg-[#e7e9ec]" /> free from
          </span>
        </div>
      </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">Loading allergen data…</div>
      ) : recipes.length === 0 ? (
        <InspectionEmpty illustration={AllergenArt} badge="The first thing inspectors check for allergens"
          title="Your allergen matrix builds itself"
          sentence="Add recipes and all 14 EU allergens map themselves — printable any time.">
          <EmptyPrimary onClick={() => router.push('/recipes/new')}><Plus className="h-4 w-4" strokeWidth={2} /> Add your first recipe</EmptyPrimary>
          <EmptySecondary onClick={() => router.push('/recipes/import')}><Sparkles className="h-4 w-4 text-brand" strokeWidth={1.8} /> Import menu with AI</EmptySecondary>
        </InspectionEmpty>
      ) : (
        <>
          {/* Matrix */}
          <div className="overflow-x-auto rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,.04)]">
            <table className="w-full border-collapse text-[13px]" style={{ minWidth: 1010 }}>
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 border-b border-border bg-card px-4 py-3 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Recipe</th>
                  {EU_ALLERGENS.map((a) => {
                    const hot = colTotals[a] >= maxCol * 0.55 && colTotals[a] > 0
                    return (
                      <th key={a} title={ALLERGEN_LABELS[a]}
                        className={cn('border-b border-border px-1 py-2.5 text-center align-bottom', hot && 'bg-[#fbf3e6]')}>
                        <span className={cn('block font-mono text-[11px] font-semibold tracking-wide', hot ? 'text-[#b07d1e]' : 'text-foreground')}>{ALLERGEN_CODES[a]}</span>
                        <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-muted-foreground">{colTotals[a]}</span>
                      </th>
                    )
                  })}
                  <th className="sticky right-0 z-20 border-b border-l border-border bg-card px-3 py-3 text-center font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={EU_ALLERGENS.length + 2} className="px-4 py-12 text-center text-[13px] text-muted-foreground">
                      No recipes match &ldquo;{search}&rdquo;.
                    </td>
                  </tr>
                ) : filtered.map((r: any) => {
                  const count = r._allergens.length
                  return (
                    <tr key={r.id} className="group">
                      <td className="sticky left-0 z-10 border-b border-border bg-card px-4 py-2.5 font-medium text-foreground group-hover:bg-[#fafbfb]">
                        <span className="flex items-center gap-2.5">
                          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', count ? 'bg-[#e7c79a]' : 'bg-brand')} />
                          <span className="truncate">{r.name}</span>
                        </span>
                      </td>
                      {EU_ALLERGENS.map((a) => (
                        <td key={a} className="border-b border-border px-1 py-2.5 text-center group-hover:bg-[#fafbfb]">
                          {r._allergens.includes(a) ? (
                            <span className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-[8px] bg-[#f6e6cf] text-[#c8861a]">
                              <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
                            </span>
                          ) : (
                            <span className="inline-block h-[5px] w-[5px] rounded-full bg-[#e7e9ec]" />
                          )}
                        </td>
                      ))}
                      <td className="sticky right-0 z-10 border-b border-l border-border bg-card px-3 py-2.5 text-center group-hover:bg-[#fafbfb]">
                        {count ? <span className="font-mono text-[12px] font-semibold tabular-nums text-foreground">{count}</span>
                          : <span className="text-[12px] font-semibold text-brand-deep">Free</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr>
                    <td className="sticky left-0 z-10 bg-card px-4 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Per allergen</td>
                    {EU_ALLERGENS.map((a) => {
                      const hot = colTotals[a] >= maxCol * 0.55 && colTotals[a] > 0
                      return (
                        <td key={a} className="px-1 py-2.5 text-center">
                          <span className={cn('font-mono text-[12px] font-semibold tabular-nums', colTotals[a] === 0 ? 'text-[#c2c6cc]' : hot ? 'text-[#b07d1e]' : 'text-muted-foreground')}>{colTotals[a]}</span>
                        </td>
                      )
                    })}
                    <td className="sticky right-0 z-10 border-l border-border bg-card px-3 py-2.5" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Legend */}
          <div className="rounded-[14px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
            <p className="mb-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Allergen codes</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
              {EU_ALLERGENS.map((a) => (
                <div key={a} className="flex items-center gap-2 text-[12.5px]">
                  <span className="w-9 shrink-0 font-mono text-[11px] font-semibold text-muted-foreground">{ALLERGEN_CODES[a]}</span>
                  <span className="text-foreground">{ALLERGEN_LABELS[a]}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
