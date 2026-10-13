import { afterEach, expect, test, vi } from 'vitest'
import { draw } from '../../../src/plugin/core/scene/prng'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

test('the pure-JS path (no TextDecoder, as in a bare runtime) matches Node', async () => {
  vi.stubGlobal('TextDecoder', undefined)
  vi.resetModules()
  const { toBase64 } = await import('../../../src/plugin/core/render/base64')
  for (const n of [0, 1, 2, 3, 20_000, 51_840]) {
    const b = Uint8Array.from(draw(n + 1, n).values, (v) => Math.floor(v * 256))
    expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'))
  }
})
