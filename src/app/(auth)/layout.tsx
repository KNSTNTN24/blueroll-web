'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

// Brand panel content can be customized per page
interface BrandContent {
  headline: string
  subtitle: string
}

const BrandContext = createContext<{
  content: BrandContent
  setContent: (c: BrandContent) => void
}>({
  content: {
    headline: 'Pass every inspection. Without the paperwork.',
    subtitle: 'Digital checklists, AI recipe import, and one-tap compliance reports.',
  },
  setContent: () => {},
})

export function useBrand() {
  return useContext(BrandContext)
}

// BlueRoll "b" logo as inline SVG
function LogoMark({ className = '', white = false }: { className?: string; white?: boolean }) {
  return (
    <svg viewBox="100 50 370 430" fill="none" className={className}>
      {white ? (
        <path
          d="M241 97V203.426C254.606 198.617 269.247 196 284.5 196C356.573 196 415 254.427 415 326.5C415 398.573 356.573 457 284.5 457C212.594 457 154.272 398.843 154.003 327H154V97H241ZM284.5 283C260.476 283 241 302.476 241 326.5C241 350.524 260.476 370 284.5 370C308.524 370 328 350.524 328 326.5C328 302.476 308.524 283 284.5 283Z"
          fill="white"
        />
      ) : (
        <>
          <defs>
            <linearGradient id="logoGrad" x1="284.5" y1="97" x2="284.5" y2="457" gradientUnits="userSpaceOnUse">
              <stop stopColor="#006A4C" />
              <stop offset="1" stopColor="#003526" />
            </linearGradient>
          </defs>
          <path
            d="M241 97V203.426C254.606 198.617 269.247 196 284.5 196C356.573 196 415 254.427 415 326.5C415 398.573 356.573 457 284.5 457C212.594 457 154.272 398.843 154.003 327H154V97H241ZM284.5 283C260.476 283 241 302.476 241 326.5C241 350.524 260.476 370 284.5 370C308.524 370 328 350.524 328 326.5C328 302.476 308.524 283 284.5 283Z"
            fill="url(#logoGrad)"
          />
        </>
      )}
    </svg>
  )
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<BrandContent>({
    headline: 'Pass every inspection. Without the paperwork.',
    subtitle: 'Digital checklists, AI recipe import, and one-tap compliance reports.',
  })

  return (
    <BrandContext.Provider value={{ content, setContent }}>
      <div className="flex min-h-screen bg-[#fafafa]">
        {/* Left — Brand panel (hidden on mobile) */}
        <div className="relative hidden w-[45%] shrink-0 flex-col justify-between overflow-hidden p-[60px_72px] lg:flex"
          style={{ background: 'linear-gradient(170deg, #059669 0%, #047857 40%, #065f46 100%)' }}
        >
          {/* Decorative orbs */}
          <div className="pointer-events-none absolute -right-[10%] top-[10%] h-[450px] w-[450px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(52,211,153,0.15) 0%, transparent 65%)' }}
          />
          <div className="pointer-events-none absolute -left-[15%] bottom-[5%] h-[350px] w-[350px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 65%)' }}
          />

          {/* Logo */}
          <div className="relative z-10 flex items-center gap-3.5">
            <LogoMark className="h-[38px] w-auto opacity-90" white />
            <span className="text-[22px] font-semibold tracking-tight text-white/90">
              BlueRoll
            </span>
          </div>

          {/* Headline */}
          <div className="relative z-10">
            <h1 className="max-w-[400px] text-[44px] font-extrabold leading-[1.1] tracking-[-1.5px] text-white">
              {content.headline}
            </h1>
            <p className="mt-5 max-w-[340px] text-[17px] leading-relaxed text-white/60">
              {content.subtitle}
            </p>
          </div>

          {/* Trust line */}
          <div className="relative z-10 flex items-center gap-2.5 text-[13px] font-medium text-white/45">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/60" />
            Trusted by restaurants and cafés across the UK, US &amp; Europe
          </div>
        </div>

        {/* Right — Form */}
        <div className="flex flex-1 flex-col">
          {/* Mobile logo (hidden on desktop) */}
          <div className="flex items-center gap-2.5 p-6 pb-0 lg:hidden">
            <LogoMark className="h-7 w-auto" />
            <span className="text-lg font-bold tracking-tight text-gray-900">
              BlueRoll
            </span>
          </div>

          <div className="flex flex-1 items-center justify-center px-6 py-8 lg:px-14">
            <div className="w-full max-w-[420px]">{children}</div>
          </div>
        </div>
      </div>
    </BrandContext.Provider>
  )
}
