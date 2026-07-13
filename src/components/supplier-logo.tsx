'use client'

import { useState } from 'react'

const COLORS = ['#1f7a52', '#5b6472', '#8a6d52', '#4e6e81']

function initials(name: string) {
  const parts = name.split(' ').filter(Boolean)
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase()
}

function colorFor(name: string) {
  const hash = Array.from(name).reduce((total, character) => total + character.charCodeAt(0), 0)
  return COLORS[hash % COLORS.length]
}

function fullBrandfetchLogo(logoUrl: string) {
  try {
    const url = new URL(logoUrl)
    if (url.hostname !== 'cdn.brandfetch.io' || !url.pathname.includes('/icon.')) return null
    const brandId = url.pathname.split('/').filter(Boolean)[0]
    const clientId = url.searchParams.get('c')
    if (!brandId || !clientId) return null
    return `https://cdn.brandfetch.io/${brandId}/w/256/h/128/fallback/404/logo.webp?c=${encodeURIComponent(clientId)}`
  } catch {
    return null
  }
}

export function SupplierLogo({ name, logoUrl, size = 36, width = Math.round(size * 1.45) }: { name: string; logoUrl?: string | null; size?: number; width?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const promotedLogoUrl = logoUrl ? fullBrandfetchLogo(logoUrl) : null
  const visibleLogoUrl = promotedLogoUrl && failedUrl !== promotedLogoUrl
    ? promotedLogoUrl
    : logoUrl && failedUrl !== logoUrl
      ? logoUrl
      : null

  if (visibleLogoUrl) {
    return (
      <span style={{ width, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flex: 'none' }}>
        <img
          src={visibleLogoUrl}
          alt={`${name} logo`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(visibleLogoUrl)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </span>
    )
  }

  return (
    <span style={{ width, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      <span style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 ${Math.max(11, Math.round(size * 0.33))}px 'Geist'`, background: colorFor(name) }}>
        {initials(name || '?')}
      </span>
    </span>
  )
}
