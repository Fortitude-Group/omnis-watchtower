// The exact text Claude receives (contracts/user-surface.md). Agents and tests rely on these prefixes.

import type { PackageCheck, PackageRef } from '../model'
import { contributing } from '../score/evidence'

export const label = (ref: PackageRef): string =>
  `${ref.ecosystem}:${ref.name}${ref.version ? `@${ref.version}` : ''}`

const evidenceLines = (c: PackageCheck): string[] => contributing(c.signals).map(s => `- ${s.evidence}`)

export const refusedText = (c: PackageCheck): string =>
  [
    `WATCHTOWER REFUSED ${label(c.ref)}`,
    ...evidenceLines(c),
    ...(c.alternative ? [`Suggested alternative: ${c.alternative}`] : []),
    `Override (human only): /watchtower allow ${c.ref.ecosystem}:${c.ref.name}`,
  ].join('\n')

/** US5-2: a package the developer blocked. */
export const blockedText = (ref: PackageRef): string =>
  [
    `WATCHTOWER REFUSED ${label(ref)} — blocked by you.`,
    `Remove the block (human only): /watchtower overrides clear ${ref.ecosystem}:${ref.name}`,
  ].join('\n')

export const heldText = (c: PackageCheck): string =>
  [
    `WATCHTOWER HELD ${label(c.ref)} — the Sentinel is investigating.`,
    'Carry on with other work and retry this exact command later; the verdict will be applied.',
    ...evidenceLines(c),
  ].join('\n')

export const investigationFailedText = (ref: PackageRef, outcome: 'failed' | 'timed out', reason: string): string =>
  [
    `WATCHTOWER REFUSED ${label(ref)} — investigation ${outcome} (${reason}).`,
    `Re-investigate: /watchtower recheck ${ref.ecosystem}:${ref.name}   Override (human only): /watchtower allow ${ref.ecosystem}:${ref.name}`,
  ].join('\n')

export const sentinelRefusedText = (ref: PackageRef, evidence: string[]): string =>
  [
    `WATCHTOWER REFUSED ${label(ref)} — the Sentinel found it unsafe.`,
    ...evidence.map(e => `- ${e}`),
    `Override (human only): /watchtower allow ${ref.ecosystem}:${ref.name}`,
  ].join('\n')

/** FR-035: context for a command that ran rewritten to a cooldown pin. */
export const pinnedText = (ref: PackageRef, pinned: string, fresh: string | undefined): string =>
  `WATCHTOWER PINNED ${ref.ecosystem}:${ref.name} → ${pinned} (latest${fresh && fresh !== '?' ? ` ${fresh}` : ''} is under 72 hours old; cooldown against hijacked releases)`

export const verdictContext = (ref: PackageRef, allowed: boolean, topEvidence: string): string =>
  `WATCHTOWER VERDICT ${label(ref)} → ${allowed ? 'allowed' : 'refused'}: ${topEvidence}`

const ORDER: Record<string, number> = { refuse: 0, hold: 1 }

/**
 * One block per package that stops the command, refused first, then held. Packages that pass are
 * not listed: the agent only needs to act on what blocked it.
 */
export const commandText = (checks: PackageCheck[], textFor: (c: PackageCheck) => string): string =>
  checks
    .filter(c => c.tier === 'refuse' || c.tier === 'hold')
    .sort((a, b) => (ORDER[a.tier] ?? 9) - (ORDER[b.tier] ?? 9))
    .map(textFor)
    .join('\n\n')
