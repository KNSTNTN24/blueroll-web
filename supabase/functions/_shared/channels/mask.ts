export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, '')
  if (d.length < 6) return '+••'
  return `+${d.slice(0, 2)} ${d.slice(2, 3)}••• ••${d.slice(-2)}`
}
