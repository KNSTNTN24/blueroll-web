import { describe, it, expect } from 'vitest'
import { buildTelegramReminder, reminderSendFailure } from '../../../../supabase/functions/_shared/channels/tg-reminder'
import type { DueChecklist, Template } from '../../../../supabase/functions/_shared/checklists-core/types'

const tpl = (id: string, name: string): Template => ({
  id, business_id: 'b', site_id: null, name, frequency: 'daily', deadline_time: '10:00',
  multi_per_day: false, min_per_day: null, assigned_roles: [], assigned_role_ids: ['r'], active: true,
})
const due = (id: string, name: string, deadline: string): DueChecklist =>
  ({ template: tpl(id, name), site_id: 's1', deadline_utc: deadline, period_key: '2026-10-14', overdue: false })
const URL = 'https://app.blueroll.app/tg/form'
const job = (items: DueChecklist[]) => ({ external_id: '123456789', siteName: 'Wharf Side', tz: 'Europe/London', items })
// deno-lint-ignore no-explicit-any
type Any = any

describe('buildTelegramReminder', () => {
  it('single check: "<name> is due at <HH:MM> at <site>." with one Fill in web_app button', () => {
    const m: Any = buildTelegramReminder(job([due('t1', 'Fridge temps', '2026-10-14T09:00:00Z')]), new Map([['t1', 'tok1']]))
    expect(m.chat_id).toBe('123456789')
    expect(m.text).toBe('Fridge temps is due at 10:00 at Wharf Side.')
    expect(m.reply_markup.inline_keyboard).toEqual([[{ text: 'Fill in Fridge temps', web_app: { url: `${URL}?t=tok1` } }]])
  })

  it('several checks: count, site, names with times; one button per checklist', () => {
    const items = [due('t1', 'Fridge temps', '2026-10-14T09:00:00Z'), due('t2', 'Opening checks', '2026-10-14T09:15:00Z')]
    const m: Any = buildTelegramReminder(job(items), new Map([['t1', 'a'], ['t2', 'b']]))
    expect(m.text).toBe('2 checks due at Wharf Side: Fridge temps (10:00), Opening checks (10:15)')
    expect(m.reply_markup.inline_keyboard).toEqual([
      [{ text: 'Fill in Fridge temps', web_app: { url: `${URL}?t=a` } }],
      [{ text: 'Fill in Opening checks', web_app: { url: `${URL}?t=b` } }],
    ])
  })

  it('checklist without a token (required photo) → no button, "app only" in the text', () => {
    const items = [due('t1', 'Fridge temps', '2026-10-14T09:00:00Z'), due('t2', 'Delivery', '2026-10-14T09:15:00Z')]
    const m: Any = buildTelegramReminder(job(items), new Map<string, string | null>([['t1', 'a'], ['t2', null]]))
    expect(m.text).toBe('2 checks due at Wharf Side: Fridge temps (10:00), Delivery (10:15, app only)')
    expect(m.reply_markup.inline_keyboard).toHaveLength(1)
    expect(m.reply_markup.inline_keyboard[0][0].text).toBe('Fill in Fridge temps')
  })

  it('single app-only check → plain text, no keyboard', () => {
    const m: Any = buildTelegramReminder(job([due('t2', 'Delivery', '2026-10-14T09:15:00Z')]), new Map())
    expect(m.text).toBe('Delivery is due at 10:15 at Wharf Side. It can only be completed in the Blueroll app.')
    expect(m.reply_markup).toBeUndefined()
  })

  it('button titles are at most 64 characters', () => {
    const long = 'Very long checklist name '.repeat(5)
    const m: Any = buildTelegramReminder(job([due('t1', long, '2026-10-14T09:00:00Z')]), new Map([['t1', 'x']]))
    const title: string = m.reply_markup.inline_keyboard[0][0].text
    expect([...title].length).toBeLessThanOrEqual(64)
    expect(title.startsWith('Fill in Very long')).toBe(true)
  })

  it('token is URL-encoded', () => {
    const m: Any = buildTelegramReminder(job([due('t1', 'A', '2026-10-14T09:00:00Z')]), new Map([['t1', 'a b']]))
    expect(m.reply_markup.inline_keyboard[0][0].web_app.url).toBe(`${URL}?t=a%20b`)
  })
})

describe('reminderSendFailure', () => {
  it('Telegram 403 (bot blocked / user deactivated) → revoke the identity, keep the keys', () => {
    expect(reminderSendFailure('telegram', 403)).toBe('revoke')
  })
  it('anything else → release the keys for a retry', () => {
    expect(reminderSendFailure('telegram', 429)).toBe('release')
    expect(reminderSendFailure('telegram', 0)).toBe('release')
    expect(reminderSendFailure('telegram', 400)).toBe('release')
    expect(reminderSendFailure('whatsapp', 403)).toBe('release')
  })
})
