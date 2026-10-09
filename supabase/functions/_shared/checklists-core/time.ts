// Timezone helpers without libraries: Intl gives local wall-clock parts; zonedToUtc solves for the UTC instant.
import type { Frequency } from './types.ts'

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

export function localParts(now: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    weekday: 'short', hourCycle: 'h23',
  })
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, weekday: WEEKDAY[p.weekday] }
}

export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  // Start from the wall time as if it were UTC, then correct by the zone offset at that instant (twice for DST edges).
  let guess = Date.UTC(y, m - 1, d, hh, mm)
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz)
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm)
    guess += Date.UTC(y, m - 1, d, hh, mm) - asUtc
  }
  return new Date(guess)
}

function addDays(y: number, m: number, d: number, days: number) {
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

function periodStartLocal(freq: Frequency, now: Date, tz: string) {
  const p = localParts(now, tz)
  if (freq === 'weekly') return addDays(p.y, p.m, p.d, -(p.weekday - 1))
  if (freq === 'four_weekly') return addDays(p.y, p.m, p.d, -(p.weekday - 1) - 21)
  if (freq === 'monthly') return { y: p.y, m: p.m, d: 1 }
  return { y: p.y, m: p.m, d: p.d }
}

export function periodStartUtc(freq: Frequency, now: Date, tz: string): Date {
  const s = periodStartLocal(freq, now, tz)
  return zonedToUtc(s.y, s.m, s.d, 0, 0, tz)
}

export function periodKey(freq: Frequency, now: Date, tz: string): string {
  const s = periodStartLocal(freq, now, tz)
  return `${s.y}-${String(s.m).padStart(2, '0')}-${String(s.d).padStart(2, '0')}`
}

export function deadlineUtc(deadlineTime: string | null, now: Date, tz: string): Date | null {
  if (!deadlineTime) return null
  const m = deadlineTime.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const p = localParts(now, tz)
  return zonedToUtc(p.y, p.m, p.d, +m[1], +m[2], tz)
}
