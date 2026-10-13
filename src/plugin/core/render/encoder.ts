// Framebuffer + text layer → Raster cells. Each cell is the upper half-block U+2580 with the top
// pixel as foreground and the bottom pixel as background. A text cell replaces both pixels; its
// background, unless set, is the dimmed mean of the two pixels it covers.

import { toBase64 } from './base64'
import type { Framebuffer, Rgb } from './renderer'

export const HALF_BLOCK = 0x2580
/** Raster's "terminal default" colour. */
export const DEFAULT_COLOR = 0x01000000
/** Text-layer background meaning "dimmed mean of the pixels underneath". */
export const AUTO_BG = 0xffffffff
export const TEXT_BG_DIM = 0.45
export const REPLACEMENT = 0x3f // '?'

const clamp8 = (v: number): number => (v <= 0 ? 0 : v >= 255 ? 255 : v | 0)

export const packRgb = (c: Rgb): number => ((clamp8(c[0]) << 16) | (clamp8(c[1]) << 8) | clamp8(c[2])) >>> 0

// East Asian Wide/Fullwidth blocks and BMP characters with default emoji presentation: all render
// two cells wide, which would shear the grid.
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x303e],
  [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
]

/** True when the code point is a printable, single-width BMP character Raster can show. */
export const isPrintableWidth1 = (cp: number): boolean => {
  if (cp < 0x20 || cp > 0xffff) return false
  if (cp >= 0x7f && cp <= 0x9f) return false
  if (cp >= 0xd800 && cp <= 0xdfff) return false
  if (cp === 0xad || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x206f)) return false
  if (cp >= 0xfe00 && cp <= 0xfe0f) return false
  if (cp === 0xfeff || cp === 0xfffe || cp === 0xffff || (cp >= 0xfff9 && cp <= 0xfffb)) return false
  if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe20 && cp <= 0xfe2f)) return false
  for (const [lo, hi] of WIDE) if (cp >= lo && cp <= hi) return false
  return true
}

/** Glyph cells drawn over the pixels. A code point of 0 means "no text here". */
export class TextLayer {
  readonly columns: number
  readonly rows: number
  readonly cp: Uint32Array
  readonly fg: Uint32Array
  readonly bg: Uint32Array

  constructor(columns: number, rows: number) {
    this.columns = columns
    this.rows = rows
    this.cp = new Uint32Array(columns * rows)
    this.fg = new Uint32Array(columns * rows)
    this.bg = new Uint32Array(columns * rows).fill(AUTO_BG)
  }

  clear(): void {
    this.cp.fill(0)
    this.bg.fill(AUTO_BG)
  }

  /** Writes `text` from (col,row), clipped to [minCol, maxCol). Returns the column after the text. */
  put(col: number, row: number, text: string, fg: number, bg: number = AUTO_BG, minCol = 0, maxCol = this.columns): number {
    if (row < 0 || row >= this.rows) return col
    const lo = Math.max(0, minCol)
    const hi = Math.min(this.columns, maxCol)
    let c = col
    for (const ch of text) {
      if (c >= hi) break
      if (c >= lo) {
        const cp = ch.codePointAt(0)!
        const i = row * this.columns + c
        this.cp[i] = isPrintableWidth1(cp) ? cp : REPLACEMENT
        this.fg[i] = fg
        this.bg[i] = bg
      }
      c++
    }
    return c
  }

  /** Paints a run of background-coloured spaces, e.g. a header or banner row. */
  band(row: number, bg: number, col = 0, width = this.columns): void {
    if (row < 0 || row >= this.rows) return
    const end = Math.min(this.columns, col + width)
    for (let c = Math.max(0, col); c < end; c++) {
      const i = row * this.columns + c
      this.cp[i] = 0x20
      this.fg[i] = bg
      this.bg[i] = bg
    }
  }
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

/** Reusable encoder: owns the output buffer so steady-state frames allocate only the base64 string. */
export class CellEncoder {
  readonly columns: number
  readonly rows: number
  private readonly bytes: Uint8Array
  private readonly words: Uint32Array | null
  private readonly view: DataView

  constructor(columns: number, rows: number) {
    this.columns = columns
    this.rows = rows
    this.bytes = new Uint8Array(columns * rows * 12)
    this.words = LITTLE_ENDIAN ? new Uint32Array(this.bytes.buffer) : null
    this.view = new DataView(this.bytes.buffer)
  }

  /** Fills the u32 triplets; exposed so tests can inspect cells without base64. */
  encodeWords(fb: Framebuffer, text: TextLayer): Uint8Array {
    const { columns, rows, words, view } = this
    if (fb.width !== columns || fb.height !== rows * 2) throw new Error(`framebuffer ${fb.width}x${fb.height} does not match ${columns}x${rows} cells`)
    const d = fb.data
    const tcp = text.cp
    const tfg = text.fg
    const tbg = text.bg
    const rowStride = columns * 3
    let o = 0
    for (let r = 0; r < rows; r++) {
      let top = r * 2 * rowStride
      let bot = top + rowStride
      for (let c = 0; c < columns; c++, top += 3, bot += 3, o += 3) {
        const ti = r * columns + c
        const cp = tcp[ti]!
        let code: number
        let fg: number
        let bg: number
        if (cp !== 0) {
          code = cp
          fg = tfg[ti]!
          bg = tbg[ti]!
          if (bg === AUTO_BG) {
            bg = ((clamp8((d[top]! + d[bot]!) * 0.5 * TEXT_BG_DIM) << 16) |
              (clamp8((d[top + 1]! + d[bot + 1]!) * 0.5 * TEXT_BG_DIM) << 8) |
              clamp8((d[top + 2]! + d[bot + 2]!) * 0.5 * TEXT_BG_DIM)) >>> 0
          }
        } else {
          code = HALF_BLOCK
          fg = ((clamp8(d[top]!) << 16) | (clamp8(d[top + 1]!) << 8) | clamp8(d[top + 2]!)) >>> 0
          bg = ((clamp8(d[bot]!) << 16) | (clamp8(d[bot + 1]!) << 8) | clamp8(d[bot + 2]!)) >>> 0
        }
        if (words) {
          words[o] = code
          words[o + 1] = fg
          words[o + 2] = bg
        } else {
          view.setUint32(o * 4, code, true)
          view.setUint32(o * 4 + 4, fg, true)
          view.setUint32(o * 4 + 8, bg, true)
        }
      }
    }
    return this.bytes
  }

  encode(fb: Framebuffer, text: TextLayer): string {
    return toBase64(this.encodeWords(fb, text))
  }
}
