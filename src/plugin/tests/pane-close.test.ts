// Closing the pane where the terminal keeps the mouse (main screen, tmux, attach views): the close
// mark is then plain text, so Esc and the commands must work (bug report, 2026-10-14).
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { world } from './helpers/world'

const run = (args: string) => ({
  command: 'watchtower',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 160 },
})

const panes = (on: On, shown: () => boolean) => {
  const opened: { closeOnEscape?: boolean }[] = []
  const closed: string[] = []
  on('ui.open', (_$, e) => { opened.push(e as { closeOnEscape?: boolean }); return { value: { isPlaced: true as const } } })
  on('ui.close', (_$, e) => { closed.push(String((e as { id: string }).id)); return { value: undefined } as never })
  on('ui.panes', () => ({ value: shown() ? [{ id: 'watchtower', title: 'Omnis Watchtower', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  return { opened, closed }
}

test('opening mission control asks for Esc to close it', async ($, on) => {
  world(on)
  const p = panes(on, () => false)
  const r = await $.command.run(run(''))
  expect(p.opened).toHaveLength(1)
  expect(p.opened[0]!.closeOnEscape).toBe(true)
  expect(r.text).toContain('Press Esc at an empty prompt')
})

test('/watchtower while the pane is showing closes it instead', async ($, on) => {
  world(on)
  const p = panes(on, () => true)
  const r = await $.command.run(run(''))
  expect(p.closed).toEqual(['watchtower'])
  expect(p.opened).toHaveLength(0)
  expect(r.text).toBe('Closed Omnis Watchtower mission control.')
})

test('/watchtower close closes it outright', async ($, on) => {
  world(on)
  const p = panes(on, () => true)
  await $.command.run(run('close'))
  expect(p.closed).toEqual(['watchtower'])
})

test('the demo also opens with Esc to close', async ($, on) => {
  world(on)
  const p = panes(on, () => false)
  await $.command.run(run('demo'))
  expect(p.opened.at(-1)?.closeOnEscape).toBe(true)
})
