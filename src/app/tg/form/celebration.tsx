'use client'

import { useMemo, type CSSProperties } from 'react'

// "Done" screen of the Telegram form: one of several short animations, picked at random, around a big emoji and a
// line of praise. Pure CSS (no libraries); with reduced motion only the static emoji and text are shown.

export const CELEBRATIONS = ['confetti', 'hearts', 'fireworks', 'stars', 'trophy'] as const
export type CelebrationKind = (typeof CELEBRATIONS)[number]

const HERO: Record<CelebrationKind, string> = { confetti: '🎉', hearts: '💚', fireworks: '🎆', stars: '🌟', trophy: '🏆' }
const PRAISE = ['Nice one!', 'Great job!', 'Thank you!', 'All recorded!', 'Well done!']
const COLORS = ['#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6']

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]
const rand = (a: number, b: number) => a + Math.random() * (b - a)
type Vars = CSSProperties & Record<`--${string}`, string>

function particles(kind: CelebrationKind): { key: number; style: Vars; content: string; className: string }[] {
  switch (kind) {
    case 'confetti':
      return Array.from({ length: 48 }, (_, i) => ({
        key: i, content: '', className: 'tgc-confetti',
        style: {
          left: `${rand(0, 100)}%`, background: pick(COLORS), width: `${rand(6, 10)}px`, height: `${rand(10, 16)}px`,
          animationDelay: `${rand(0, 0.5)}s`, '--dx': `${rand(-60, 60)}px`, '--rot': `${rand(360, 1080)}deg`,
        },
      }))
    case 'hearts':
      return Array.from({ length: 20 }, (_, i) => ({
        key: i, content: pick(['💚', '💖', '💛', '🧡', '💜']), className: 'tgc-heart',
        style: { left: `${rand(5, 95)}%`, fontSize: `${rand(20, 38)}px`, animationDelay: `${rand(0, 0.7)}s`, '--dx': `${rand(-40, 40)}px` },
      }))
    case 'fireworks':
      return [[30, 30, 0], [70, 25, 0.35], [50, 45, 0.7]].flatMap(([x, y, delay], b) =>
        Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * 2 * Math.PI
          const r = rand(70, 110)
          return {
            key: b * 100 + i, content: '', className: 'tgc-spark',
            style: {
              left: `${x}%`, top: `${y}%`, background: COLORS[(b * 3 + i) % COLORS.length], animationDelay: `${delay}s`,
              '--dx': `${Math.cos(a) * r}px`, '--dy': `${Math.sin(a) * r}px`,
            },
          }
        }))
    case 'stars':
      return Array.from({ length: 18 }, (_, i) => {
        const a = (i / 18) * 2 * Math.PI + rand(-0.15, 0.15)
        const r = rand(110, 170)
        return {
          key: i, content: pick(['⭐', '✨', '🌟']), className: 'tgc-star',
          style: { fontSize: `${rand(18, 30)}px`, animationDelay: `${rand(0, 0.25)}s`, '--dx': `${Math.cos(a) * r}px`, '--dy': `${Math.sin(a) * r}px` },
        }
      })
    case 'trophy':
      return Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * 2 * Math.PI
        return {
          key: i, content: '✨', className: 'tgc-star',
          style: { fontSize: '22px', animationDelay: '0.45s', '--dx': `${Math.cos(a) * 120}px`, '--dy': `${Math.sin(a) * 120}px` },
        }
      })
  }
}

const CSS = `
.tgc-layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.tgc-layer > span { position: absolute; display: block; opacity: 0; animation-fill-mode: forwards; animation-timing-function: ease-out; }
.tgc-confetti { top: -20px; border-radius: 2px; animation: tgc-fall 1.8s forwards; }
.tgc-heart { bottom: -40px; animation: tgc-rise 1.9s forwards; }
.tgc-spark { width: 7px; height: 7px; border-radius: 50%; animation: tgc-burst 1s forwards; }
/* bursts start at the hero emoji: main padding + mt-16 + half the emoji ≈ 120px */
.tgc-star { left: 50%; top: 120px; animation: tgc-burst 1.1s forwards; }
.tgc-hero { animation: tgc-pop 0.6s cubic-bezier(.2,1.6,.4,1) both; }
.tgc-hero.trophy { animation: tgc-bounce 0.9s cubic-bezier(.2,1.4,.4,1) both; }
.tgc-text { animation: tgc-fade 0.5s 0.25s both; }
@keyframes tgc-fall { 0% { opacity: 1; transform: translate(0, 0) rotate(0); } 100% { opacity: 0.9; transform: translate(var(--dx), 105vh) rotate(var(--rot)); } }
@keyframes tgc-rise { 0% { opacity: 0; transform: translate(0, 0) scale(.6); } 15% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--dx), -95vh) scale(1.1); } }
@keyframes tgc-burst { 0% { opacity: 1; transform: translate(-50%, -50%) scale(.3); } 70% { opacity: 1; } 100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1); } }
@keyframes tgc-pop { 0% { opacity: 0; transform: scale(.2); } 100% { opacity: 1; transform: scale(1); } }
@keyframes tgc-bounce { 0% { opacity: 0; transform: translateY(-60vh); } 60% { opacity: 1; transform: translateY(0) scale(1.15, .85); } 80% { transform: translateY(-14px); } 100% { transform: translateY(0); } }
@keyframes tgc-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .tgc-layer { display: none; } .tgc-hero, .tgc-text { animation: none; } }
`

export function Celebration({ kind }: { kind?: CelebrationKind }) {
  const { k, bits, praise } = useMemo(() => {
    const k = kind ?? pick(CELEBRATIONS)
    return { k, bits: particles(k), praise: pick(PRAISE) }
  }, [kind])
  return (
    <div className="mt-16 flex flex-col items-center text-center" role="status">
      <style>{CSS}</style>
      <div className="tgc-layer" aria-hidden>
        {bits.map((p) => <span key={p.key} className={p.className} style={p.style}>{p.content}</span>)}
      </div>
      <div className={`tgc-hero text-7xl ${k === 'trophy' ? 'trophy' : ''}`} aria-hidden>{HERO[k]}</div>
      <p className="tgc-text mt-4 text-xl font-semibold">Done ✓</p>
      <p className="tgc-text mt-1 text-base text-[var(--tg-hint,var(--muted-foreground))]">{praise}</p>
    </div>
  )
}
