import QRCode from 'qrcode'

/** QR modules for a URL (true = dark), rendered as plain SVG rects by the cover — no innerHTML. */
export function qrMatrix(text: string): boolean[][] {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = modules.size
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => !!modules.get(x, y)))
}
