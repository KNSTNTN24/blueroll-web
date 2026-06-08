export const MAX_RECIPE_IMAGES = 5

export interface ImageInput { base64: string; mime: string }

export async function fileToImageInput(file: File): Promise<ImageInput> {
  const buffer = await file.arrayBuffer()
  const base64 = btoa(
    new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
  )
  return { base64, mime: file.type || 'image/jpeg' }
}
