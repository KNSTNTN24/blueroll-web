import type { Metadata, Viewport } from 'next'

// Bare layout for the Telegram Mini App: no app chrome, no auth (the root layout's Providers don't redirect).
export const metadata: Metadata = {
  title: 'Blueroll checklist',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function TgLayout({ children }: { children: React.ReactNode }) {
  return children
}
