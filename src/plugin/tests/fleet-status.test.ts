import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { SceneEvent } from '../types'
import { world } from './helpers/world'

// The surfaces beneath the plugin, recording what it shows, and the event list it last wrote
const surfaces = (on: On) => {
  const toasts: string[] = []
  const status: (string | undefined)[] = []
  const state = { events: [] as SceneEvent[] }
  on('ui.toast', (_$, e) => (toasts.push((e as { text: string }).text), { value: undefined }))
  on('ui.status', (_$, e) => (status.push((e as { text?: string }).text), { value: undefined }))
  on('state.set', (_$, e, next) => {
    const w = e as { key: string; value: unknown }
    if (w.key === 'events') state.events = w.value as SceneEvent[]
    return next(e)
  })
  return { toasts, status, state }
}

// The engine's Agent tool: starts a subagent and hands back its id
const agents = (on: On) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'haiku', agentId: `agent-${++n}` }))
}

const usage = { model: 'claude-haiku-4-5', input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const turn = (agentId: string | undefined, u: object | undefined = usage) => ({
  answer: 'done', durationMs: 900, isAborted: false, turnId: `t-${agentId ?? 'main'}`, reason: 'answer' as const,
  ...(agentId ? { agentId } : {}), ...(u ? { usage: u } : {}),
})
const types = (s: { state: { events: SceneEvent[] } }) => s.state.events.map(e => e.type)

test('a helper agent launches, acts and finishes (US3-1)', async ($, on) => {
  world(on)
  agents(on)
  const s = surfaces(on)
  const spawned = await $.agent.spawn({ subagentType: 'Explore', prompt: 'look around', description: 'survey', tool_use_id: 'tu-1' } as never)
  expect(spawned.agentId).toBe('agent-1')
  expect(s.state.events.at(-1)).toMatchObject({ type: 'AgentLaunched', agentId: 'agent-1', agentType: 'Explore' })

  await $.tool.call({ tool: 'Edit', file_path: 'C:/repo/src/auth.ts', old_string: 'a', new_string: 'b', agentId: 'agent-1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --watch=false', agentId: 'agent-1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/README.md' } as never)
  const acted = s.state.events.filter(e => e.type === 'AgentActed')
  expect(acted).toMatchObject([
    { agentId: 'agent-1', summary: 'Edit auth.ts' },
    { agentId: 'agent-1', summary: 'Bash npm test --' },
    { agentId: 'main', summary: 'Read README.md' },
  ])

  await $.turn.complete(turn('agent-1') as never)
  expect(s.state.events.slice(-2)).toMatchObject([
    { type: 'AgentFinished', agentId: 'agent-1' },
    { type: 'UsageUpdated', agentId: 'agent-1', model: 'claude-haiku-4-5', tokens: { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0 } },
  ])
  const u = s.state.events.at(-1) as Extract<SceneEvent, { type: 'UsageUpdated' }>
  expect(Math.abs(u.estCostUsd! - (1200 * 1 + 300 * 5) / 1_000_000)).toBeLessThan(1e-12)
})

test('the agent type is read from the Agent tool\'s own input too', async ($, on) => {
  world(on)
  agents(on)
  const s = surfaces(on)
  await $.agent.spawn({ subagent_type: 'reviewer', prompt: 'p', description: 'd', tool_use_id: 'tu-2' } as never)
  expect(s.state.events.at(-1)).toMatchObject({ type: 'AgentLaunched', agentType: 'reviewer' })
})

test('the Sentinel is not launched as a fleet agent, and a refused spawn launches nothing', async ($, on) => {
  world(on)
  let n = 0
  on('agent.spawn', () => (++n === 1 ? { model: 'haiku', agentId: 'sentinel-x' } : { deny: 'no' }))
  const s = surfaces(on)
  await $.agent.spawn({ subagentType: 'omnis-watchtower:sentinel', prompt: 'p', description: 'd', tool_use_id: 'tu-3' } as never)
  await $.agent.spawn({ subagentType: 'Explore', prompt: 'p', description: 'd', tool_use_id: 'tu-4' } as never)
  expect(types(s)).not.toContain('AgentLaunched')
})

test('main-loop usage is counted, unpriced models carry no estimate', async ($, on) => {
  world(on)
  const s = surfaces(on)
  await $.turn.complete(turn(undefined, { ...usage, model: 'some-partner-model' }) as never)
  const u = s.state.events.at(-1) as Extract<SceneEvent, { type: 'UsageUpdated' }>
  expect(u).toMatchObject({ type: 'UsageUpdated', agentId: 'main', model: 'some-partner-model' })
  expect('estCostUsd' in u).toBe(false)
  expect(types(s)).not.toContain('AgentFinished')
  expect(s.status.at(-1)).toBe('🛡 0 ✔ · 0 ◆ · 0 ✖ · 1.5k tokens')
})

test('a refusal updates the status line and raises one toast (US3-6, FR-022)', async ($, on) => {
  world(on)
  const s = surfaces(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'npm i react-dom-utilz' })
  expect(r.deny).toMatch(/^WATCHTOWER REFUSED/)
  expect(s.status.at(-1)).toBe('🛡 0 ✔ · 0 ◆ · 1 ✖ · 0 tokens')
  expect(s.toasts).toHaveLength(1)
  expect(s.toasts[0]).toMatch(/^✖ Watchtower refused npm:react-dom-utilz — /)
  // The refused command never reached the fleet hook: no action logged for it
  expect(types(s)).not.toContain('AgentActed')
})

test('a hold toasts once, not again on retry', async ($, on) => {
  world(on)
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'sentinel-1' }))
  const s = surfaces(on)
  await $.tool.call({ tool: 'Bash', command: 'npm i zod@4.6.7' })
  await $.tool.call({ tool: 'Bash', command: 'npm i zod@4.6.7' })
  expect(s.toasts.filter(t => t.startsWith('◆'))).toHaveLength(1)
  expect(s.toasts[0]).toMatch(/^◆ Watchtower held npm:zod@4\.6\.7 — .*; a Sentinel is investigating$/)
  expect(s.status.at(-1)).toMatch(/^🛡 0 ✔ · 2 ◆ · 0 ✖ · /)
})

test('a fault toasts and marks the status line', { options: { faultInjection: true } }, async ($, on) => {
  world(on)
  const s = surfaces(on)
  await $.tool.call({ tool: 'Bash', command: 'npm i react-dom-utilz' })
  expect(s.status.at(-1)).toMatch(/ · ⚠ FAULT$/)
  // The gate toasts its own fault; status.ts adds no second one
  expect(s.toasts.filter(t => t.startsWith('⚠'))).toHaveLength(1)
})

test('a verdict reaches the agent once, on its next turn (FR-018)', async ($, on) => {
  world(on)
  const spawned: string[] = []
  on('agent.spawn', (_$, e) => (spawned.push(String((e as { prompt: string }).prompt)), { model: 'haiku', agentId: 'sentinel-1' }))
  const prompts: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$, e) => (prompts.push(e.context), { text: e.text, context: e.context }))
  const s = surfaces(on)
  await $.tool.call({ tool: 'Bash', command: 'npm i zod@4.6.7' })
  const token = spawned[0]?.match(/Investigation id: (\S+)/)?.[1]
  const verdict = { investigation: token, verdict: 'allow', confidence: 0.9, evidence: ['Maintained by the zod authors'] }
  await $.turn.complete({ answer: JSON.stringify(verdict), agentId: 'sentinel-1', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't-s' } as never)
  expect(s.toasts.filter(t => t.includes('cleared by the Sentinel'))).toHaveLength(1)

  await $.prompt.submit({ text: 'carry on', wait: false } as never)
  await $.prompt.submit({ text: 'and again', wait: false } as never)
  expect(prompts[0]).toEqual(['WATCHTOWER VERDICT npm:zod@4.6.7 → allowed: Maintained by the zod authors'])
  expect(prompts[1] ?? []).toEqual([])
})

test('a queued verdict rides the main loop\'s next tool result instead, once', async ($, on) => {
  world(on)
  const spawned: string[] = []
  on('agent.spawn', (_$, e) => (spawned.push(String((e as { prompt: string }).prompt)), { model: 'haiku', agentId: 'sentinel-1' }))
  surfaces(on)
  await $.tool.call({ tool: 'Bash', command: 'npm i zod@4.6.7' })
  const token = spawned[0]?.match(/Investigation id: (\S+)/)?.[1]
  const verdict = { investigation: token, verdict: 'block', confidence: 0.8, evidence: ['postinstall runs a binary'] }
  await $.turn.complete({ answer: JSON.stringify(verdict), agentId: 'sentinel-1', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't-s' } as never)
  const first = await $.tool.call({ tool: 'Read', file_path: 'README.md' } as never)
  const second = await $.tool.call({ tool: 'Read', file_path: 'README.md' } as never)
  expect(first.context).toEqual(['WATCHTOWER VERDICT npm:zod@4.6.7 → refused: postinstall runs a binary'])
  expect(second.context ?? []).toEqual([])
})

const run = (args: string) => ({ command: 'watchtower', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } })

test('/watchtower status and legend explain the figures', async ($, on) => {
  world(on)
  surfaces(on)
  await $.tool.call({ tool: 'Bash', command: 'npm i react-dom-utilz' })
  const status = await $.command.run(run('status'))
  expect(status.text).toContain('✖ refused 1')
  expect(status.text).toContain('Investigations in progress: none')
  expect(status.text).toContain('Faults: none')
  const legend = await $.command.run(run('legend'))
  expect(legend.text).toContain('What it counts and leaves out')
  expect(legend.text).toContain('≈ $ est.')
})
