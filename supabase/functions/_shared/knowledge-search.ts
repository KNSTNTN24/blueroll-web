// supabase/functions/_shared/knowledge-search.ts
// Keyword search over knowledge chunks. No imports — loaded by Deno and Vitest.
import type { KnowledgeChunk } from './knowledge.ts'

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'do', 'does', 'i', 'my', 'we',
  'our', 'how', 'what', 'when', 'should', 'can', 'it', 'be', 'with', 'at', 'often', 'much', 'many', 'you', 'your', 'need'])

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9°\-\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w))
}
const stem = (w: string) => w.replace(/(ing|ion|ed|es|s)$/, '')

export function searchKnowledge(chunks: KnowledgeChunk[], query: string, k = 3): KnowledgeChunk[] {
  const q = tokens(query).map(stem)
  if (!q.length) return []
  const scored = chunks.map((c) => {
    const tagSet = new Set(c.tags.flatMap((t) => tokens(t)).map(stem))
    const titleSet = new Set(tokens(c.title).map(stem))
    const textSet = new Set(tokens(c.text).map(stem))
    let score = 0
    for (const w of q) score += (tagSet.has(w) ? 3 : 0) + (titleSet.has(w) ? 2 : 0) + (textSet.has(w) ? 1 : 0)
    return { c, score }
  })
  return scored.filter((s) => s.score >= 3).sort((a, b) => b.score - a.score).slice(0, k).map((s) => s.c)
}
