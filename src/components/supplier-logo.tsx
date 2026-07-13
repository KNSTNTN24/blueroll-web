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

export function SupplierLogo({ name, logoUrl, size = 36 }: { name: string; logoUrl?: string | null; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (logoUrl && failedUrl !== logoUrl) {
    return (
      <span style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), border: '1px solid #e9eaed', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: Math.max(4, Math.round(size * 0.12)), overflow: 'hidden', flex: 'none' }}>
        <img
          src={logoUrl}
          alt={`${name} logo`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(logoUrl)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </span>
    )
  }

  return (
    <span style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 ${Math.max(11, Math.round(size * 0.33))}px 'Geist'`, flex: 'none', background: colorFor(name) }}>
      {initials(name || '?')}
    </span>
  )
}
