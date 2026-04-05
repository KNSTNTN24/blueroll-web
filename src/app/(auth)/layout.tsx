export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      {/* Left — Brand panel */}
      <div className="hidden w-[480px] shrink-0 flex-col justify-between bg-emerald-600 p-10 lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-sm font-bold text-white">
            B
          </div>
          <span className="text-lg font-semibold text-white">Blueroll</span>
        </div>
        <div>
          <h2 className="text-2xl font-semibold leading-tight text-white">
            Digital food safety
            <br />
            for modern kitchens
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            Replace paper HACCP records with smart checklists, AI recipe import,
            allergen tracking, and EHO-ready compliance reports.
          </p>
        </div>
        <p className="text-[12px] text-white/50">
          Trusted by restaurants across the UK
        </p>
      </div>

      {/* Right — Auth form */}
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-[400px]">{children}</div>
      </div>
    </div>
  )
}
