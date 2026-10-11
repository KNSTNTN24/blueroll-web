import { describe, it, expect } from 'vitest'
import { TOKEN_RE, footerTemplate, contentDisposition, makeRenderThrottle, planCheckUrl } from './pdf'

describe('pdf helpers', () => {
  it('validates tokens', () => {
    expect(TOKEN_RE.test('a'.repeat(43))).toBe(true)
    expect(TOKEN_RE.test('a'.repeat(42))).toBe(false)
    expect(TOKEN_RE.test('../../etc/passwd' + 'a'.repeat(27))).toBe(false)
  })
  it('escapes the footer label', () => {
    const f = footerTemplate('Tom & Jerry <Café>')
    expect(f).toContain('Tom &amp; Jerry &lt;Café&gt;')
    expect(f).toContain('class="pageNumber"')
    expect(f).toContain('class="totalPages"')
  })
  it('builds a safe content disposition', () => {
    expect(contentDisposition('HACCP-Plan-st-james-s-cafe.pdf')).toBe(`attachment; filename="HACCP-Plan-st-james-s-cafe.pdf"; filename*=UTF-8''HACCP-Plan-st-james-s-cafe.pdf`)
    expect(contentDisposition('a"b.pdf')).toContain('filename="a_b.pdf"')
  })
})

describe('render throttle', () => {
  it('allows one render per token per window', () => {
    const t = makeRenderThrottle(15_000)
    expect(t('tok-a', 1_000)).toBe(true)
    expect(t('tok-a', 5_000)).toBe(false)
    expect(t('tok-b', 5_000)).toBe(true)
    expect(t('tok-a', 16_001)).toBe(true)
  })
})

describe('check url', () => {
  it('asks the function to validate only', () => {
    expect(planCheckUrl('https://x.supabase.co', 'a'.repeat(43))).toBe(`https://x.supabase.co/functions/v1/haccp-plan?t=${'a'.repeat(43)}&check=1`)
  })
})
