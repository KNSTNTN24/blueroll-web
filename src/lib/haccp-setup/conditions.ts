import type { Answers, Cond, Equipment } from './types'

export function evalCond(cond: Cond, answers: Answers): boolean {
  if ('always' in cond) return true
  if ('all' in cond) return cond.all.every((c) => evalCond(c, answers))
  if ('any' in cond) return cond.any.some((c) => evalCond(c, answers))
  if ('not' in cond) return !evalCond(cond.not, answers)
  if ('equipment' in cond) {
    const eq = answers.equipment
    return Array.isArray(eq) && (eq as Equipment[]).some((e) => typeof e === 'object' && cond.equipment.includes(e.kind))
  }
  const v = answers[cond.q]
  if ('has' in cond) return Array.isArray(v) && (v as unknown[]).includes(cond.has)
  return v === cond.eq
}

export function condRefs(cond: Cond): string[] {
  if ('always' in cond) return []
  if ('all' in cond) return cond.all.flatMap(condRefs)
  if ('any' in cond) return cond.any.flatMap(condRefs)
  if ('not' in cond) return condRefs(cond.not)
  if ('equipment' in cond) return ['equipment']
  return [cond.q]
}
