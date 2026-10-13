import { describe, expect, test } from 'vitest'
import { emptyScene, type Scene, type SceneEvent } from '../../../src/plugin/core/scene/events'
import {
  BURST_MS,
  ENTRY_DISTANCE,
  MAX_AGENTS,
  MAX_EFFECTS,
  MAX_PACKAGES,
  MAX_SENTINELS,
  RING_STOP,
  SHIP,
  TRAIL_LENGTH,
  distance,
} from '../../../src/plugin/core/scene/layout'
import { packageId, reduce } from '../../../src/plugin/core/scene/reduce'
import { step } from '../../../src/plugin/core/scene/step'
import { draw } from '../../../src/plugin/core/scene/prng'
import { key } from '../../../src/plugin/core/model'
import type { Tier } from '../../../src/plugin/types'
import { deepFreeze, ev, ref } from './helpers'

const run = (scene: Scene, ms: number, dt = 33): Scene => {
  let s = scene
  for (let t = 0; t < ms; t += dt) s = step(s, dt)
  return s
}

const chalk = ref('chalk')
const id = packageId('r1', key(chalk))
const inbound = (): Scene => reduce(emptyScene(5), ev({ type: 'PackageIntercepted', requestId: 'r1', agentId: 'a1', ref: chalk }))
const scored = (s: Scene, tier: Tier): Scene => reduce(s, ev({ type: 'PackageScored', requestId: 'r1', ref: chalk, tier, evidence: [] }))
const flight = ((ENTRY_DISTANCE - RING_STOP) / 0.15) * 1000

describe('agents', () => {
  const launched = () => reduce(emptyScene(9), ev({ type: 'AgentLaunched', agentId: 'a1', agentType: 'coder' }))

  test('a launching agent eases out to its orbit, then works', () => {
    const s = run(launched(), 4000)
    const a = s.agents.a1!
    expect(a.state).toBe('working')
    expect(distance(a.pos, SHIP)).toBeCloseTo(a.orbit.radius, 2)
    expect(a.trail).toHaveLength(TRAIL_LENGTH)
  })

  test('it keeps orbiting', () => {
    const s1 = run(launched(), 4000)
    const s2 = run(s1, 500)
    expect(s2.agents.a1!.orbit.angle).not.toBeCloseTo(s1.agents.a1!.orbit.angle)
    expect(distance(s2.agents.a1!.pos, SHIP)).toBeCloseTo(s1.agents.a1!.orbit.radius, 2)
  })

  test('a glint decays to zero', () => {
    const s = reduce(run(launched(), 1000), ev({ type: 'AgentActed', agentId: 'a1', summary: 'x' }))
    expect(run(s, 1000).agents.a1!.glint).toBe(0)
  })

  test('a returning agent docks and is removed', () => {
    const s = reduce(run(launched(), 4000), ev({ type: 'AgentFinished', agentId: 'a1' }))
    expect(run(s, 500).agents.a1!.state).toBe('returning')
    expect(run(s, 4000).agents.a1).toBeUndefined()
  })
})

describe('packages', () => {
  test('an inbound package flies to the ring and waits there unscored', () => {
    const half = run(inbound(), flight / 2)
    const d = distance(half.packages[id]!.pos, SHIP)
    expect(d).toBeLessThan(ENTRY_DISTANCE)
    expect(d).toBeGreaterThan(RING_STOP)
    const s = run(inbound(), flight + 200)
    expect(s.packages[id]).toMatchObject({ phase: 'atRing', distance: RING_STOP })
    expect(run(s, 5000).packages[id]!.phase).toBe('atRing')
  })

  test('a passing package flows through to the ship, flashes and is removed', () => {
    const s = run(scored(inbound(), 'pass'), flight + 200)
    expect(s.packages[id]!.phase).toBe('passing')
    const done = run(s, 1650)
    expect(done.packages[id]).toBeUndefined()
    expect(done.effects.some((e) => e.kind === 'pass-flash')).toBe(true)
    expect(run(done, 1000).effects).toHaveLength(0)
  })

  test('a refused package bursts at the ring, then is removed', () => {
    const s = run(scored(inbound(), 'refuse'), flight + 100)
    expect(s.packages[id]!.phase).toBe('bursting')
    expect(s.effects[0]!.kind).toBe('burst')
    expect(run(s, BURST_MS + 100).packages[id]).toBeUndefined()
  })

  test('a held package freezes at the ring until a verdict', () => {
    const s = run(scored(inbound(), 'hold'), flight + 100)
    expect(s.packages[id]!.phase).toBe('held')
    const later = run(s, 10_000)
    expect(later.packages[id]).toMatchObject({ phase: 'held', distance: RING_STOP })
  })

  test('scoring a package already waiting at the ring resolves it', () => {
    const s = scored(run(inbound(), flight + 200), 'pass')
    expect(s.packages[id]!.phase).toBe('passing')
  })

  test('effects decay and are removed', () => {
    const s = scored(run(inbound(), flight + 200), 'refuse')
    const e = s.effects[0]!
    expect(run(s, 500).effects[0]!.lifeMs).toBeLessThan(e.lifeMs)
    expect(run(s, e.totalMs + 50).effects).toHaveLength(0)
  })
})

describe('sentinel', () => {
  test('flies out to the held package, scans until the verdict, then returns and docks', () => {
    let s = run(scored(inbound(), 'hold'), flight + 100)
    s = reduce(s, ev({ type: 'SentinelDispatched', key: key(chalk), sentinelId: 's1' }))
    const mid = run(s, 150)
    expect(mid.sentinels.s1!.phase).toBe('outbound')
    expect(distance(mid.sentinels.s1!.pos, SHIP)).toBeGreaterThan(0)
    s = run(s, 2000)
    expect(s.sentinels.s1!.phase).toBe('scanning')
    expect(s.sentinels.s1!.pos).toEqual(s.packages[id]!.pos)
    s = run(s, 3000)
    expect(s.sentinels.s1!.phase).toBe('scanning')
    expect(s.sentinels.s1!.phaseMs).toBeGreaterThan(2900)
    s = reduce(s, ev({ type: 'VerdictIssued', key: key(chalk), tier: 'pass', evidence: [] }))
    s = run(s, 200)
    expect(s.sentinels.s1!.phase).toBe('returning')
    expect(s.packages[id]!.phase).toBe('passing')
    expect(run(s, 3000).sentinels.s1).toBeUndefined()
  })

  test('with nothing to inspect it turns back', () => {
    const s = reduce(emptyScene(1), ev({ type: 'SentinelDispatched', key: 'npm:none@1', sentinelId: 's1' }))
    expect(step(s, 33).sentinels.s1!.phase).toBe('returning')
  })
})

describe('determinism and purity', () => {
  const log = (): SceneEvent[] => [
    ev({ type: 'AgentLaunched', agentId: 'a1', agentType: 'coder' }),
    ev({ type: 'AgentLaunched', agentId: 'a2', agentType: 'researcher' }),
    ev({ type: 'PackageIntercepted', requestId: 'r1', agentId: 'a1', ref: chalk }),
    ev({ type: 'PackageScored', requestId: 'r1', ref: chalk, tier: 'refuse', evidence: ['x'] }),
    ev({ type: 'PackageIntercepted', requestId: 'r2', agentId: 'a2', ref: ref('left-padx') }),
    ev({ type: 'PackageScored', requestId: 'r2', ref: ref('left-padx'), tier: 'hold', evidence: [] }),
    ev({ type: 'SentinelDispatched', key: key(ref('left-padx')), sentinelId: 's1' }),
  ]
  const play = (seed: number): Scene => {
    let s = emptyScene(seed)
    for (const e of log()) s = run(reduce(s, e), 700)
    return run(s, 2000)
  }

  test('the same seed and event log give the identical scene', () => {
    expect(JSON.stringify(play(77))).toBe(JSON.stringify(play(77)))
  })

  test('a different seed gives a different layout', () => {
    expect(JSON.stringify(play(77))).not.toBe(JSON.stringify(play(78)))
  })

  test('recorded event log snapshot', () => {
    const s = play(2026)
    const r = (n: number) => Math.round(n * 1e4) / 1e4
    expect({
      t: s.t,
      rng: s.rng,
      totals: s.totals,
      agents: Object.values(s.agents).map((a) => ({ id: a.id, state: a.state, x: r(a.pos.x), y: r(a.pos.y) })),
      packages: Object.values(s.packages).map((p) => ({ id: p.id, phase: p.phase, x: r(p.pos.x), y: r(p.pos.y) })),
      sentinels: Object.values(s.sentinels).map((x) => ({ id: x.id, phase: x.phase })),
      log: s.log.map((l) => `${l.glyph} ${l.text}`),
    }).toMatchSnapshot()
  })

  test('step never mutates its input and ignores non-positive dt', () => {
    let s = emptyScene(4)
    for (const e of log()) s = reduce(s, e)
    s = run(s, 1700)
    const before = JSON.stringify(s)
    deepFreeze(s)
    const n = step(s, 33)
    expect(JSON.stringify(s)).toBe(before)
    expect(n).not.toBe(s)
    expect(step(s, 0)).toBe(s)
  })

  test('10,000 events with steps stay bounded', () => {
    let s = emptyScene(11)
    let rng = 99
    const tiers: Tier[] = ['pass', 'refuse', 'hold', 'unverified', 'unchecked']
    let maxPk = 0
    let maxAg = 0
    let maxFx = 0
    let maxSn = 0
    for (let i = 0; i < 10_000; i++) {
      const d = draw(rng, 3)
      rng = d.state
      const [a = 0, b = 0, c = 0] = d.values
      const pick = Math.floor(a * 8)
      const agentId = `a${Math.floor(b * 40)}`
      const pkg = ref(`p${Math.floor(c * 200)}`)
      const req = `r${i % 300}`
      const e: SceneEvent =
        pick === 0 ? ev({ type: 'AgentLaunched', agentId, agentType: 'coder' })
        : pick === 1 ? ev({ type: 'AgentFinished', agentId })
        : pick === 2 ? ev({ type: 'AgentActed', agentId, summary: 'x' })
        : pick === 3 ? ev({ type: 'PackageIntercepted', requestId: req, agentId, ref: pkg })
        : pick === 4 ? ev({ type: 'PackageScored', requestId: req, ref: pkg, tier: tiers[Math.floor(b * 5)]!, evidence: [] })
        : pick === 5 ? ev({ type: 'SentinelDispatched', key: key(pkg), sentinelId: `s${i}` })
        : pick === 6 ? ev({ type: 'VerdictIssued', key: key(pkg), tier: tiers[Math.floor(b * 5)]!, evidence: [] })
        : ev({ type: 'UsageUpdated', agentId, model: 'm', tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } })
      s = step(reduce(s, e), 33)
      maxPk = Math.max(maxPk, Object.keys(s.packages).length)
      maxAg = Math.max(maxAg, Object.keys(s.agents).length)
      maxSn = Math.max(maxSn, Object.keys(s.sentinels).length)
      maxFx = Math.max(maxFx, s.effects.length)
      expect(s.log.length).toBeLessThanOrEqual(50)
    }
    expect(maxPk).toBeLessThanOrEqual(MAX_PACKAGES)
    expect(maxAg).toBeLessThanOrEqual(MAX_AGENTS)
    expect(maxSn).toBeLessThanOrEqual(MAX_SENTINELS)
    expect(maxFx).toBeLessThanOrEqual(MAX_EFFECTS)
    for (const a of Object.values(s.agents)) expect(a.trail.length).toBeLessThanOrEqual(TRAIL_LENGTH)
  })
})
