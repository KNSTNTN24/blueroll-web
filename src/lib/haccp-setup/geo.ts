// Postcode areas wholly or mainly in Scotland. TD is split: TD12, TD15 are England (Berwick area).
const SCOTTISH_AREAS = new Set(['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'TD', 'ZE'])
const ENGLISH_TD_DISTRICTS = new Set(['TD12', 'TD15'])

export function isScottishPostcode(postcode: string | null | undefined): boolean {
  if (!postcode) return false
  const outward = postcode.trim().toUpperCase().split(/\s+/)[0]
  const m = outward.match(/^([A-Z]{1,2})(\d)/)
  if (!m) return false
  const area = m[1]
  if (!SCOTTISH_AREAS.has(area)) return false
  if (area === 'TD') {
    const district = outward.match(/^TD\d{1,2}/)?.[0] ?? ''
    if (ENGLISH_TD_DISTRICTS.has(district)) return false
  }
  return true
}
