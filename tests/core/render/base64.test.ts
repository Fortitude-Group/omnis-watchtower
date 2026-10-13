import { expect, test } from 'vitest'
import { toBase64 } from '../../../src/plugin/core/render/base64'
import { draw } from '../../../src/plugin/core/scene/prng'

const viaNode = (b: Uint8Array) => Buffer.from(b).toString('base64')

test.each([0, 1, 2, 3, 4, 5, 6])('matches Node for %i bytes', n => {
  const b = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255)
  expect(toBase64(b)).toBe(viaNode(b))
})

test('matches Node for 10 KB of seeded random bytes', () => {
  const b = Uint8Array.from(draw(123, 10_240).values, v => Math.floor(v * 256))
  expect(toBase64(b)).toBe(viaNode(b))
})

test('encodes a Raster cell triplet as the API example does', () => {
  const words = Uint32Array.of(0x2588, 0xff8800, 0x01000000)
  expect(toBase64(new Uint8Array(words.buffer))).toBe(viaNode(new Uint8Array(words.buffer)))
})
