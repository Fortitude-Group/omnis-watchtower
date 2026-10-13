import { expect, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { world } from './helpers/world'

const PANE_ID = 'watchtower'
const FALLBACK = 'Mission control needs a terminal for now'

const pane = <S extends 'terminal' | 'desktop'>(surface: S, bodyColumns: number, bodyRows = 30) => ({
  plugin: 'omnis-watchtower',
  surface,
  component: 'Pane' as const,
  requestId: PANE_ID,
  viewport: { columns: bodyColumns + 60, rows: bodyRows + 4, isFullscreen: true },
  props: { title: 'Omnis Watchtower', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} },
})

/** The glyphs of a Raster's cells, one string per row. */
const glyphs = (cells: string, columns: number): string => {
  const bytes = atob(cells)
  let out = ''
  for (let i = 0, n = 0; i < bytes.length; i += 12, n++) {
    if (n > 0 && n % columns === 0) out += '\n'
    out += String.fromCharCode(bytes.charCodeAt(i) | (bytes.charCodeAt(i + 1) << 8))
  }
  return out
}

type Blit = { at: number; cells: string; columns?: number; rows?: number }

/** Answers ui.blit as a mounted Raster does (the kit leaves it to the test) and records each one. */
const blitter = (on: On, now: () => number) => {
  const state = { mounted: true, blits: [] as Blit[] }
  on('ui.blit', (_$, e) => {
    state.blits.push({ ...(e as unknown as Blit), at: now() })
    return { value: state.mounted ? {} : { deny: 'nothing of omnis-watchtower is mounted there' } }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  return state
}

const text = (b: Blit | undefined): string => (b ? glyphs(b.cells, b.columns ?? 1) : '')

const rasterOf = (tree: RenderElement) => tree as unknown as { type: string; props: { key: string; columns: number; rows: number; cells: string } }

const run = (args: string) => ({
  command: 'watchtower',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 200 },
})

test('a wide pane draws one Raster at the body size with side panels (T055)', async ($, on) => {
  const w = world(on)
  blitter(on, w.clock.now)
  const ui = await $.ui.mount(pane('terminal', 140, 30))
  const r = rasterOf(await ui.drawn())
  expect(r.type).toBe('Raster')
  expect(r.props).toMatchObject({ key: 'map', columns: 140, rows: 30 })
  const shown = glyphs(r.props.cells, 140)
  expect(shown).toContain('OMNIS WATCHTOWER')
  expect(shown).toContain('EVENTS')
  expect(shown).toContain('FLEET')
  await ui.unmount()
})

test('a narrow pane draws the Raster with a ticker and no side panels (US3-5)', async ($, on) => {
  const w = world(on)
  blitter(on, w.clock.now)
  const ui = await $.ui.mount(pane('terminal', 80, 24))
  const r = rasterOf(await ui.drawn())
  expect(r.props).toMatchObject({ key: 'map', columns: 80, rows: 24 })
  const shown = glyphs(r.props.cells, 80)
  expect(shown).toContain('OMNIS WATCHTOWER')
  expect(shown).not.toContain('FLEET')
  await ui.unmount()
})

test('a refused install reaches the map through the gate (US3-2)', async ($, on) => {
  const w = world(on)
  const b = blitter(on, w.clock.now)
  const ui = await $.ui.mount(pane('terminal', 140, 30))
  const r = await $.tool.call({ tool: 'Bash', command: 'npm install react-dom-utilz' })
  expect(r.deny).toContain('WATCHTOWER REFUSED')
  await w.clock.advance(3000)
  expect(text(b.blits.at(-1))).toContain('react-dom-utilz refused')
  await ui.unmount()
})

test('blits run at 4 fps idle, 30 fps while sprites move, and stop once unmounted (US3-7)', async ($, on) => {
  const w = world(on)
  const b = blitter(on, w.clock.now)
  const ui = await $.ui.mount(pane('terminal', 100, 24))
  await w.clock.advance(100)
  let from = b.blits.length
  await w.clock.advance(2000)
  const idle = b.blits.length - from
  expect(idle).toBeGreaterThanOrEqual(7)
  expect(idle).toBeLessThanOrEqual(9)

  await $.command.run(run('demo'))
  await w.clock.advance(4000)
  from = b.blits.length
  await w.clock.advance(1000)
  const active = b.blits.length - from
  expect(active).toBeGreaterThanOrEqual(27)
  expect(active).toBeLessThanOrEqual(31)

  await ui.unmount()
  b.mounted = false
  await w.clock.advance(100)
  from = b.blits.length
  await w.clock.advance(2000)
  expect(b.blits.length - from).toBe(0)
})

test('reducedMotion caps the frame rate at 4 fps (FR-025)', { options: { reducedMotion: true } }, async ($, on) => {
  const w = world(on)
  const b = blitter(on, w.clock.now)
  const ui = await $.ui.mount(pane('terminal', 100, 24))
  await $.command.run(run('demo'))
  await w.clock.advance(4000)
  const from = b.blits.length
  await w.clock.advance(1000)
  expect(b.blits.length - from).toBeLessThanOrEqual(4)
  expect(b.blits.length - from).toBeGreaterThanOrEqual(3)
  await ui.unmount()
})

test('a pane the surface hides stops animating until shown again (US3-7)', async ($, on) => {
  const w = world(on)
  const b = blitter(on, w.clock.now)
  let isShown = true
  on('ui.panes', () => ({ value: [{ id: PANE_ID, title: 'Omnis Watchtower', isShown, isFocused: false, isPlaced: true }] }))
  const ui = await $.ui.mount(pane('terminal', 100, 24))
  await w.clock.advance(1100)
  isShown = false
  await w.clock.advance(1100)
  let from = b.blits.length
  await w.clock.advance(3000)
  expect(b.blits.length - from).toBe(0)
  isShown = true
  await w.clock.advance(1100)
  from = b.blits.length
  await w.clock.advance(1000)
  expect(b.blits.length - from).toBeGreaterThanOrEqual(3)
  await ui.unmount()
})

test('switching theme redraws in the new look and keeps the scene (US3-4)', async ($, on) => {
  const w = world(on)
  const b = blitter(on, w.clock.now)
  const ui = await $.ui.mount(pane('terminal', 140, 30))
  await $.tool.call({ tool: 'Bash', command: 'npm install react-dom-utilz' })
  await w.clock.advance(3000)
  const before = b.blits.at(-1)!
  expect(text(before)).toContain('react-dom-utilz refused')

  const reply = await $.command.run(run('theme cracktro'))
  expect(reply.text).toContain('cracktro')
  await w.clock.advance(500)
  // The same scene in the cracktro look: its panel truncates the line, the totals carry over
  const after = b.blits.at(-1)!
  expect(text(after)).toContain('✖ react-dom-utilz')
  expect(text(after)).toMatch(/REFUSED +1/)
  expect(text(after)).toMatch(/INTERCEPTS +1/)
  expect(after.cells).not.toBe(before.cells)
  const drawn = rasterOf(await ui.drawn())
  expect(glyphs(drawn.props.cells, 140)).toMatch(/REFUSED +1/)

  const bad = await $.command.run(run('theme neon'))
  expect(bad.text).toContain('Unknown theme "neon"')
  await ui.unmount()
})

test('the pane survives every surface: Raster on terminal, a plain note on desktop (FR-026)', async ($, on) => {
  const w = world(on)
  const b = blitter(on, w.clock.now)
  await $.tool.call({ tool: 'Bash', command: 'npm install react-dom-utilz' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const before = b.blits.length
    const ui = await $.ui.mount(pane(surface, 120, 24))
    const tree = rasterOf(await ui.drawn())
    await w.clock.advance(500)
    if (surface === 'terminal') {
      expect(tree.type).toBe('Raster')
      expect(b.blits.length).toBeGreaterThan(before)
    } else {
      expect(await ui.find({ type: 'Text', text: FALLBACK })).toBeDefined()
      expect(b.blits.length).toBe(before)
    }
    await ui.unmount()
    b.mounted = false
    await w.clock.advance(500)
    b.mounted = true
  }
})

test('bare /watchtower opens the pane', async ($, on) => {
  world(on)
  const opened: unknown[] = []
  on('ui.open', (_$, e) => {
    opened.push(e)
    return { value: { isPlaced: true as const } }
  })
  const reply = await $.command.run(run(''))
  expect(reply.text).toContain('mission control')
  expect(opened).toEqual([expect.objectContaining({ id: PANE_ID })])
})
