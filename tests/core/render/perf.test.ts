// Research R5: a 120x36 frame (passes + overlay + encode + base64) must stay cheap enough for 30 fps.
//
// Wall-clock medians swing ~3x when vitest runs every file in parallel, so each frame is timed
// back-to-back with a fixed calibration workload (plain typed-array and string work that shares
// no code with the renderer) and the gate is on the ratio of their medians. The first run records
// the baseline in perf-baseline.json; later runs fail when the ratio exceeds 1.5x of it. Delete the
// file to re-baseline after a deliberate change.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { TerminalRasterRenderer } from '../../../src/plugin/core/render/terminal-raster'
import { cracktroTheme } from '../../../src/plugin/core/render/themes/cracktro'
import { radarTheme } from '../../../src/plugin/core/render/themes/radar'
import { fixtureScene } from './fixtures'

const BASELINE = join(dirname(fileURLToPath(import.meta.url)), 'perf-baseline.json')
const FRAMES = 200

type Baseline = { frame120x36MedianMs: number; calibrationMedianMs: number; ratio: number; frames: number; node: string }

const calBuf = new Float32Array(120 * 72 * 3)
const calBytes = new Uint8Array(40_000)
let calSink = 0
const calibrate = (seed: number): void => {
  for (let i = 0; i < calBuf.length; i++) calBuf[i] = calBuf[i]! * 0.86 + ((i * seed) & 255) * 0.14
  for (let i = 0; i < calBytes.length; i++) calBytes[i] = 65 + ((calBuf[i % calBuf.length]! | 0) & 15)
  let s = ''
  for (let i = 0; i < calBytes.length; i += 4096) s += String.fromCharCode.apply(null, calBytes.subarray(i, i + 4096) as unknown as number[])
  calSink += s.length
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}

const measure = (): { frame: number; cal: number } => {
  const scene = fixtureScene()
  const frames: number[] = []
  const cals: number[] = []
  for (const theme of [radarTheme, cracktroTheme]) {
    const r = new TerminalRasterRenderer()
    r.mount({ columns: 120, rows: 36 }, theme)
    for (let i = 0; i < 20; i++) {
      r.frame(scene, i * 33)
      calibrate(i)
    }
    for (let i = 0; i < FRAMES / 2; i++) {
      let t0 = performance.now()
      r.frame(scene, 1000 + i * 33)
      frames.push(performance.now() - t0)
      t0 = performance.now()
      calibrate(i)
      cals.push(performance.now() - t0)
    }
  }
  return { frame: median(frames), cal: median(cals) }
}

test('120x36 frame cost stays within 1.5x of the recorded baseline', () => {
  const runs = [measure(), measure(), measure()]
  const best = runs.reduce((a, b) => (b.frame / b.cal < a.frame / a.cal ? b : a))
  const ratio = best.frame / best.cal
  expect(calSink).toBeGreaterThan(0)
  if (!existsSync(BASELINE)) {
    const b: Baseline = {
      frame120x36MedianMs: Number(best.frame.toFixed(4)),
      calibrationMedianMs: Number(best.cal.toFixed(4)),
      ratio: Number(ratio.toFixed(4)),
      frames: FRAMES,
      node: process.version,
    }
    writeFileSync(BASELINE, `${JSON.stringify(b, null, 2)}\n`)
    return
  }
  const b = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline
  expect(ratio, `frame ${best.frame.toFixed(3)} ms vs calibration ${best.cal.toFixed(3)} ms`).toBeLessThanOrEqual(b.ratio * 1.5)
})
