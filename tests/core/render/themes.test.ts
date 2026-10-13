// Goldens: FNV-1a of RasterFrame.cells. Each golden starts from a NEW renderer, because the radar's
// afterglow depends on the frames drawn before (terminal-raster.ts). A changed hash means the
// picture changed: eyeball it with WT_PREVIEW=1 (ascii-dump.ts) before updating the value.

import { describe, expect, test } from 'vitest'
import { DEMO_SCRIPT, DEMO_SEED } from '../../../src/plugin/core/data/demo-script'
import type { Theme } from '../../../src/plugin/core/render/renderer'
import { TerminalRasterRenderer } from '../../../src/plugin/core/render/terminal-raster'
import { cracktroTheme } from '../../../src/plugin/core/render/themes/cracktro'
import { radarTheme } from '../../../src/plugin/core/render/themes/radar'
import type { Scene } from '../../../src/plugin/core/scene/events'
import { replay } from '../../../src/plugin/core/scene/replay'
import { preview } from './ascii-dump'
import { fixtureScene, fnv1a, textRows } from './fixtures'

const render = (theme: Theme, columns: number, rows: number, scene: Scene, times: number[]) => {
  const r = new TerminalRasterRenderer()
  r.mount({ columns, rows }, theme)
  let frame = r.frame(scene, times[0]!)
  for (const t of times.slice(1)) frame = r.frame(scene, t)
  return frame
}

const SEQUENCE = Array.from({ length: 10 }, (_, i) => 1000 + i * 33)

const GOLDENS: Record<string, string> = {
  'radar 120x36 t=0': 'd93dfa37',
  'radar 120x36 t=1234': '78696462',
  'radar 120x36 seq': '68d280a7',
  'radar 70x24 t=0': '8ad73d76',
  'radar 70x24 t=1234': '9c1c05ef',
  'cracktro 120x36 t=0': '29dcacad',
  'cracktro 120x36 t=1234': '1e60c049',
  'cracktro 70x24 t=0': 'bfe14396',
  'cracktro 70x24 t=1234': '5b94a3bd',
}

describe('golden frames (hand-built scene)', () => {
  for (const theme of [radarTheme, cracktroTheme]) {
    for (const [columns, rows] of [[120, 36], [70, 24]] as const) {
      for (const t of [0, 1234]) {
        const name = `${theme.id} ${columns}x${rows} t=${t}`
        test(name, () => {
          const frame = render(theme, columns, rows, fixtureScene(), [t])
          preview(name, frame)
          expect(frame.columns).toBe(columns)
          expect(frame.rows).toBe(rows)
          expect(fnv1a(frame.cells)).toBe(GOLDENS[name])
        })
      }
    }
  }

  test('radar afterglow over a 10-frame sequence', () => {
    const frame = render(radarTheme, 120, 36, fixtureScene(), SEQUENCE)
    preview('radar 120x36 seq', frame)
    expect(fnv1a(frame.cells)).toBe(GOLDENS['radar 120x36 seq'])
  })
})

describe('determinism', () => {
  test('fresh renderers give identical frames for identical inputs', () => {
    for (const theme of [radarTheme, cracktroTheme]) {
      const a = render(theme, 120, 36, fixtureScene(), SEQUENCE)
      const b = render(theme, 120, 36, fixtureScene(), SEQUENCE)
      expect(a.cells).toBe(b.cells)
    }
  })

  test('reset() drops the afterglow so the next frame matches a fresh renderer', () => {
    const r = new TerminalRasterRenderer()
    r.mount({ columns: 120, rows: 36 }, radarTheme)
    for (const t of SEQUENCE) r.frame(fixtureScene(), t)
    r.reset()
    expect(r.frame(fixtureScene(), 500).cells).toBe(render(radarTheme, 120, 36, fixtureScene(), [500]).cells)
  })

  test('cracktro has no memory: the same tMs gives the same frame whatever came before', () => {
    const r = new TerminalRasterRenderer()
    r.mount({ columns: 120, rows: 36 }, cracktroTheme)
    for (const t of SEQUENCE) r.frame(fixtureScene(), t)
    expect(r.frame(fixtureScene(), 1234).cells).toBe(render(cracktroTheme, 120, 36, fixtureScene(), [1234]).cells)
  })

  test('frame does not mutate the scene', () => {
    const scene = fixtureScene()
    const before = JSON.stringify(scene)
    render(radarTheme, 120, 36, scene, SEQUENCE)
    expect(JSON.stringify(scene)).toBe(before)
  })

  test('time moves the picture', () => {
    expect(render(radarTheme, 120, 36, fixtureScene(), [0]).cells).not.toBe(render(radarTheme, 120, 36, fixtureScene(), [700]).cells)
    expect(render(cracktroTheme, 120, 36, fixtureScene(), [0]).cells).not.toBe(render(cracktroTheme, 120, 36, fixtureScene(), [700]).cells)
  })

  test('frame before mount throws', () => {
    expect(() => new TerminalRasterRenderer().frame(fixtureScene(), 0)).toThrow(/mount/)
  })
})

describe('verdicts carry glyph and label (FR-024)', () => {
  for (const theme of [radarTheme, cracktroTheme]) {
    for (const [columns, rows] of [[120, 36], [70, 24], [50, 20]] as const) {
      test(`${theme.id} ${columns}x${rows}`, () => {
        const screen = textRows(render(theme, columns, rows, fixtureScene(), [0])).join('\n')
        expect(screen).toContain('✔ chalk passed')
        expect(screen).toContain('◆ left-padx held')
        expect(screen).toContain('✖ reqeusts refused')
      })
    }
  }

  test('wide layout totals use glyph + word', () => {
    const screen = textRows(render(radarTheme, 120, 36, fixtureScene(), [0])).join('\n')
    expect(screen).toMatch(/✔ PASSED +3/)
    expect(screen).toMatch(/◆ HELD +1/)
    expect(screen).toMatch(/✖ REFUSED +1/)
  })
})

describe('layout tiers', () => {
  const rowsOf = (columns: number, rows: number, scene = fixtureScene()) => textRows(render(radarTheme, columns, rows, scene, [0]))

  test('>= 100 columns: events left, fleet and totals right, header and footer', () => {
    const rows = rowsOf(120, 36)
    const screen = rows.join('\n')
    expect(rows[0]).toContain('OMNIS WATCHTOWER')
    expect(rows[0]).toContain('· mission control')
    expect(rows[0]).toMatch(/[●○] LIVE/)
    expect(screen).toContain('EVENTS')
    expect(screen).toContain('FLEET')
    expect(screen).toContain('▲ coder')
    expect(screen).toContain('52.1k')
    expect(screen).toContain('≈ $0.42 est.')
    expect(screen).toMatch(/TOKENS +65\.8k/)
    expect(rows[3]!.indexOf('EVENTS')).toBeLessThan(24)
    expect(rows[3]!.indexOf('FLEET')).toBeGreaterThanOrEqual(96)
    expect(rows[35]).toContain('TRIPWIRE ARMED')
  })

  test('60-99 columns: no panels, a ticker with the latest event above the footer', () => {
    const rows = rowsOf(70, 24)
    const screen = rows.join('\n')
    expect(screen).not.toContain('EVENTS')
    expect(screen).not.toContain('FLEET')
    expect(rows[22]).toContain('✖ reqeusts refused')
    expect(rows[22]).toContain('✔ 3 passed')
    expect(rows[23]).toContain('TRIPWIRE ARMED')
  })

  test('< 60 columns: map and header only', () => {
    const rows = rowsOf(50, 20)
    const screen = rows.join('\n')
    expect(rows[0]).toContain('OMNIS WATCHTOWER')
    expect(screen).not.toContain('EVENTS')
    expect(screen).not.toContain('TRIPWIRE ARMED')
    expect(screen).not.toContain('passed  ◆')
  })

  test('unpriced tokens are called out', () => {
    const scene = fixtureScene()
    scene.unpricedTokens = 2_500
    expect(rowsOf(120, 36, scene).join('\n')).toContain('excl. 2.5k unpriced')
  })

  test('cracktro footer is the rainbow scrolltext', () => {
    const rows = textRows(render(cracktroTheme, 120, 36, fixtureScene(), [0]))
    expect(rows[35]).toContain('OMNIS WATCHTOWER')
  })

  test('viewport is clamped to Raster limits', () => {
    const r = new TerminalRasterRenderer()
    r.mount({ columns: 9999, rows: 0 }, radarTheme)
    const f = r.frame(fixtureScene(), 0)
    expect([f.columns, f.rows]).toEqual([512, 1])
  })
})

describe('banners', () => {
  test('fault shows a red WATCHTOWER FAULT row', () => {
    const rows = textRows(render(radarTheme, 120, 36, fixtureScene({ fault: true }), [0]))
    expect(rows[1]).toContain('⚠ WATCHTOWER FAULT')
    expect(rows[1]).toContain('registry timeout')
  })

  test('demo shows the scripted replay banner', () => {
    const rows = textRows(render(cracktroTheme, 70, 24, fixtureScene({ demo: true }), [0]))
    expect(rows[1]).toContain('DEMO — scripted replay')
    expect(rows[0]).toContain('DEMO')
  })

  test('fault and demo stack', () => {
    const rows = textRows(render(radarTheme, 120, 36, fixtureScene({ fault: true, demo: true }), [0]))
    expect(rows[1]).toContain('WATCHTOWER FAULT')
    expect(rows[2]).toContain('DEMO — scripted replay')
  })
})

describe('theme switch keeps the scene', () => {
  test('setTheme redraws the same scene in the new look', () => {
    const r = new TerminalRasterRenderer()
    r.mount({ columns: 120, rows: 36 }, radarTheme)
    const scene = fixtureScene()
    const radar = r.frame(scene, 0)
    r.setTheme(cracktroTheme)
    const cracktro = r.frame(scene, 0)
    expect(cracktro.cells).not.toBe(radar.cells)
    expect(cracktro.cells).toBe(render(cracktroTheme, 120, 36, scene, [0]).cells)
    expect(textRows(cracktro).join('\n')).toContain('◆ left-padx held')
  })
})

describe('demo replay drives the renderer', () => {
  test('identical frame hashes on two runs, both themes', () => {
    const run = (theme: Theme) => {
      const r = new TerminalRasterRenderer()
      r.mount({ columns: 120, rows: 36 }, theme)
      const hashes: string[] = []
      replay(DEMO_SCRIPT, DEMO_SEED, 33, (scene, n) => {
        if (n % 30 === 0) hashes.push(fnv1a(r.frame(scene, scene.t).cells))
      })
      return hashes
    }
    for (const theme of [radarTheme, cracktroTheme]) {
      const a = run(theme)
      expect(a.length).toBeGreaterThan(10)
      expect(run(theme)).toEqual(a)
    }
  })

  test('preview a mid-demo frame', () => {
    let mid: Scene | undefined
    replay(DEMO_SCRIPT, DEMO_SEED, 33, (scene, n) => {
      if (n === 700) mid = scene
    })
    expect(mid).toBeDefined()
    for (const theme of [radarTheme, cracktroTheme]) preview(`demo ${theme.id} frame 700`, render(theme, 120, 36, mid!, [mid!.t]))
  })
})
