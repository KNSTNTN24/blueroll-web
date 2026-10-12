import { describe, it, expect } from 'vitest'
import { maskNumber, channelAvailable } from '../client'

describe('whatsapp client helpers', () => {
  it('masks numbers', () => expect(maskNumber('447700900123')).toBe('+44 7••• ••23'))
  it('WhatsApp is offered only when the WhatsApp number is configured; Telegram always', () => {
    expect(channelAvailable('whatsapp', '')).toBe(false)
    expect(channelAvailable('whatsapp', '447000000000')).toBe(true)
    expect(channelAvailable('whatsapp')).toBe(false)   // unset in tests
    expect(channelAvailable('telegram', '')).toBe(true)
  })
})
