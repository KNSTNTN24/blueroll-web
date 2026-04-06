import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Left branding panel */}
      <div className="hidden w-1/2 flex-col justify-between bg-emerald-600 p-10 text-white lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/20 text-[14px] font-semibold">
            B
          </div>
          <span className="text-lg font-semibold">Blueroll</span>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            HACCP management,
            <br />
            simplified.
          </h2>
          <p className="mt-2 text-[14px] text-emerald-100">
            Digital checklists, allergen tracking, AI recipe import, and compliance reports
            — all in one place.
          </p>
        </div>
        <p className="text-[12px] text-emerald-200">
          Trusted by restaurants across the UK
        </p>
      </div>

      {/* Right form content */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[400px]">{children}</div>
      </div>
    </div>
  )
}
