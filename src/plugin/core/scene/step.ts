// step(scene, dtMs): advances motion, phase timers and effect decay. Pure: returns a new Scene.
// Agents ease out to their orbit and back; packages fly in and resolve at the ring; the Sentinel
// eases out to its held package, scans, and comes home. Gone things are removed here.

import {
  ARRIVE,
  BURST_MS,
  INBOUND_SPEED,
  MAX_AGENTS,
  MAX_EFFECTS,
  MAX_PACKAGES,
  MAX_SENTINELS,
  ORBIT_EASE,
  PASS_FLASH_MS,
  PASS_SPEED,
  RING_STOP,
  SENTINEL_EASE,
  SHIP,
  SHIP_RADIUS,
  TRAIL_LENGTH,
  WORKING_AT,
  distance,
  polar,
} from './layout'
import { capRecord, resolveAtRing } from './reduce'
import type { AgentSprite, Effect, PackageSprite, Scene, SentinelSprite, Vec } from './events'

const toward = (from: Vec, to: Vec, k: number): Vec => ({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k })

const stepAgent = (a: AgentSprite, dtMs: number): AgentSprite | undefined => {
  const dt = dtMs / 1000
  const r0 = distance(a.pos, SHIP)
  const target = a.state === 'returning' ? 0 : a.orbit.radius
  const r = r0 + (target - r0) * Math.min(1, dt * ORBIT_EASE)
  // Inner orbits turn a little faster, as in the approved mockup.
  const angle = a.orbit.angle + a.orbit.speed * dt * (1.3 - r / 0.49)
  if (a.state === 'returning' && r < SHIP_RADIUS) return undefined
  const trail = [...a.trail, a.pos]
  const state = a.state === 'launching' && r >= a.orbit.radius * WORKING_AT ? 'working' : a.state
  return {
    ...a,
    state,
    pos: polar(angle, r),
    orbit: { ...a.orbit, angle },
    trail: trail.length > TRAIL_LENGTH ? trail.slice(trail.length - TRAIL_LENGTH) : trail,
    glint: Math.max(0, a.glint - dtMs),
  }
}

const targetOf = (scene: Scene, key: string): PackageSprite | undefined => {
  const all = Object.values(scene.packages).filter((p) => p.key === key && p.phase !== 'gone')
  return all.find((p) => p.phase === 'held') ?? all[0]
}

const stepSentinel = (s: SentinelSprite, scene: Scene, dtMs: number): SentinelSprite | undefined => {
  const k = Math.min(1, (dtMs / 1000) * SENTINEL_EASE)
  const phaseMs = s.phaseMs + dtMs
  const target = targetOf(scene, s.targetKey)
  if (s.phase === 'returning') {
    const pos = toward(s.pos, SHIP, k)
    return distance(pos, SHIP) < ARRIVE ? undefined : { ...s, pos, phaseMs }
  }
  if (!target) return { ...s, phase: 'returning', phaseMs: 0 }
  if (s.phase === 'scanning') return { ...s, pos: target.pos, phaseMs }
  const pos = toward(s.pos, target.pos, k)
  if (distance(pos, target.pos) < ARRIVE) return { ...s, phase: 'scanning', pos: target.pos, phaseMs: 0 }
  return { ...s, pos, phaseMs }
}

export const step = (scene: Scene, dtMs: number): Scene => {
  if (!(dtMs > 0)) return scene
  const dt = dtMs / 1000

  const agents: Record<string, AgentSprite> = {}
  for (const a of Object.values(scene.agents)) {
    const next = stepAgent(a, dtMs)
    if (next) agents[a.id] = next
  }

  const effects: Effect[] = []
  for (const e of scene.effects) {
    const lifeMs = e.lifeMs - dtMs
    if (lifeMs > 0) effects.push({ ...e, lifeMs })
  }

  let next: Scene = { ...scene, t: scene.t + dtMs, agents, effects, packages: {} }
  for (const p of Object.values(scene.packages)) {
    let pkg: PackageSprite = { ...p, phaseMs: p.phaseMs + dtMs }
    if (pkg.phase === 'inbound') {
      const d = pkg.distance - INBOUND_SPEED * dt
      if (d > RING_STOP) {
        pkg = { ...pkg, distance: d, pos: polar(pkg.angle, d) }
      } else {
        pkg = { ...pkg, distance: RING_STOP, pos: polar(pkg.angle, RING_STOP), phase: 'atRing', phaseMs: 0 }
        if (pkg.tier) {
          next = resolveAtRing(next, pkg, pkg.tier)
          continue
        }
      }
    } else if (pkg.phase === 'passing') {
      const d = pkg.distance - PASS_SPEED * dt
      if (d <= SHIP_RADIUS) {
        next = {
          ...next,
          effects: [...next.effects, { kind: 'pass-flash', pos: SHIP, tone: 'pass', lifeMs: PASS_FLASH_MS, totalMs: PASS_FLASH_MS, seed: 0 }],
        }
        continue
      }
      pkg = { ...pkg, distance: d, pos: polar(pkg.angle, d) }
    } else if (pkg.phase === 'bursting') {
      if (pkg.phaseMs >= BURST_MS) continue
    } else if (pkg.phase === 'gone') {
      continue
    }
    next = { ...next, packages: { ...next.packages, [pkg.id]: pkg } }
  }

  const sentinels: Record<string, SentinelSprite> = {}
  for (const s of Object.values(scene.sentinels)) {
    const moved = stepSentinel(s, next, dtMs)
    if (moved) sentinels[s.id] = moved
  }

  return {
    ...next,
    agents: capRecord(next.agents, MAX_AGENTS),
    packages: capRecord(next.packages, MAX_PACKAGES),
    sentinels: capRecord(sentinels, MAX_SENTINELS),
    effects: next.effects.length > MAX_EFFECTS ? next.effects.slice(next.effects.length - MAX_EFFECTS) : next.effects,
  }
}
