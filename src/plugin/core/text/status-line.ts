// Session totals, the status line and the toasts, all derived from the scene-event ring buffer.
// Counting follows core/scene/reduce.ts, so the status line and the pane never disagree.

import { totalTokens } from '../data/prices'
import { key as refKey } from '../model'
import { formatTokens } from '../render/overlay'
import type { SceneEvent, TokenUsage } from '../../types'
import { label } from './deny-text'

export type SessionTotals = {
  intercepts: number
  passed: number
  held: number
  refused: number
  unverified: number
  unchecked: number
  overridden: number
  tokens: TokenUsage
  estCostUsd: number
  unpricedTokens: number
}

export const sessionTotals = (events: readonly SceneEvent[]): SessionTotals => {
  const t: SessionTotals = {
    intercepts: 0, passed: 0, held: 0, refused: 0, unverified: 0, unchecked: 0, overridden: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    estCostUsd: 0,
    unpricedTokens: 0,
  }
  const bump = (tier: string) => {
    if (tier === 'pass') t.passed++
    else if (tier === 'hold') t.held++
    else if (tier === 'refuse') t.refused++
    else if (tier === 'unverified') t.unverified++
    else if (tier === 'unchecked') t.unchecked++
  }
  for (const e of events) {
    switch (e.type) {
      case 'PackageIntercepted': t.intercepts++; break
      case 'PackageScored': bump(e.tier); break
      // A hold verdict is still undecided, so it is not counted twice (as in reduce.ts)
      case 'VerdictIssued': if (e.tier !== 'hold') bump(e.tier); break
      case 'OverrideApplied': t.overridden++; break
      case 'UsageUpdated':
        t.tokens = {
          input: t.tokens.input + e.tokens.input,
          output: t.tokens.output + e.tokens.output,
          cacheRead: t.tokens.cacheRead + e.tokens.cacheRead,
          cacheWrite: t.tokens.cacheWrite + e.tokens.cacheWrite,
        }
        if (e.estCostUsd === undefined) t.unpricedTokens += totalTokens(e.tokens)
        else t.estCostUsd += e.estCostUsd
        break
    }
  }
  return t
}

/** The contract's status line: `🛡 <passed> ✔ · <held> ◆ · <refused> ✖ · <tokens>` (+ ` · ⚠ FAULT`). */
export const statusLine = (t: SessionTotals, faulted: boolean): string =>
  `🛡 ${t.passed} ✔ · ${t.held} ◆ · ${t.refused} ✖ · ${formatTokens(totalTokens(t.tokens))} tokens${faulted ? ' · ⚠ FAULT' : ''}`

/** The fault the events still report: the last Fault with no FaultCleared after it. */
export const currentFault = (events: readonly SceneEvent[]): Extract<SceneEvent, { type: 'Fault' }> | undefined => {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.type === 'FaultCleared') return undefined
    if (e.type === 'Fault') return e
  }
  return undefined
}

/** Keys held and still waiting for a verdict, as of the end of `events`. */
const pendingHolds = (events: readonly SceneEvent[]): Set<string> => {
  const pending = new Set<string>()
  for (const e of events) {
    if (e.type === 'PackageScored' && e.tier === 'hold') pending.add(refKey(e.ref))
    else if (e.type === 'VerdictIssued' && e.tier !== 'hold') pending.delete(e.key)
  }
  return pending
}

const because = (evidence: readonly string[]): string => (evidence[0] ? ` — ${evidence[0]}` : '')

/**
 * Toasts for the events one write added (FR-022): every refusal, each hold once (a retry of a
 * package still under investigation is not a new hold) and render or Sentinel faults. Verdicts
 * (hooks/sentinel.ts) and gate faults (hooks/gate.ts) are toasted where they happen, so they are
 * left out here. In warn-only mode nothing is refused, so the toast says what would have been.
 */
export const toastsFor = (before: readonly SceneEvent[], added: readonly SceneEvent[], mode: 'enforce' | 'warn-only' = 'enforce'): string[] => {
  const out: string[] = []
  const refused = added.filter((e): e is Extract<SceneEvent, { type: 'PackageScored' }> => e.type === 'PackageScored' && e.tier === 'refuse')
  const verb = mode === 'warn-only' ? 'would refuse (warn-only, it ran)' : 'refused'
  if (refused.length === 1) out.push(`✖ Watchtower ${verb} ${label(refused[0]!.ref)}${because(refused[0]!.evidence)}`)
  else if (refused.length > 1) out.push(`✖ Watchtower ${verb} ${refused.length} packages: ${refused.map(e => label(e.ref)).join(', ')}`)

  const pending = pendingHolds(before)
  for (const e of added) {
    if (e.type !== 'PackageScored' || e.tier !== 'hold') continue
    const k = refKey(e.ref)
    if (pending.has(k)) continue
    pending.add(k)
    out.push(`◆ Watchtower held ${label(e.ref)}${because(e.evidence)}; a Sentinel is investigating`)
  }

  for (const e of added) {
    if (e.type === 'Fault' && e.where !== 'gate') out.push(`⚠ Watchtower fault in the ${e.where}: ${e.message}`)
  }
  return out
}

/** 65_000 → "1m 05s", 3_700_000 → "1h 01m". */
export const formatAge = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
