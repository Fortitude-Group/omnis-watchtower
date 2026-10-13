import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { world } from './helpers/world'

const BAD = 'npm install react-dom-utilz'

const watch = (on: On) => {
  const state: Record<string, unknown> = {}
  const events: { type: string; message?: string }[] = []
  const toasts: string[] = []
  on('state.set', (_$, e, next) => {
    const x = e as { key: string; value: unknown }
    if (x.key === 'events') events.splice(0, events.length, ...(x.value as { type: string }[]))
    else state[x.key] = x.value
    return next(e)
  })
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text: string }).text))
    return { value: undefined }
  })
  return { state, events, toasts }
}

test('warn-only lets a refused package run but reports it to the agent (US5-4)', { options: { mode: 'warn-only' } }, async ($, on) => {
  const s = watch(on)
  const w = world(on)
  const r = await $.tool.call({ tool: 'Bash', command: BAD })
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual([BAD])
  expect(r.context?.join('\n')).toContain('WATCHTOWER REFUSED npm:react-dom-utilz')
  expect(s.events).toContainEqual(expect.objectContaining({ type: 'PackageScored', tier: 'refuse' }))
})

test('a gate fault in default mode lets the command run and raises the fault (FR-031)', { options: { faultInjection: true } }, async ($, on) => {
  const s = watch(on)
  const w = world(on)
  const r = await $.tool.call({ tool: 'Bash', command: BAD })
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual([BAD])
  expect(s.state.fault).toMatchObject({ where: 'gate', message: 'fault injection (test only)' })
  expect(s.events).toContainEqual(expect.objectContaining({ type: 'Fault', where: 'gate' }))
  expect(s.toasts.some(t => t.includes('WATCHTOWER FAULT') && t.includes('ran unchecked'))).toBe(true)
})

test('a gate fault under strict mode refuses the command (US5-5)', { options: { faultInjection: true, strict: true } }, async ($, on) => {
  const s = watch(on)
  const w = world(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'npm install chalk' })
  expect(r.deny).toContain('WATCHTOWER FAULT')
  expect(r.deny).toContain('strict mode refuses the command')
  expect(w.ran).toEqual([])
  expect(s.state.fault).toMatchObject({ where: 'gate' })
})
