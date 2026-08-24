import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { Providers } from '@/components/providers'
import './globals.css'

// Single product typeface — Geist (see FONTS.md). No secondary or mono family.
const geist = Geist({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-geist',
})

export const metadata: Metadata = {
  title: 'Blueroll — HACCP Management',
  description: 'Digital HACCP management for food businesses',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={geist.variable} suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        {/* Demo-mode transition: painted before hydration so toggling demo
            reloads under one continuous overlay instead of a white flash.
            The DemoTransition component fades it out once the store settles. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=sessionStorage.getItem('br_demo_transition');if(!m)return;var on=m==='enter';var d=document.createElement('div');d.id='br-demo-boot';d.setAttribute('style','position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:'+(on?'#fdf9ee':'#fafbf8')+';opacity:1;transition:opacity .32s ease');d.innerHTML='<style>@keyframes brDemoDot{0%,100%{box-shadow:0 0 0 0 rgba(199,152,26,.32)}60%{box-shadow:0 0 0 5px rgba(199,152,26,0)}}</style><div style="display:flex;flex-direction:column;align-items:center;gap:14px;font-family:var(--font-geist),system-ui,sans-serif">'+(on?'<span style="display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid #e7d5a6;border-radius:8px;padding:6px 12px 6px 9px;box-shadow:0 1px 1.5px rgba(133,103,15,.07)"><span style="width:7px;height:7px;border-radius:50%;background:#c7981a;animation:brDemoDot 1.6s ease-out infinite"></span><span style="font-size:12.5px;font-weight:650;color:#85670f">Demo</span></span>':'')+'<span style="font-size:14px;font-weight:600;color:'+(on?'#6f5f36':'#5c626b')+'">'+(on?'Entering demo mode\\u2026':'Back to your kitchen\\u2026')+'</span></div>';document.documentElement.appendChild(d);}catch(e){}})();`,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
