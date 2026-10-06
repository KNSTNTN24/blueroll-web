// supabase/functions/_shared/knowledge-search.ts
// BM25 keyword search over knowledge chunks. Type-only import — loaded by Deno and Vitest.
import type { KnowledgeChunk } from './knowledge.ts'

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'do', 'does', 'i', 'my', 'we',
  'our', 'how', 'what', 'when', 'should', 'can', 'it', 'be', 'with', 'at', 'often', 'much', 'many', 'you', 'your', 'need',
  'this', 'that', 'these', 'those', 'there', 'their', 'they', 'them', 'from', 'by', 'as', 'if', 'not', 'into', 'about', 'any',
  'all', 'have', 'has', 'was', 'were', 'will', 'would', 'could', 'me', 'us', 'which', 'who', 'where', 'why', 'than', 'then',
  'so', 'also', 'up', 'out', 'more', 'some', 'such', 'other', 'e.g', 'eg', 'etc', 'get', 'keep', 'make', 'sure', 'use', 'used',
  'please', 'tell', 'way', 'one', 'very', 'just', 'too', 'only', 'its', 'own', 'same', 'each', 'every'])

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9°\-\s]/g, ' ').replace(/-/g, ' ').split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
}

// Light suffix stripping: the same word family maps to one stem on both the query and chunk side.
const SUFFIXES = ['ations', 'ation', 'ings', 'ing', 'ions', 'ion', 'ness', 'ated', 'ates', 'ate', 'edly', 'ed', 'ers', 'er',
  'ors', 'or', 'ly', 'es', 's']
const STEM_EXCEPTIONS: Record<string, string> = { clothes: 'clothing', clothing: 'clothing', news: 'news' }
export function stem(word: string): string {
  if (STEM_EXCEPTIONS[word]) return STEM_EXCEPTIONS[word]
  let w = word
  if (w.length <= 3 || /^\d/.test(w)) return w
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  for (const suf of SUFFIXES) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) { w = w.slice(0, -suf.length); break }
  }
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1)
  if (/([b-df-hj-kmnp-rtv-z])\1$/.test(w) && w.length > 3) w = w.slice(0, -1)
  return w
}

// Kitchen synonyms: a query word also matches the other words of its group, at reduced weight.
const SYNONYM_GROUPS = [
  ['extractor', 'extraction', 'extract', 'canopy', 'hood', 'filter', 'fan', 'vent', 'ventilation'],
  ['fridge', 'refrigerator', 'refrigeration', 'chiller', 'chilled'],
  ['probe', 'thermometer'],
  ['clean', 'cleaning', 'sanitise', 'sanitiser', 'sanitize', 'sanitizer', 'disinfect', 'disinfectant'],
  ['ill', 'illness', 'sick', 'sickness', 'unwell', 'diarrhoea', 'diarrhea', 'vomiting', 'vomit'],
  ['allergen', 'allergy', 'allergies', 'allergic'],
]
const SYNONYM_WEIGHT = 0.5
let synonymIndex: Map<string, string[]> | null = null
function synonymsOf(term: string): string[] {
  if (!synonymIndex) {
    synonymIndex = new Map()
    for (const group of SYNONYM_GROUPS) {
      const stems = [...new Set(group.map(stem))]
      for (const s of stems) synonymIndex.set(s, stems.filter((x) => x !== s))
    }
  }
  return synonymIndex.get(term) ?? []
}

// BM25 over the body text, plus a BM25F-style heading bonus: a query term found in the chunk's title or tags adds
// HEADING_BOOST × its idf over headings only (so "diary" still counts even though many bodies mention the diary).
const K1 = 1.2
const B = 0.75
const HEADING_BOOST = 1.5
// Minimum best score for any result. Unrelated questions score 0 or close to it.
const MIN_SCORE = 4

type Doc = { chunk: KnowledgeChunk; tf: Map<string, number>; len: number; heading: Set<string> }
interface Index { docs: Doc[]; idf: Map<string, number>; headingIdf: Map<string, number>; avgLen: number }
const cache = new WeakMap<KnowledgeChunk[], Index>()

const idfOf = (n: number, df: number) => Math.log(1 + (n - df + 0.5) / (df + 0.5))

function buildIndex(chunks: KnowledgeChunk[]): Index {
  const df = new Map<string, number>()
  const hdf = new Map<string, number>()
  const docs = chunks.map((chunk): Doc => {
    const tf = new Map<string, number>()
    const body = tokens(chunk.text).map(stem)
    for (const s of body) tf.set(s, (tf.get(s) ?? 0) + 1)
    for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1)
    const heading = new Set(tokens(`${chunk.title} ${chunk.tags.join(' ')}`).map(stem))
    for (const term of heading) hdf.set(term, (hdf.get(term) ?? 0) + 1)
    return { chunk, tf, len: body.length, heading }
  })
  const n = docs.length
  const idf = new Map<string, number>()
  for (const [term, d] of df) idf.set(term, idfOf(n, d))
  const headingIdf = new Map<string, number>()
  for (const [term, d] of hdf) headingIdf.set(term, idfOf(n, d))
  const avgLen = docs.reduce((acc, d) => acc + d.len, 0) / Math.max(1, n)
  return { docs, idf, headingIdf, avgLen }
}

function indexFor(chunks: KnowledgeChunk[]): Index {
  let idx = cache.get(chunks)
  if (!idx) { idx = buildIndex(chunks); cache.set(chunks, idx) }
  return idx
}

/** All chunks with a positive BM25 score for the query, best first. */
export function rankKnowledge(chunks: KnowledgeChunk[], query: string): { chunk: KnowledgeChunk; score: number }[] {
  // One concept per distinct query stem: the stem itself (weight 1) or any of its synonyms (weight 0.5).
  // A concept scores the best of its terms, so a synonym group never counts several times over.
  const concepts: Map<string, number>[] = []
  const seen = new Set<string>()
  for (const t of tokens(query)) {
    const s = stem(t)
    if (seen.has(s)) continue
    seen.add(s)
    const terms = new Map<string, number>([[s, 1]])
    for (const syn of synonymsOf(s)) if (!terms.has(syn)) terms.set(syn, SYNONYM_WEIGHT)
    concepts.push(terms)
  }
  if (!concepts.length || !chunks.length) return []
  const { docs, idf, headingIdf, avgLen } = indexFor(chunks)
  const termScore = (d: Doc, term: string) => {
    const f = d.tf.get(term)
    let sc = f ? (idf.get(term) ?? 0) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.len / avgLen)) : 0
    if (d.heading.has(term)) sc += HEADING_BOOST * (headingIdf.get(term) ?? 0)
    return sc
  }
  const scored = docs.map((d) => {
    let score = 0
    let matched = 0
    for (const terms of concepts) {
      let best = 0
      for (const [term, w] of terms) best = Math.max(best, w * termScore(d, term))
      score += best
      if (best > 0) matched++
    }
    // Coverage: a chunk that matches every concept of the question beats one that matches a common word many times.
    return { chunk: d.chunk, score: score * (matched / concepts.length) }
  })
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)
}

export function searchKnowledge(chunks: KnowledgeChunk[], query: string, k = 4): KnowledgeChunk[] {
  return rankKnowledge(chunks, query).filter((s) => s.score >= MIN_SCORE).slice(0, k).map((s) => s.chunk)
}
