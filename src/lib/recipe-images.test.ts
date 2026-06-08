import { describe, it, expect } from 'vitest'
import { fileToImageInput, MAX_RECIPE_IMAGES } from './recipe-images'

describe('recipe-images', () => {
  it('encodes a file to {base64, mime}', async () => {
    const f = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const out = await fileToImageInput(f)
    expect(out.mime).toBe('image/png')
    expect(typeof out.base64).toBe('string')
    expect(out.base64.length).toBeGreaterThan(0)
  })
  it('caps at 5', () => {
    expect(MAX_RECIPE_IMAGES).toBe(5)
  })
})
