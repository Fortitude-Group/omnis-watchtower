// The tier function (data-model.md "PackageCheck (the decision)", rules 1-9 in order).

import type { Override, PackageCheck, PackageFacts, PackageRef, Signal, Tier } from '../model'
import { cooldownPin, versionRequested } from './cooldown'
import { alternativeFor, evidence } from './evidence'
import { buildSignals, WEIGHTS } from './signals'
import { isPopular, type TyposquatIndex } from './typosquat'

export const VERDICT_TTL_MS = 24 * 3_600_000

export type Mode = 'enforce' | 'warn-only'

/** Inputs to rule 6a (FR-035). `pin` comes from `cooldownPin(facts, now)`. */
export type Cooldown = { popular: boolean; requested: boolean; latest: string; pin?: string }

export type DecideInput = {
  ref: PackageRef
  signals: Signal[]
  now: number
  override?: Pick<Override, 'action'>
  /** True when the name matches the developer's private allowlist (FR-012). */
  allowlisted?: boolean
  cooldown?: Cooldown
  mode?: Mode
  ttlMs?: number
}

const present = (signals: Signal[], kind: Signal['kind']): boolean => signals.some(s => s.kind === kind && s.state === 'present')
const stateOf = (signals: Signal[], kind: Signal['kind']): Signal['state'] | undefined => signals.find(s => s.kind === kind)?.state
const weakCount = (signals: Signal[]): number =>
  signals.filter(s => s.weight === 'weak' && s.state === 'present' && s.kind !== 'privateRegistry').length

/** Rule 6a: a popular package held only because its unrequested latest release is fresh. */
const pinFor = (signals: Signal[], c: Cooldown | undefined): string | undefined => {
  if (!c || !c.popular || c.requested || !c.pin) return undefined
  if (stateOf(signals, 'malware') !== 'absent') return undefined
  const strong = signals.filter(s => s.weight === 'strong' && s.state === 'present').map(s => s.kind)
  if (strong.length !== 1 || strong[0] !== 'versionAge' || weakCount(signals) > 0) return undefined
  return c.pin
}

/** Rules 1-8: the raw tier, before warn-only mapping, plus the cooldown pin when rule 6a fires. */
export const evaluate = (
  signals: Signal[],
  override?: Pick<Override, 'action'>,
  allowlisted = false,
  cooldown?: Cooldown,
): { tier: Tier; pinnedTo?: string } => {
  if (override) return { tier: override.action === 'allow' ? 'pass' : 'refuse' }
  if (allowlisted || present(signals, 'privateRegistry')) {
    // A private name the public registry also serves is dependency confusion (US1-6), and an
    // unanswered check cannot clear it (FR-009).
    const shadow = stateOf(signals, 'dependencyConfusion')
    return { tier: shadow === 'present' ? 'refuse' : shadow === 'unknown' ? 'hold' : 'pass' }
  }
  if (stateOf(signals, 'exists') === 'unknown') return { tier: 'unverified' }
  const hard = signals.some(
    s => s.weight === 'hard' && (s.kind === 'exists' ? s.state === 'absent' : s.state === 'present'),
  )
  if (hard) return { tier: 'refuse' }
  const low = stateOf(signals, 'lowAdoption')
  if (present(signals, 'typosquat') && (low === 'present' || low === 'unknown')) return { tier: 'refuse' }
  if (stateOf(signals, 'malware') === 'unknown' || stateOf(signals, 'dependencyConfusion') === 'unknown') return { tier: 'hold' }
  const pin = pinFor(signals, cooldown)
  if (pin) return { tier: 'pass', pinnedTo: pin }
  const strong = signals.some(s => s.weight === 'strong' && s.state === 'present')
  if (strong || weakCount(signals) >= 2) return { tier: 'hold' }
  return { tier: 'pass' }
}

export const tierFor = (signals: Signal[], override?: Pick<Override, 'action'>, allowlisted = false, cooldown?: Cooldown): Tier =>
  evaluate(signals, override, allowlisted, cooldown).tier

export const decide = (input: DecideInput): PackageCheck => {
  const { ref, now, override, allowlisted = false, cooldown, mode = 'enforce', ttlMs = VERDICT_TTL_MS } = input
  let signals =
    allowlisted && !present(input.signals, 'privateRegistry')
      ? [...input.signals, { kind: 'privateRegistry' as const, state: 'present' as const, weight: WEIGHTS.privateRegistry, evidence: evidence.allowlisted(ref.name) }]
      : input.signals
  const { tier, pinnedTo } = evaluate(signals, override, allowlisted, cooldown)
  if (pinnedTo && cooldown) {
    signals = signals.map(s => (s.kind === 'versionAge' ? { ...s, evidence: evidence.cooldownPin(cooldown.latest, pinnedTo) } : s))
  }
  const blocking = tier === 'refuse' || tier === 'hold'
  const decidedBy: PackageCheck['decidedBy'] = override
    ? 'override'
    : pinnedTo
      ? 'cooldown'
      : blocking && mode === 'warn-only'
        ? 'warn-only'
        : 'fast-score'
  const alternative = alternativeFor(signals)
  return {
    ref,
    tier,
    signals,
    ...(alternative && tier !== 'pass' ? { alternative } : {}),
    ...(pinnedTo ? { pinnedTo } : {}),
    decidedBy,
    decidedAt: now,
    expiresAt: now + ttlMs,
  }
}

export type ScoreOptions = Pick<DecideInput, 'override' | 'allowlisted' | 'mode' | 'ttlMs'>

/** Facts → PackageCheck: signals, the cooldown inputs and the tier, in one pure call. */
export const scorePackage = (facts: PackageFacts, now: number, popular: TyposquatIndex, options: ScoreOptions = {}): PackageCheck => {
  const pin = cooldownPin(facts, now)
  const cooldown: Cooldown = {
    popular: isPopular(popular, facts.ref.name),
    requested: versionRequested(facts.ref),
    latest: facts.resolvedVersion === 'unknown' ? '?' : facts.resolvedVersion,
    ...(pin ? { pin } : {}),
  }
  return decide({ ref: facts.ref, signals: buildSignals(facts, now, popular), now, cooldown, ...options })
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
