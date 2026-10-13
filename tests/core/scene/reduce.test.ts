import { describe, expect, test } from 'vitest'
import { emptyScene, LOG_LIMIT, type Scene, type SceneEvent } from '../../../src/plugin/core/scene/events'
import { ENTRY_DISTANCE, LAUNCH_RADIUS, ORBIT_MAX, ORBIT_MIN, RING_STOP, SHIP, distance, polar } from '../../../src/plugin/core/scene/layout'
import { packageId, reduce } from '../../../src/plugin/core/scene/reduce'
import { key } from '../../../src/plugin/core/model'
import { deepFreeze, ev, ref } from './helpers'

const fold = (events: SceneEvent[], scene: Scene = emptyScene(1)): Scene => events.reduce(reduce, scene)

const atRing = (scene: Scene, id: string): Scene => {
  const p = scene.packages[id]!
  return { ...scene, packages: { ...scene.packages, [id]: { ...p, phase: 'atRing', distance: RING_STOP, pos: polar(p.angle, RING_STOP) } } }
}

describe('agents', () => {
  test('AgentLaunched adds a launching unit at the ship with a seeded orbit', () => {
    const s0 = emptyScene(1)
    const s = reduce(s0, ev({ type: 'AgentLaunched', agentId: 'a1', agentType: 'coder' }))
    const a = s.agents.a1!
    expect(a.state).toBe('launching')
    expect(a.type).toBe('coder')
    expect(distance(a.pos, SHIP)).toBeCloseTo(LAUNCH_RADIUS)
    expect(a.orbit.radius).toBeGreaterThanOrEqual(ORBIT_MIN)
    expect(a.orbit.radius).toBeLessThanOrEqual(ORBIT_MAX)
    expect(Math.abs(a.orbit.speed)).toBeGreaterThan(0)
    expect(s.rng).not.toBe(s0.rng)
    expect(s.log.at(-1)).toMatchObject({ glyph: '▲', tone: 'agent', text: 'coder launched' })
  })

  test('main is the ship, never an orbiting unit', () => {
    const s = fold([ev({ type: 'AgentLaunched', agentId: 'main', agentType: 'main' })])
    expect(s.agents).toEqual({})
  })

  test('AgentActed glints, records the action and logs it', () => {
    const s = fold([
      ev({ type: 'AgentLaunched', agentId: 'a1', agentType: 'coder' }),
      ev({ type: 'AgentActed', agentId: 'a1', summary: 'Edit auth.ts' }),
    ])
    expect(s.agents.a1!.lastAction).toBe('Edit auth.ts')
    expect(s.agents.a1!.glint).toBeGreaterThan(0)
    expect(s.log.at(-1)!.text).toBe('coder · Edit auth.ts')
  })

  test('AgentActed by main only logs', () => {
    const s = fold([ev({ type: 'AgentActed', agentId: 'main', summary: 'Bash ls' })])
    expect(s.agents).toEqual({})
    expect(s.log.at(-1)!.text).toBe('main · Bash ls')
  })

  test('AgentFinished sends the unit home and logs it', () => {
    const s = fold([
      ev({ type: 'AgentLaunched', agentId: 'a1', agentType: 'tester' }),
      ev({ type: 'AgentFinished', agentId: 'a1' }),
    ])
    expect(s.agents.a1!.state).toBe('returning')
    expect(s.log.at(-1)).toMatchObject({ glyph: '●', text: 'tester done' })
  })

  test('UsageUpdated accumulates per agent and for the scene, and tracks unpriced tokens', () => {
    const tokens = { input: 100, output: 20, cacheRead: 5, cacheWrite: 1 }
    const s = fold([
      ev({ type: 'AgentLaunched', agentId: 'a1', agentType: 'coder' }),
      ev({ type: 'UsageUpdated', agentId: 'a1', model: 'm', tokens, estCostUsd: 0.5 }),
      ev({ type: 'UsageUpdated', agentId: 'a1', model: 'm', tokens, estCostUsd: 0.25 }),
      ev({ type: 'UsageUpdated', agentId: 'main', model: 'unknown', tokens }),
    ])
    expect(s.agents.a1!.tokens).toEqual({ input: 200, output: 40, cacheRead: 10, cacheWrite: 2 })
    expect(s.agents.a1!.estCostUsd).toBeCloseTo(0.75)
    expect(s.tokens).toEqual({ input: 300, output: 60, cacheRead: 15, cacheWrite: 3 })
    expect(s.estCostUsd).toBeCloseTo(0.75)
    expect(s.unpricedTokens).toBe(126)
  })
})

describe('packages', () => {
  const chalk = ref('chalk')
  const id = packageId('r1', key(chalk))
  const intercepted = () => fold([ev({ type: 'PackageIntercepted', requestId: 'r1', agentId: 'a1', ref: chalk })])

  test('PackageIntercepted adds an inbound sprite beyond the ring and counts it', () => {
    const s = intercepted()
    const p = s.packages[id]!
    expect(p).toMatchObject({ phase: 'inbound', key: 'npm:chalk@1.0.0', agentId: 'a1', distance: ENTRY_DISTANCE })
    expect(distance(p.pos, SHIP)).toBeCloseTo(ENTRY_DISTANCE)
    expect(s.totals.intercepts).toBe(1)
  })

  test('PackageScored on an inbound sprite records the tier; it keeps flying', () => {
    const s = reduce(intercepted(), ev({ type: 'PackageScored', requestId: 'r1', ref: chalk, tier: 'pass', evidence: ['ok'] }))
    expect(s.packages[id]).toMatchObject({ phase: 'inbound', tier: 'pass', evidence: ['ok'] })
    expect(s.totals.passed).toBe(1)
    expect(s.log.at(-1)).toMatchObject({ glyph: '✔', tone: 'pass', text: 'chalk passed' })
  })

  test.each([
    ['pass', 'passing', 'passed'],
    ['unverified', 'passing', 'unverified'],
    ['unchecked', 'passing', 'unchecked'],
    ['refuse', 'bursting', 'refused'],
    ['hold', 'held', 'held'],
  ] as const)('PackageScored %s at the ring → %s', (tier, phase, total) => {
    const s = reduce(atRing(intercepted(), id), ev({ type: 'PackageScored', requestId: 'r1', ref: chalk, tier, evidence: ['why'] }))
    expect(s.packages[id]!.phase).toBe(phase)
    expect(s.totals[total]).toBe(1)
    expect(s.effects.length).toBe(tier === 'refuse' ? 1 : 0)
    if (tier === 'refuse') {
      expect(s.effects[0]).toMatchObject({ kind: 'burst', tone: 'refuse' })
      expect(s.log.at(-1)).toMatchObject({ glyph: '✖', text: 'chalk refused · why' })
    }
    if (tier === 'hold') expect(s.log.at(-1)).toMatchObject({ glyph: '◆', tone: 'hold' })
  })

  test('PackageScored with no intercept still shows the package', () => {
    const s = fold([ev({ type: 'PackageScored', requestId: 'r9', ref: chalk, tier: 'refuse', evidence: [] })])
    expect(s.packages[packageId('r9', key(chalk))]).toMatchObject({ phase: 'inbound', tier: 'refuse' })
  })

  test('a held package resolved by a verdict counts once as held and once in its final tier', () => {
    let s = reduce(atRing(intercepted(), id), ev({ type: 'PackageScored', requestId: 'r1', ref: chalk, tier: 'hold', evidence: [] }))
    s = reduce(s, ev({ type: 'SentinelDispatched', key: key(chalk), sentinelId: 's1' }))
    expect(s.sentinels.s1).toMatchObject({ phase: 'outbound', targetKey: key(chalk), pos: SHIP })
    s = reduce(s, ev({ type: 'VerdictIssued', key: key(chalk), tier: 'refuse', evidence: ['obfuscated postinstall'] }))
    expect(s.packages[id]!.phase).toBe('bursting')
    expect(s.sentinels.s1!.phase).toBe('returning')
    expect(s.totals).toMatchObject({ intercepts: 1, held: 1, refused: 1 })
    expect(s.log.at(-1)!.text).toBe('chalk refused · obfuscated postinstall')
  })

  test('a held package cleared by a verdict passes', () => {
    let s = reduce(atRing(intercepted(), id), ev({ type: 'PackageScored', requestId: 'r1', ref: chalk, tier: 'hold', evidence: [] }))
    s = reduce(s, ev({ type: 'VerdictIssued', key: key(chalk), tier: 'pass', evidence: [] }))
    expect(s.packages[id]!.phase).toBe('passing')
    expect(s.totals).toMatchObject({ held: 1, passed: 1 })
    expect(s.log.at(-1)!.text).toBe('chalk cleared')
  })

  test('a hold verdict keeps it held and is not counted twice', () => {
    let s = reduce(atRing(intercepted(), id), ev({ type: 'PackageScored', requestId: 'r1', ref: chalk, tier: 'hold', evidence: [] }))
    s = reduce(s, ev({ type: 'SentinelDispatched', key: key(chalk), sentinelId: 's1' }))
    s = reduce(s, ev({ type: 'VerdictIssued', key: key(chalk), tier: 'hold', evidence: ['timed out'] }))
    expect(s.packages[id]!.phase).toBe('held')
    expect(s.sentinels.s1!.phase).toBe('outbound')
    expect(s.totals.held).toBe(1)
  })

  test('a verdict for a key with no sprite still counts and logs by name', () => {
    const s = fold([ev({ type: 'VerdictIssued', key: 'pypi:reqeusts@2.0', tier: 'refuse', evidence: [] })])
    expect(s.totals.refused).toBe(1)
    expect(s.log.at(-1)!.text).toBe('reqeusts refused')
  })
})

describe('scene-wide', () => {
  test('OverrideApplied counts and logs', () => {
    const s = fold([ev({ type: 'OverrideApplied', key: 'npm:foo@1', action: 'allow', scope: 'session' })])
    expect(s.totals.overridden).toBe(1)
    expect(s.log.at(-1)!.text).toBe('override allow foo (session)')
  })

  test('Fault sets and FaultCleared clears scene.fault', () => {
    let s = fold([ev({ type: 'Fault', where: 'gate', message: 'boom' }, 42)])
    expect(s.fault).toEqual({ where: 'gate', message: 'boom', at: 42 })
    expect(s.log.at(-1)).toMatchObject({ glyph: '⚠', tone: 'fault' })
    s = reduce(s, ev({ type: 'FaultCleared' }))
    expect(s.fault).toBeUndefined()
    expect('fault' in s).toBe(false)
  })

  test('the log is capped at LOG_LIMIT, newest last', () => {
    const events = Array.from({ length: LOG_LIMIT + 20 }, (_, i) => ev({ type: 'AgentActed', agentId: 'main', summary: `step ${i}` }, i))
    const s = fold(events)
    expect(s.log).toHaveLength(LOG_LIMIT)
    expect(s.log.at(-1)!.text).toBe(`main · step ${LOG_LIMIT + 19}`)
    expect(s.log[0]!.text).toBe('main · step 20')
  })

  test('reduce never mutates its input', () => {
    const chalk = ref('chalk')
    const events: SceneEvent[] = [
      ev({ type: 'AgentLaunched', agentId: 'a1', agentType: 'coder' }),
      ev({ type: 'AgentActed', agentId: 'a1', summary: 'x' }),
      ev({ type: 'UsageUpdated', agentId: 'a1', model: 'm', tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, estCostUsd: 0.1 }),
      ev({ type: 'PackageIntercepted', requestId: 'r1', agentId: 'a1', ref: chalk }),
      ev({ type: 'PackageScored', requestId: 'r1', ref: chalk, tier: 'hold', evidence: [] }),
      ev({ type: 'SentinelDispatched', key: key(chalk), sentinelId: 's1' }),
      ev({ type: 'VerdictIssued', key: key(chalk), tier: 'refuse', evidence: [] }),
      ev({ type: 'OverrideApplied', key: key(chalk), action: 'block', scope: 'permanent' }),
      ev({ type: 'Fault', where: 'render', message: 'x' }),
      ev({ type: 'FaultCleared' }),
      ev({ type: 'AgentFinished', agentId: 'a1' }),
    ]
    let s = emptyScene(3)
    for (const e of events) {
      const before = JSON.stringify(s)
      deepFreeze(s)
      const next = reduce(s, e)
      expect(JSON.stringify(s)).toBe(before)
      s = next
    }
    // also exercise the at-ring path on a frozen scene
    const ringed = deepFreeze(atRing(fold(events.slice(0, 4), emptyScene(3)), packageId('r1', key(chalk))))
    expect(() => reduce(ringed, events[4]!)).not.toThrow()
  })
})

test('a pinned package keeps its pin on the sprite for the label (FR-035)', async () => {
  const { reduce } = await import('../../../src/plugin/core/scene/reduce')
  const { emptyScene } = await import('../../../src/plugin/core/scene/events')
  const ref = { ecosystem: 'npm' as const, name: 'zod' }
  let s = reduce(emptyScene(1), { type: 'PackageIntercepted', requestId: 'r1', agentId: 'main', ref, at: 0, seq: 1 })
  s = reduce(s, { type: 'PackageScored', requestId: 'r1', ref, tier: 'pass', evidence: ['pinned'], pinnedTo: '4.6.5', at: 1, seq: 2 })
  expect(Object.values(s.packages)[0]?.pinnedTo).toBe('4.6.5')
})
