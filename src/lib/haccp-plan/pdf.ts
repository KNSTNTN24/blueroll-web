// Server-side PDF of the HACCP Plan: headless Chromium opens the public print view
// (/plan/<token>?print=1) and prints it to A4. Node runtime only.

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function footerTemplate(label: string): string {
  return `<div style="font-family: system-ui, sans-serif; font-size: 8px; color: #5f6670; width: 100%; padding: 0 16mm; display: flex; justify-content: space-between;"><span>${esc(label)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
}

export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._-]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

/** Validity probe: the edge function checks the token without loading the plan or counting a view. */
export function planCheckUrl(supabaseUrl: string, token: string): string {
  return `${supabaseUrl}/functions/v1/haccp-plan?t=${token}&check=1`
}

/**
 * Best-effort per-instance throttle so one link can't keep Chromium busy in a loop.
 * Fluid Compute reuses instances, so this catches the common case without a store.
 */
export function makeRenderThrottle(windowMs: number) {
  const last = new Map<string, number>()
  return (token: string, now: number = Date.now()): boolean => {
    const prev = last.get(token)
    if (prev !== undefined && now - prev < windowMs) return false
    last.set(token, now)
    if (last.size > 500) for (const [k, v] of last) if (now - v >= windowMs) last.delete(k)
    return true
  }
}

export type RenderResult =
  | { status: 'ok'; pdf: Uint8Array; fileName: string }
  | { status: 'not_found' }
  | { status: 'timeout' }
  | { status: 'error' }

export async function renderPlanPdf(opts: { origin: string; token: string; bypassSecret?: string; timeoutMs?: number }): Promise<RenderResult> {
  const timeout = opts.timeoutMs ?? 25_000
  const puppeteer = (await import('puppeteer-core')).default
  const local = process.env.CHROME_EXECUTABLE_PATH
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
  try {
    if (local) {
      browser = await puppeteer.launch({ executablePath: local, headless: true })
    } else {
      const chromium = (await import('@sparticuz/chromium')).default
      browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true })
    }
    const page = await browser.newPage()
    await page.setViewport({ width: 1240, height: 1754 })
    if (opts.bypassSecret) await page.setExtraHTTPHeaders({ 'x-vercel-protection-bypass': opts.bypassSecret })
    await page.goto(`${opts.origin}/plan/${opts.token}?print=1`, { waitUntil: 'networkidle0', timeout })
    await page.waitForSelector('[data-plan-state="ready"],[data-plan-state="error"]', { timeout })
    const state = await page.$eval('[data-plan-state]', (el) => el.getAttribute('data-plan-state'))
    if (state !== 'ready') return { status: 'not_found' }
    const fileName = (await page.$eval('[data-plan-state]', (el) => el.getAttribute('data-plan-filename'))) || 'HACCP-Plan.pdf'
    const label = (await page.$eval('[data-plan-state]', (el) => el.getAttribute('data-plan-footer'))) || 'HACCP Plan'
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(label),
      margin: { top: '14mm', bottom: '18mm', left: '16mm', right: '16mm' },
    })
    return { status: 'ok', pdf, fileName }
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') return { status: 'timeout' }
    console.error('[haccp-plan pdf]', e instanceof Error ? e.message : e)
    return { status: 'error' }
  } finally {
    await browser?.close().catch(() => {})
  }
}
