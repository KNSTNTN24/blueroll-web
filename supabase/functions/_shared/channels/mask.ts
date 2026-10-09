export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, '')
  if (d.length < 6) return '+••'
  return `+${d.slice(0, 2)} ${d.slice(2, 3)}••• ••${d.slice(-2)}`
}

/** Log-safe external id per channel: phone numbers via maskPhone; Telegram user ids as 'tg:••<last 3>'. */
export function maskId(channel: 'whatsapp' | 'telegram', externalId: string): string {
  if (channel === 'whatsapp') return maskPhone(externalId)
  const d = externalId.replace(/\D/g, '')
  return d.length < 6 ? 'tg:••' : `tg:••${d.slice(-3)}`
}
