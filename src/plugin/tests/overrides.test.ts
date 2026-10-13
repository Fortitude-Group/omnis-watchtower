import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { NOW, world } from './helpers/world'

const BAD = 'npm install react-dom-utilz'
const PERMANENT = 'wt:overrides:permanent'

const run = (args: string, kind?: string) => ({
  command: 'watchtower',
  args,
  ...(kind ? { origin: { kind } } : {}),
  presentation: { isFullscreen: true, columns: 160 },
}) as never

// A test's $ has no state or store nouns, so the writes are watched on their way down to the engine
const watch = (on: On) => {
  const state: Record<string, unknown> = {}
  const events: { type: string }[] = []
  on('state.set', (_$, e, next) => {
    const x = e as { key: string; value: unknown }
    if (x.key === 'events') events.splice(0, events.length, ...(x.value as { type: string }[]))
    else state[x.key] = x.value
    return next(e)
  })
  return { state, events }
}

// A new session over the store an earlier one left behind: no HTTP, since an override settles the package
const reloaded = (on: On, store: Record<string, unknown>) => {
  mock.store(on, store)
  mock.clock(on, { now: NOW })
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('env.get', () => ({ value: undefined }))
  const ran: string[] = []
  on('tool.call', (_$, e) => {
    ran.push(String((e as { command?: string }).command))
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  return ran
}

const quiet = (on: On) => {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text: string }).text))
    return { value: undefined }
  })
  return toasts
}

const spawns = (on: On) => {
  const spawned: string[] = []
  on('agent.spawn', (_$, e) => {
    spawned.push(String((e as unknown as { prompt: string }).prompt))
    return { model: 'haiku', agentId: `sentinel-${spawned.length}` }
  })
  return spawned
}

const PANE = {
  plugin: 'omnis-watchtower',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'watchtower',
  viewport: { columns: 200, rows: 40, isFullscreen: true },
  props: { title: 'Omnis Watchtower', isFocused: false, bodyColumns: 140, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

test('an allow typed at the prompt applies, and the refused package then installs (US5-1)', async ($, on) => {
  const s = watch(on)
  const w = world(on)
  expect((await $.tool.call({ tool: 'Bash', command: BAD })).deny).toContain('WATCHTOWER REFUSED')
  const r = await $.command.run(run('allow npm:react-dom-utilz', 'composer'))
  expect(r.text).toBe('Allowed npm:react-dom-utilz for this session.')
  expect(s.state.sessionOverrides).toMatchObject({ 'npm:react-dom-utilz': { action: 'allow', scope: 'session', via: 'composer' } })
  expect(s.events.filter(e => e.type === 'OverrideApplied')).toEqual([
    expect.objectContaining({ key: 'npm:react-dom-utilz', action: 'allow', scope: 'session' }),
  ])
  const again = await $.tool.call({ tool: 'Bash', command: BAD })
  expect(again.deny).toBeUndefined()
  expect(w.ran).toEqual([BAD])
})

for (const kind of ['sdk', 'plugin', 'task-notification', 'peer', 'bridge', undefined]) {
  test(`an allow from ${kind ?? 'an unstamped'} origin is refused and parked for the pane (SC-010)`, async ($, on) => {
    const s = watch(on)
    const w = world(on)
    const r = await $.command.run(run('allow npm:react-dom-utilz --permanent', kind))
    expect(r.text).toContain('need your own hand')
    expect(r.text).toContain(`origin: ${kind ?? 'unclassified'}`)
    expect(r.text).toContain('press "Allow npm:react-dom-utilz permanently" in the Watchtower pane')
    expect(s.state.pendingOverrides).toMatchObject({ 'npm:react-dom-utilz': { action: 'allow', scope: 'permanent', via: 'pane' } })
    expect(s.state.sessionOverrides).toBeUndefined()
    expect(s.events.some(e => e.type === 'OverrideApplied')).toBe(false)
    expect((await $.tool.call({ tool: 'Bash', command: BAD })).deny).toContain('WATCHTOWER REFUSED')
    expect(w.ran).toEqual([])
    const list = await $.command.run(run('overrides', kind))
    expect(list.text).toContain('Allow npm:react-dom-utilz permanently: press it in the Watchtower pane')
  })
}

test('pressing the pane confirmation applies a parked override (research R1)', async ($, on) => {
  const s = watch(on)
  const w = world(on)
  const toasts = quiet(on)
  await $.command.run(run('allow npm:react-dom-utilz', 'sdk'))
  const ui = await $.ui.mount(PANE)
  // Needs the pane to draw a Button keyed confirm-override:<key> for each pending override
  await ui.press({ key: 'confirm-override:npm:react-dom-utilz' })
  await ui.unmount()
  expect(s.state.pendingOverrides).toEqual({})
  expect(s.state.sessionOverrides).toMatchObject({ 'npm:react-dom-utilz': { action: 'allow', via: 'pane' } })
  expect(s.events.some(e => e.type === 'OverrideApplied')).toBe(true)
  expect(toasts.some(t => t.includes('allowed npm:react-dom-utilz'))).toBe(true)
  expect((await $.tool.call({ tool: 'Bash', command: BAD })).deny).toBeUndefined()
  expect(w.ran).toEqual([BAD])
})

test('--permanent lands in the plugin store, not session state', async ($, on) => {
  const s = watch(on)
  const w = world(on)
  await $.command.run(run('allow npm:react-dom-utilz --permanent', 'composer'))
  expect(s.state.sessionOverrides).toBeUndefined()
  expect(s.events.filter(e => e.type === 'OverrideApplied')).toEqual([expect.objectContaining({ scope: 'permanent' })])
  expect((await $.command.run(run('overrides'))).text).toMatch(/allow\s+npm:react-dom-utilz\s+permanent/)
  expect((await $.tool.call({ tool: 'Bash', command: BAD })).deny).toBeUndefined()
  expect(w.ran).toEqual([BAD])
})

test('a permanent override from an earlier session still applies after a reload', async ($, on) => {
  const ran = reloaded(on, { [PERMANENT]: { 'npm:react-dom-utilz': { key: 'npm:react-dom-utilz', action: 'allow', scope: 'permanent', at: 1, via: 'composer' } } })
  expect((await $.tool.call({ tool: 'Bash', command: BAD })).deny).toBeUndefined()
  expect(ran).toEqual([BAD])
  expect((await $.command.run(run('overrides'))).text).toMatch(/allow\s+npm:react-dom-utilz\s+permanent/)
})

test('a block typed at the prompt refuses an otherwise clean package (US5-2)', async ($, on) => {
  const s = watch(on)
  const w = world(on)
  await $.command.run(run('block npm:chalk', 'composer'))
  expect(s.events.filter(e => e.type === 'OverrideApplied')).toEqual([expect.objectContaining({ key: 'npm:chalk', action: 'block' })])
  expect((await $.tool.call({ tool: 'Bash', command: 'npm install chalk' })).deny).toContain('WATCHTOWER REFUSED npm:chalk')
  expect(w.ran).toEqual([])
})

test('overrides clear works only from the prompt', async ($, on) => {
  watch(on)
  const w = world(on)
  await $.command.run(run('allow npm:react-dom-utilz --permanent', 'composer'))
  expect((await $.command.run(run('overrides clear npm:react-dom-utilz', 'sdk'))).text).toContain('need your own hand')
  expect((await $.command.run(run('overrides clear npm:react-dom-utilz', 'composer'))).text).toBe('Removed the override for npm:react-dom-utilz.')
  expect((await $.command.run(run('overrides'))).text).toBe('No overrides.')
  expect((await $.tool.call({ tool: 'Bash', command: BAD })).deny).toContain('WATCHTOWER REFUSED')
  expect(w.ran).toEqual([])
})

test('recheck drops the cached verdict and the next shell command starts a Sentinel', async ($, on) => {
  const s = watch(on)
  const w = world(on)
  const spawned = spawns(on)
  await $.tool.call({ tool: 'Bash', command: 'npm install chalk' })
  const fetches = w.fetched.length
  await $.tool.call({ tool: 'Bash', command: 'npm install chalk' })
  expect(w.fetched.length).toBe(fetches) // decided from the cached verdict
  expect(spawned).toEqual([])
  // Any origin may ask for a recheck: it can only add scrutiny
  const r = await $.command.run(run('recheck npm:chalk', 'sdk'))
  expect(r.text).toContain('Dropped the cached verdict for npm:chalk')
  expect(s.state.investigations).toMatchObject({ 'npm:chalk@latest': { status: 'queued', attempts: 0, deadline: expect.any(Number) } })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(spawned).toHaveLength(1)
  expect(spawned[0]).toContain('npm:chalk')
})

test('recheck keeps a hard signal from the cached refusal, so the Sentinel cannot clear it', async ($, on) => {
  const s = watch(on)
  world(on)
  spawns(on)
  await $.tool.call({ tool: 'Bash', command: BAD })
  await $.command.run(run('recheck npm:react-dom-utilz'))
  expect(s.state.investigations).toMatchObject({ 'npm:react-dom-utilz@latest': { status: 'queued', hasHardSignal: true, reasons: expect.arrayContaining([expect.stringContaining('does not exist on npm')]) } })
})

test('a bare name resolves when the session saw it in one ecosystem, and asks otherwise', async ($, on) => {
  const s = watch(on)
  world(on)
  expect((await $.command.run(run('allow react-dom-utilz', 'composer'))).text).toContain('npm:react-dom-utilz or pypi:react-dom-utilz')
  expect(s.state.sessionOverrides).toBeUndefined()
  await $.tool.call({ tool: 'Bash', command: BAD })
  expect((await $.command.run(run('allow react-dom-utilz', 'composer'))).text).toBe('Allowed npm:react-dom-utilz for this session.')
  expect((await $.command.run(run('block cargo:serde', 'composer'))).text).toContain('unknown ecosystem')
  expect((await $.command.run(run('allow', 'composer'))).text).toContain('Usage: /watchtower allow')
})

test('a block from a peer session is parked under the normalised PyPI name', async ($, on) => {
  const s = watch(on)
  world(on)
  await $.command.run(run('block pypi:Foo_Bar --permanent', 'peer'))
  expect(s.state.pendingOverrides).toMatchObject({ 'pypi:foo-bar': { action: 'block', scope: 'permanent' } })
  expect((await $.command.run(run('overrides', 'peer'))).text).toContain('Block pypi:foo-bar permanently: press it in the Watchtower pane')
})
