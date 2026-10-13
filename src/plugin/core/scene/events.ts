// SceneEvents are domain facts; Scene is what every renderer draws. Both are plain data so they
// can sit in $.state, be recorded, and be replayed deterministically (data-model.md, Scene).

import type { PackageRef, SceneEvent, Tier, TokenUsage } from '../../types'

export type { SceneEvent } from '../../types'

export type SceneEventType = SceneEvent['type']

/** Distributive Omit, so callers can build an event without `at`/`seq` and keep the union narrowing. */
export type SceneEventInput = SceneEvent extends infer E ? (E extends SceneEvent ? Omit<E, 'at' | 'seq'> : never) : never

/** World coordinates are normalised: (0,0) top-left, (1,1) bottom-right, ship at the centre. */
export type Vec = { x: number; y: number }

export type AgentSprite = {
  id: string
  type: string
  state: 'launching' | 'working' | 'returning' | 'gone'
  lastAction?: string
  tokens: TokenUsage
  estCostUsd?: number
  pos: Vec
  /** Orbit around the ship: radius (world units), angle (radians), angular speed (rad/s). */
  orbit: { radius: number; angle: number; speed: number }
  trail: Vec[]
  /** ms left on the "acted" glint. */
  glint: number
}

export type PackagePhase = 'inbound' | 'atRing' | 'passing' | 'bursting' | 'held' | 'gone'

export type PackageSprite = {
  id: string
  ref: PackageRef
  key: string
  agentId: string
  tier?: Tier
  phase: PackagePhase
  /** Entry angle around the ring (radians) and current distance from the ship (world units). */
  angle: number
  distance: number
  pos: Vec
  evidence: string[]
  /** ms spent in the current phase. */
  phaseMs: number
}

export type SentinelSprite = {
  id: string
  targetKey: string
  phase: 'outbound' | 'scanning' | 'returning' | 'gone'
  pos: Vec
  phaseMs: number
}

export type Effect = {
  kind: 'burst' | 'pass-flash' | 'glint'
  pos: Vec
  /** 'pass' | 'hold' | 'refuse' | 'neutral' — renderers map this to theme colours. */
  tone: 'pass' | 'hold' | 'refuse' | 'neutral'
  lifeMs: number
  totalMs: number
  /** Seeded per-effect so bursts replay identically. */
  seed: number
}

export type LogLine = {
  at: number
  text: string
  tone: 'pass' | 'hold' | 'refuse' | 'neutral' | 'agent' | 'fault'
  glyph: '✔' | '◆' | '✖' | '▲' | '●' | '⚠' | '·'
}

export type Totals = {
  intercepts: number
  passed: number
  held: number
  refused: number
  unverified: number
  unchecked: number
  overridden: number
}

export type Scene = {
  seed: number
  /** PRNG state (prng.ts); advanced only by reduce/step. */
  rng: number
  /** Scene clock in ms, advanced by step. */
  t: number
  agents: Record<string, AgentSprite>
  packages: Record<string, PackageSprite>
  sentinels: Record<string, SentinelSprite>
  effects: Effect[]
  log: LogLine[]
  totals: Totals
  tokens: TokenUsage
  estCostUsd: number
  /** Tokens from models with no list price, so the estimate can say what it excludes (R14). */
  unpricedTokens: number
  fault?: { where: string; message: string; at: number }
  demo?: boolean
}

export const LOG_LIMIT = 50

export const emptyTotals = (): Totals => ({
  intercepts: 0,
  passed: 0,
  held: 0,
  refused: 0,
  unverified: 0,
  unchecked: 0,
  overridden: 0,
})

export const emptyScene = (seed: number): Scene => ({
  seed,
  rng: seed >>> 0,
  t: 0,
  agents: {},
  packages: {},
  sentinels: {},
  effects: [],
  log: [],
  totals: emptyTotals(),
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  estCostUsd: 0,
  unpricedTokens: 0,
})
