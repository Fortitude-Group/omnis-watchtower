import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { NOW, world } from './helpers/world'

const HELD = 'npm i zod@4.6.7' // a 7-hour-old release asked for explicitly: held, not pinned (US1-10)

// The engine's Agent tool, beneath the plugin: records each spawn and hands back an id
const sentinels = (on: On) => {
  const spawned: { subagentType: string; prompt: string }[] = []
  on('agent.spawn', (_$, e) => {
    // The engine hands the hook the Agent tool's own input (subagent_type), whatever the types say
    const input = e as unknown as { subagent_type?: string; subagentType?: string; prompt: string }
    spawned.push({ subagentType: String(input.subagent_type ?? input.subagentType), prompt: String(input.prompt) })
    return { model: 'haiku', agentId: `sentinel-${spawned.length}` }
  })
  return spawned
}

const answer = (agentId: string, text: string, reason: 'answer' | 'error' = 'answer') => ({
  answer: text, agentId, reason, durationMs: 1200, isAborted: false, turnId: `t-${agentId}`,
})

// The investigation id the Sentinel was given, as a real one would echo it
const tokenOf = (prompt: string) => prompt.match(/Investigation id: (\S+)/)?.[1] ?? 'missing'
const say = (spawned: { prompt: string }[], n: number, v: object) => JSON.stringify({ investigation: tokenOf(spawned[n]!.prompt), ...v })

const allow = { verdict: 'allow', confidence: 0.9, evidence: ['Maintained by the zod authors; no install scripts'] }
const block = { verdict: 'block', confidence: 0.8, evidence: ['postinstall downloads and runs a binary'] }

test('a held package dispatches exactly one hidden Sentinel, even across retries (US2-1)', async ($, on) => {
  world(on)
  const spawned = sentinels(on)
  const first = await $.tool.call({ tool: 'Bash', command: HELD })
  expect(first.deny).toMatch(/^WATCHTOWER HELD npm:zod@4.6.7/)
  expect(spawned).toHaveLength(1)
  expect(spawned[0]!.subagentType).toBe('omnis-watchtower:sentinel')
  expect(spawned[0]!.prompt).toContain('untrusted data')
  const again = await $.tool.call({ tool: 'Bash', command: HELD })
  expect(again.deny).toMatch(/^WATCHTOWER HELD/)
  expect(spawned).toHaveLength(1)
})

test('an "allow" verdict lets the retry run (US2-2)', async ($, on) => {
  const w = world(on)
  const spawned = sentinels(on)
  await $.tool.call({ tool: 'Bash', command: HELD })
  await $.turn.complete(answer('sentinel-1', say(spawned, 0, allow)))
  const retry = await $.tool.call({ tool: 'Bash', command: HELD })
  expect(retry.deny).toBeUndefined()
  expect(w.ran).toEqual([HELD])
})

test('a "block" verdict refuses the retry with the Sentinel\'s evidence (US2-3)', async ($, on) => {
  const w = world(on)
  const spawned = sentinels(on)
  await $.tool.call({ tool: 'Bash', command: HELD })
  await $.turn.complete(answer('sentinel-1', say(spawned, 0, block)))
  const retry = await $.tool.call({ tool: 'Bash', command: HELD })
  expect(retry.deny).toContain('the Sentinel found it unsafe')
  expect(retry.deny).toContain('postinstall downloads and runs a binary')
  expect(w.ran).toEqual([])
})

// Malformed output and errored turns are matched by agent id, which a hook-answered spawn never has
// ("agentId: set by core"); tests/core/sentinel/turn.test.ts covers those paths.

test('a verdict that never arrives times out and refuses on retry (US2-4)', async ($, on) => {
  const w = world(on)
  sentinels(on)
  await $.tool.call({ tool: 'Bash', command: HELD })
  await w.clock.advance(181_000)
  const retry = await $.tool.call({ tool: 'Bash', command: HELD })
  expect(retry.deny).toContain('investigation timed out')
  expect(retry.deny).toContain('/watchtower recheck npm:zod')
})

test('turns from other agents are ignored', async ($, on) => {
  world(on)
  sentinels(on)
  await $.tool.call({ tool: 'Bash', command: HELD })
  await $.turn.complete(answer('some-other-agent', JSON.stringify({ investigation: 'wt-not-ours', ...allow })))
  const retry = await $.tool.call({ tool: 'Bash', command: HELD })
  expect(retry.deny).toMatch(/^WATCHTOWER HELD/)
})

test('NOW is the fixed test date', () => {
  expect(new Date(NOW).toISOString()).toBe('2026-10-13T00:00:00.000Z')
})
