'use client'

import type { ReactNode } from 'react'

/**
 * Standard top-right primary action button — same size across every page
 * (matches the Team page's "Invite member"): green, 14px/600, 11px 17px, r11.
 */
export function HeaderButton({ children, onClick, type = 'button', disabled }: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', background: '#1f9d63', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, padding: '11px 17px', borderRadius: 11, cursor: disabled ? 'default' : 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)', opacity: disabled ? 0.55 : 1 }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = '#1c8e5a' }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = '#1f9d63' }}>
      {children}
    </button>
  )
}
