import { expect, mock, test } from 'claude-code/testing'

const run = (args: string) => ({
  command: 'watchtower',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})

test('unknown sub-commands get the help text', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000 })
  const r = await $.command.run(run('frobnicate'))
  expect(r.text).toContain('Unknown sub-command "frobnicate"')
  expect(r.text).toContain('/watchtower theme <radar|cracktro>')
})

test('known sub-commands without a handler say so', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const r = await $.command.run(run('legend'))
  expect(r.text).toBe('/watchtower legend is not available yet.')
})
