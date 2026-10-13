// The tier function (data-model.md "PackageCheck (the decision)", rules 1-9 in order).

import type { Override, PackageCheck, PackageRef, Signal, Tier } from '../model'
import { alternativeFor, evidence } from './evidence'
import { WEIGHTS } from './signals'

export const VERDICT_TTL_MS = 24 * 3_600_000

export type Mode = 'enforce' | 'warn-only'

export type DecideInput = {
  ref: PackageRef
  signals: Signal[]
  now: number
  override?: Pick<Override, 'action'>
  /** True when the name matches the developer's private allowlist (FR-012). */
  allowlisted?: boolean
  mode?: Mode
  ttlMs?: number
}

const present = (signals: Signal[], kind: Signal['kind']): boolean => signals.some(s => s.kind === kind && s.state === 'present')
const stateOf = (signals: Signal[], kind: Signal['kind']): Signal['state'] | undefined => signals.find(s => s.kind === kind)?.state

/** Rules 1-8: the raw tier, before warn-only mapping. */
export const tierFor = (signals: Signal[], override?: Pick<Override, 'action'>, allowlisted = false): Tier => {
  if (override) return override.action === 'allow' ? 'pass' : 'refuse'
  if (allowlisted || present(signals, 'privateRegistry')) return 'pass'
  if (stateOf(signals, 'exists') === 'unknown') return 'unverified'
  const hard = signals.some(
    s => s.weight === 'hard' && (s.kind === 'exists' ? s.state === 'absent' : s.state === 'present'),
  )
  if (hard) return 'refuse'
  const low = stateOf(signals, 'lowAdoption')
  if (present(signals, 'typosquat') && (low === 'present' || low === 'unknown')) return 'refuse'
  if (stateOf(signals, 'malware') === 'unknown') return 'hold'
  const strong = signals.some(s => s.weight === 'strong' && s.state === 'present')
  const weak = signals.filter(s => s.weight === 'weak' && s.state === 'present' && s.kind !== 'privateRegistry').length
  if (strong || weak >= 2) return 'hold'
  return 'pass'
}

export const decide = (input: DecideInput): PackageCheck => {
  const { ref, now, override, allowlisted = false, mode = 'enforce', ttlMs = VERDICT_TTL_MS } = input
  const signals =
    allowlisted && !present(input.signals, 'privateRegistry')
      ? [...input.signals, { kind: 'privateRegistry' as const, state: 'present' as const, weight: WEIGHTS.privateRegistry, evidence: evidence.allowlisted(ref.name) }]
      : input.signals
  const tier = tierFor(signals, override, allowlisted)
  const blocking = tier === 'refuse' || tier === 'hold'
  const decidedBy: PackageCheck['decidedBy'] = override ? 'override' : blocking && mode === 'warn-only' ? 'warn-only' : 'fast-score'
  const alternative = alternativeFor(signals)
  return {
    ref,
    tier,
    signals,
    ...(alternative && tier !== 'pass' ? { alternative } : {}),
    decidedBy,
    decidedAt: now,
    expiresAt: now + ttlMs,
  }
}

/** Rule 9: warn-only keeps the tier for display but lets the call through. */
export const isAllowed = (c: PackageCheck): boolean =>
  !(c.tier === 'refuse' || c.tier === 'hold') || c.decidedBy === 'warn-only'

export type CommandDecision = { allow: boolean; blocking: PackageCheck[] }

/** A command is refused when any package is refused or held (and not mapped by warn-only). */
export const decideCommand = (checks: PackageCheck[]): CommandDecision => {
  const blocking = checks.filter(c => !isAllowed(c))
  return { allow: blocking.length === 0, blocking }
}

const globToRegExp = (glob: string): RegExp =>
  new RegExp(`^${glob.trim().toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)

/** `privateAllowlist` is comma-separated globs, e.g. `@acme/*, acme-*`. */
export const matchesAllowlist = (name: string, allowlist: string | readonly string[]): boolean => {
  const globs = (typeof allowlist === 'string' ? allowlist.split(',') : allowlist).map(g => g.trim()).filter(Boolean)
  const n = name.trim().toLowerCase()
  return globs.some(g => globToRegExp(g).test(n))
}
