import { describe, it, expect } from 'vitest'
import { waLink, maskNumber, CHANNELS, channelAvailable } from '../client'

describe('whatsapp client helpers', () => {
  it('wa.me link pre-fills LINK code', () => expect(waLink('447000000000', '012345')).toBe('https://wa.me/447000000000?text=LINK%20012345'))
  it('masks numbers', () => expect(maskNumber('447700900123')).toBe('+44 7••• ••23'))
  it('whatsapp channel config builds the wa.me link', () => {
    expect(CHANNELS.whatsapp.label).toBe('WhatsApp')
    // number is unset in tests -> no link (dialog shows the code only)
    expect(CHANNELS.whatsapp.buildLink('012345')).toBeNull()
  })
  it('telegram channel builds a t.me deep link and is never null', () => {
    expect(CHANNELS.telegram.label).toBe('Telegram')
    expect(CHANNELS.telegram.buildLink('012345')).toBe('https://t.me/BluerollChecksBot?start=012345')
    expect(CHANNELS.telegram.scanInstruction).toBe('Scan with the phone camera, then tap Start in Telegram.')
  })
  it('displayId is channel-aware', () => {
    expect(CHANNELS.whatsapp.displayId('447700900123')).toBe('+44 7••• ••23')
    expect(CHANNELS.telegram.displayId('123456789')).toBe('connected')
  })
  it('WhatsApp is offered only when the WhatsApp number is configured; Telegram always', () => {
    expect(channelAvailable('whatsapp', '')).toBe(false)
    expect(channelAvailable('whatsapp', '447000000000')).toBe(true)
    expect(channelAvailable('whatsapp')).toBe(false)   // unset in tests
    expect(channelAvailable('telegram', '')).toBe(true)
  })
})
