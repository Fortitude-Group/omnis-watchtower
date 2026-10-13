// reduce(scene, event): folds one domain fact into the Scene. Pure: the input is never mutated,
// and the only randomness is the seeded PRNG state carried in scene.rng.

import { key as refKey } from '../model'
import type { Tier, TokenUsage } from '../../types'
import { draw } from './prng'
import {
  BURST_EFFECT_MS,
  ENTRY_DISTANCE,
  GLINT_MS,
  LAUNCH_RADIUS,
  MAX_AGENTS,
  MAX_PACKAGES,
  MAX_SENTINELS,
  ORBIT_MAX,
  ORBIT_MIN,
  ORBIT_SPEED_MAX,
  ORBIT_SPEED_MIN,
  SHIP,
  polar,
} from './layout'
import {
  LOG_LIMIT,
  type AgentSprite,
  type Effect,
  type LogLine,
  type PackageSprite,
  type Scene,
  type SceneEvent,
  type Totals,
} from './events'

/** The ship IS the main agent; it never appears as an orbiting unit. */
export const MAIN_AGENT = 'main'

export const packageId = (requestId: string, key: string): string => `${requestId}|${key}`

const tierTotal: Record<Tier, keyof Totals> = {
  pass: 'passed',
  hold: 'held',
  refuse: 'refused',
  unverified: 'unverified',
  unchecked: 'unchecked',
}

export const isPassing = (tier: Tier): boolean => tier === 'pass' || tier === 'unverified' || tier === 'unchecked'

/** Keeps the newest `max` entries of a record (insertion order is age order). */
export const capRecord = <T>(rec: Record<string, T>, max: number): Record<string, T> => {
  const keys = Object.keys(rec)
  if (keys.length <= max) return rec
  const out: Record<string, T> = {}
  for (const k of keys.slice(keys.length - max)) out[k] = rec[k] as T
  return out
}

const addLog = (log: LogLine[], line: LogLine): LogLine[] => {
  const out = [...log, line]
  return out.length > LOG_LIMIT ? out.slice(out.length - LOG_LIMIT) : out
}

const sumTokens = (t: TokenUsage): number => t.input + t.output + t.cacheRead + t.cacheWrite

const addTokens = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

/** `npm:left-padx@1.0.0` → `left-padx`, for verdicts on keys with no sprite left to name them. */
const nameFromKey = (key: string): string => {
  const body = key.slice(key.indexOf(':') + 1)
  const at = body.lastIndexOf('@')
  return at > 0 ? body.slice(0, at) : body
}

const verdictLine = (name: string, tier: Tier, evidence: string[], at: number, resolved: boolean): LogLine => {
  const why = evidence[0] ? ` · ${evidence[0]}` : ''
  switch (tier) {
    case 'pass':
      return { at, glyph: '✔', tone: 'pass', text: `${name} ${resolved ? 'cleared' : 'passed'}` }
    case 'hold':
      return { at, glyph: '◆', tone: 'hold', text: `${name} held${why}` }
    case 'refuse':
      return { at, glyph: '✖', tone: 'refuse', text: `${name} refused${why}` }
    default:
      return { at, glyph: '·', tone: 'neutral', text: `${name} ${tier}${why}` }
  }
}

export const burstAt = (scene: Scene, pkg: PackageSprite): { effect: Effect; rng: number } => {
  const r = draw(scene.rng, 1)
  const seed = Math.floor((r.values[0] ?? 0) * 4294967296) >>> 0
  return {
    effect: { kind: 'burst', pos: pkg.pos, tone: 'refuse', lifeMs: BURST_EFFECT_MS, totalMs: BURST_EFFECT_MS, seed },
    rng: r.state,
  }
}

/** Applies a final tier to a package that is already waiting at the ring. */
export const resolveAtRing = (scene: Scene, pkg: PackageSprite, tier: Tier): Scene => {
  if (tier === 'hold') return { ...scene, packages: { ...scene.packages, [pkg.id]: { ...pkg, tier, phase: 'held', phaseMs: 0 } } }
  if (isPassing(tier)) {
    return { ...scene, packages: { ...scene.packages, [pkg.id]: { ...pkg, tier, phase: 'passing', phaseMs: 0 } } }
  }
  const b = burstAt(scene, pkg)
  return {
    ...scene,
    rng: b.rng,
    effects: [...scene.effects, b.effect],
    packages: { ...scene.packages, [pkg.id]: { ...pkg, tier, phase: 'bursting', phaseMs: 0 } },
  }
}

const newPackage = (scene: Scene, id: string, ref: PackageSprite['ref'], key: string, agentId: string): { pkg: PackageSprite; rng: number } => {
  const r = draw(scene.rng, 1)
  const angle = (r.values[0] ?? 0) * Math.PI * 2
  return {
    pkg: { id, ref, key, agentId, phase: 'inbound', angle, distance: ENTRY_DISTANCE, pos: polar(angle, ENTRY_DISTANCE), evidence: [], phaseMs: 0 },
    rng: r.state,
  }
}

export const reduce = (scene: Scene, event: SceneEvent): Scene => {
  const at = event.at
  switch (event.type) {
    case 'AgentLaunched': {
      if (event.agentId === MAIN_AGENT) return scene
      const r = draw(scene.rng, 4)
      const [a = 0, rad = 0, spd = 0, dir = 0] = r.values
      const angle = a * Math.PI * 2
      const agent: AgentSprite = {
        id: event.agentId,
        type: event.agentType,
        state: 'launching',
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        pos: polar(angle, LAUNCH_RADIUS),
        orbit: {
          radius: ORBIT_MIN + rad * (ORBIT_MAX - ORBIT_MIN),
          angle,
          speed: (dir < 0.5 ? -1 : 1) * (ORBIT_SPEED_MIN + spd * (ORBIT_SPEED_MAX - ORBIT_SPEED_MIN)),
        },
        trail: [],
        glint: 0,
      }
      return {
        ...scene,
        rng: r.state,
        agents: capRecord({ ...scene.agents, [agent.id]: agent }, MAX_AGENTS),
        log: addLog(scene.log, { at, glyph: '▲', tone: 'agent', text: `${event.agentType} launched` }),
      }
    }

    case 'AgentActed': {
      const agent = scene.agents[event.agentId]
      const who = agent ? agent.type : event.agentId
      const log = addLog(scene.log, { at, glyph: '·', tone: 'agent', text: `${who} · ${event.summary}` })
      if (!agent) return { ...scene, log }
      return { ...scene, log, agents: { ...scene.agents, [agent.id]: { ...agent, lastAction: event.summary, glint: GLINT_MS } } }
    }

    case 'AgentFinished': {
      const agent = scene.agents[event.agentId]
      if (!agent) return scene
      return {
        ...scene,
        agents: { ...scene.agents, [agent.id]: { ...agent, state: 'returning' } },
        log: addLog(scene.log, { at, glyph: '●', tone: 'agent', text: `${agent.type} done` }),
      }
    }

    case 'PackageIntercepted': {
      const key = refKey(event.ref)
      const id = packageId(event.requestId, key)
      const totals = { ...scene.totals, intercepts: scene.totals.intercepts + 1 }
      if (scene.packages[id]) return { ...scene, totals }
      const n = newPackage(scene, id, event.ref, key, event.agentId)
      return { ...scene, rng: n.rng, totals, packages: capRecord({ ...scene.packages, [id]: n.pkg }, MAX_PACKAGES) }
    }

    case 'PackageScored': {
      const key = refKey(event.ref)
      const id = packageId(event.requestId, key)
      const field = tierTotal[event.tier]
      let next: Scene = {
        ...scene,
        totals: { ...scene.totals, [field]: scene.totals[field] + 1 },
        log: addLog(scene.log, verdictLine(event.ref.name, event.tier, event.evidence, at, false)),
      }
      let pkg = next.packages[id]
      if (!pkg) {
        const n = newPackage(next, id, event.ref, key, MAIN_AGENT)
        next = { ...next, rng: n.rng }
        pkg = n.pkg
      }
      const scored: PackageSprite = { ...pkg, tier: event.tier, evidence: event.evidence, ...(event.pinnedTo ? { pinnedTo: event.pinnedTo } : {}) }
      // An inbound sprite keeps flying; step() resolves it when it reaches the ring.
      if (scored.phase === 'atRing') return resolveAtRing(next, scored, event.tier)
      return { ...next, packages: capRecord({ ...next.packages, [id]: scored }, MAX_PACKAGES) }
    }

    case 'VerdictIssued': {
      // Totals: a held package counted once in `held` when scored is counted again here in its
      // final tier, so held + passed + refused can exceed intercepts. The legend explains this.
      // A 'hold' verdict (still undecided) is not counted twice.
      const field = tierTotal[event.tier]
      const targets = Object.values(scene.packages).filter((p) => p.key === event.key && p.phase !== 'gone')
      const name = targets[0]?.ref.name ?? nameFromKey(event.key)
      let next: Scene = {
        ...scene,
        totals: event.tier === 'hold' ? scene.totals : { ...scene.totals, [field]: scene.totals[field] + 1 },
        log: addLog(scene.log, verdictLine(name, event.tier, event.evidence, at, true)),
      }
      for (const p of targets) {
        const updated: PackageSprite = { ...p, tier: event.tier, evidence: event.evidence }
        if (p.phase === 'held' || p.phase === 'atRing') next = resolveAtRing(next, updated, event.tier)
        else if (p.phase === 'inbound') next = { ...next, packages: { ...next.packages, [p.id]: updated } }
      }
      if (event.tier === 'hold') return next
      const sentinels = { ...next.sentinels }
      for (const s of Object.values(sentinels)) {
        if (s.targetKey === event.key && (s.phase === 'outbound' || s.phase === 'scanning')) {
          sentinels[s.id] = { ...s, phase: 'returning', phaseMs: 0 }
        }
      }
      return { ...next, sentinels }
    }

    case 'SentinelDispatched':
      return {
        ...scene,
        sentinels: capRecord(
          { ...scene.sentinels, [event.sentinelId]: { id: event.sentinelId, targetKey: event.key, phase: 'outbound', pos: SHIP, phaseMs: 0 } },
          MAX_SENTINELS,
        ),
        log: addLog(scene.log, { at, glyph: '·', tone: 'hold', text: `sentinel → ${nameFromKey(event.key)}` }),
      }

    case 'OverrideApplied':
      return {
        ...scene,
        totals: { ...scene.totals, overridden: scene.totals.overridden + 1 },
        log: addLog(scene.log, { at, glyph: '·', tone: 'neutral', text: `override ${event.action} ${nameFromKey(event.key)} (${event.scope})` }),
      }

    case 'UsageUpdated': {
      const priced = event.estCostUsd !== undefined
      let next: Scene = {
        ...scene,
        tokens: addTokens(scene.tokens, event.tokens),
        estCostUsd: scene.estCostUsd + (event.estCostUsd ?? 0),
        unpricedTokens: scene.unpricedTokens + (priced ? 0 : sumTokens(event.tokens)),
      }
      const agent = scene.agents[event.agentId]
      if (agent) {
        const updated: AgentSprite = { ...agent, tokens: addTokens(agent.tokens, event.tokens) }
        if (priced) updated.estCostUsd = (agent.estCostUsd ?? 0) + (event.estCostUsd ?? 0)
        next = { ...next, agents: { ...next.agents, [agent.id]: updated } }
      }
      return next
    }

    case 'Fault':
      return {
        ...scene,
        fault: { where: event.where, message: event.message, at },
        log: addLog(scene.log, { at, glyph: '⚠', tone: 'fault', text: `${event.where}: ${event.message}` }),
      }

    case 'FaultCleared': {
      if (!scene.fault) return scene
      const { fault: _cleared, ...rest } = scene
      return { ...rest, log: addLog(scene.log, { at, glyph: '·', tone: 'neutral', text: 'fault cleared' }) }
    }
  }
}
