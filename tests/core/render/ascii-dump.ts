// Eyeball a RasterFrame in a truecolour terminal. Silent unless WT_PREVIEW=1:
//   WT_PREVIEW=1 node node_modules/vitest/vitest.mjs run tests/core/render/themes.test.ts

import type { RasterFrame } from '../../../src/plugin/core/render/renderer'
import { decodeCells } from './fixtures'

const DEFAULT = 0x01000000

const sgr = (c: number, ground: 38 | 48): string =>
  c === DEFAULT ? `\x1b[${ground + 1}m` : `\x1b[${ground};2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}m`

export const toAnsi = (frame: RasterFrame): string => {
  const w = decodeCells(frame.cells)
  let out = ''
  for (let r = 0; r < frame.rows; r++) {
    for (let c = 0; c < frame.columns; c++) {
      const i = (r * frame.columns + c) * 3
      out += sgr(w[i + 1]!, 38) + sgr(w[i + 2]!, 48) + String.fromCodePoint(w[i]!)
    }
    out += '\x1b[0m\n'
  }
  return out
}

export const preview = (title: string, frame: RasterFrame): void => {
  if (process.env.WT_PREVIEW !== '1') return
  process.stdout.write(`\n${title} (${frame.columns}x${frame.rows})\n${toAnsi(frame)}`)
}
