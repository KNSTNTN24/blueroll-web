import type { Metadata, Viewport } from 'next'

// Bare layout for the public HACCP Plan link: no app chrome, no auth, never indexed.
export const metadata: Metadata = {
  title: 'HACCP Plan',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return children
}
