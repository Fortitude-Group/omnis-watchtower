import { expect, test } from 'claude-code/testing'

import { world } from './helpers/world'

const PANE = {
  plugin: 'omnis-watchtower',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'watchtower',
  viewport: { columns: 160, rows: 28, isFullscreen: true },
  props: { title: 'Omnis Watchtower', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 24 }, view: {} },
}

const glyphs = (cells: string): string => {
  const bytes = atob(cells)
  let out = ''
  for (let i = 0; i < bytes.length; i += 12) out += String.fromCharCode(bytes.charCodeAt(i) | (bytes.charCodeAt(i + 1) << 8))
  return out
}

test('/watchtower demo replays offline: no fetch, no spawn, no command, then back to live (US4, T067)', { timeoutMs: 60_000 }, async ($, on) => {
  const w = world(on)
  let spawns = 0
  on('agent.spawn', () => {
    spawns++
    return { value: { model: 'inherit' } } as never
  })
  const frames: string[] = []
  on('ui.blit', (_$, e) => {
    frames.push(glyphs((e as { cells: string }).cells))
    return { value: {} }
  })
  const opened: unknown[] = []
  on('ui.open', (_$, e) => {
    opened.push(e)
    return { value: { isPlaced: true as const } }
  })

  const ui = await $.ui.mount(PANE)
  const reply = await $.command.run({ command: 'watchtower', args: 'demo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(reply.text).toContain('Nothing is installed')
  expect(opened).toHaveLength(1)

  await w.clock.advance(20_000)
  const mid = frames.at(-1) ?? ''
  expect(mid).toContain('DEMO — scripted replay')
  expect(mid).toContain('react-dom-utilz')

  await w.clock.advance(30_000)
  const end = frames.at(-1) ?? ''
  expect(end).not.toContain('DEMO — scripted replay')
  expect(end).toContain('LIVE')

  expect(w.fetched).toEqual([])
  expect(w.ran).toEqual([])
  expect(spawns).toBe(0)
  await ui.unmount()
})
