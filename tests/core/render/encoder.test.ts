import { describe, expect, test } from 'vitest'
import { AUTO_BG, CellEncoder, HALF_BLOCK, REPLACEMENT, TEXT_BG_DIM, TextLayer, isPrintableWidth1, packRgb } from '../../../src/plugin/core/render/encoder'
import { PixelBuffer, dot } from '../../../src/plugin/core/render/framebuffer'
import { TerminalRasterRenderer } from '../../../src/plugin/core/render/terminal-raster'
import { radarTheme } from '../../../src/plugin/core/render/themes/radar'
import { cracktroTheme } from '../../../src/plugin/core/render/themes/cracktro'
import { decodeCells, fixtureScene } from './fixtures'

const setPx = (fb: PixelBuffer, x: number, y: number, r: number, g: number, b: number) => dot(fb, x, y, [r, g, b])

describe('half-block encoding', () => {
  test('top pixel is the foreground, bottom pixel the background, code point U+2580', () => {
    const fb = new PixelBuffer(2, 4)
    setPx(fb, 0, 0, 255, 0, 0)
    setPx(fb, 0, 1, 0, 0, 255)
    setPx(fb, 1, 2, 10, 20, 30)
    setPx(fb, 1, 3, 300, -5, 127.9)
    const words = decodeCells(new CellEncoder(2, 2).encode(fb, new TextLayer(2, 2)))
    expect(words.length).toBe(2 * 2 * 3)
    expect([...words.slice(0, 3)]).toEqual([HALF_BLOCK, 0xff0000, 0x0000ff])
    expect([...words.slice(3, 6)]).toEqual([HALF_BLOCK, 0, 0])
    expect([...words.slice(9, 12)]).toEqual([HALF_BLOCK, 0x0a141e, 0xff007f])
  })

  test('cells decode to columns*rows u32 triplets, little-endian, standard padded base64', () => {
    const fb = new PixelBuffer(3, 2)
    setPx(fb, 2, 0, 1, 2, 3)
    const cells = new CellEncoder(3, 1).encode(fb, new TextLayer(3, 1))
    expect(cells).toMatch(/^[A-Za-z0-9+/]*={0,2}$/)
    expect(cells.length % 4).toBe(0)
    const buf = Buffer.from(cells, 'base64')
    expect(buf.length).toBe(3 * 1 * 12)
    expect(buf.readUInt32LE(24)).toBe(HALF_BLOCK)
    expect(buf.readUInt32LE(28)).toBe(0x010203)
  })

  test('rejects a framebuffer of the wrong size', () => {
    expect(() => new CellEncoder(2, 2).encode(new PixelBuffer(2, 2), new TextLayer(2, 2))).toThrow()
  })
})

describe('text overlay cells', () => {
  test('replace pixels; the background is the dimmed mean of the two pixels', () => {
    const fb = new PixelBuffer(2, 2)
    setPx(fb, 0, 0, 200, 100, 0)
    setPx(fb, 0, 1, 0, 100, 200)
    const text = new TextLayer(2, 1)
    text.put(0, 0, 'A', 0xffffff)
    const w = decodeCells(new CellEncoder(2, 1).encode(fb, text))
    const mean = (a: number, b: number) => Math.floor(((a + b) / 2) * TEXT_BG_DIM)
    expect(w[0]).toBe(0x41)
    expect(w[1]).toBe(0xffffff)
    expect(w[2]).toBe(packRgb([mean(200, 0), mean(100, 100), mean(0, 200)]))
    expect(w[3]).toBe(HALF_BLOCK)
  })

  test('an explicit background wins over the dimmed mean', () => {
    const text = new TextLayer(1, 1)
    text.put(0, 0, 'x', 0x112233, 0x445566)
    const w = decodeCells(new CellEncoder(1, 1).encode(new PixelBuffer(1, 2), text))
    expect([...w]).toEqual([0x78, 0x112233, 0x445566])
  })

  test('put clips to the layer and to the column window, and clear resets it', () => {
    const text = new TextLayer(4, 1)
    expect(text.put(2, 0, 'abcdef', 1)).toBe(4)
    text.put(-1, 0, 'zy', 1, AUTO_BG, 0, 1)
    expect([...text.cp]).toEqual([0x79, 0, 0x61, 0x62])
    text.clear()
    expect([...text.cp]).toEqual([0, 0, 0, 0])
  })

  test('wide, astral, combining and control characters are replaced', () => {
    const text = new TextLayer(8, 1)
    text.put(0, 0, '漢😀́\u0007✅e', 1)
    expect([...text.cp.slice(0, 6)]).toEqual([REPLACEMENT, REPLACEMENT, REPLACEMENT, REPLACEMENT, REPLACEMENT, 0x65])
  })

  test('the verdict and chrome glyphs are printable width-1', () => {
    for (const ch of '✔◆✖▲●○⚠·≈—▀ $…→') expect(isPrintableWidth1(ch.codePointAt(0)!), ch).toBe(true)
  })
})

describe('every rendered code point is printable width-1', () => {
  for (const theme of [radarTheme, cracktroTheme]) {
    for (const [columns, rows] of [[120, 36], [70, 24], [40, 12]] as const) {
      test(`${theme.id} ${columns}x${rows}`, () => {
        const r = new TerminalRasterRenderer()
        r.mount({ columns, rows }, theme)
        const frame = r.frame(fixtureScene({ fault: true, demo: true }), 1500)
        const w = decodeCells(frame.cells)
        expect(w.length).toBe(columns * rows * 3)
        for (let i = 0; i < w.length; i += 3) {
          expect(isPrintableWidth1(w[i]!)).toBe(true)
          expect(w[i + 1]! >>> 24).toBe(0)
          expect(w[i + 2]! >>> 24).toBe(0)
        }
      })
    }
  }
})
