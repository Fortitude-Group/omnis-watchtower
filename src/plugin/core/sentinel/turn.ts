// What a finished Sentinel turn does to its investigation (FR-015..FR-018). Pure, so every path is
// unit-tested; hooks/sentinel.ts applies the result to state.

import type { Investigation, Tier } from '../model'
import { parseVerdict } from './verdict'

export const MAX_ATTEMPTS = 2

export type SentinelTurn = {
  agentId?: string
  reason: 'answer' | 'aborted' | 'refusal' | 'error'
  answer: string
}

export type TurnOutcome =
  | { kind: 'retry'; next: Investigation }
  | { kind: 'failed'; next: Investigation; tier: Tier; evidence: string[] }
  | { kind: 'concluded'; next: Investigation; allowed: boolean; tier: Tier; evidence: string[] }

const isActive = (i: Investigation) => i.status === 'running' || i.status === 'queued'

/**
 * The investigation a turn belongs to: by agent id when the host reports one, otherwise by the
 * investigation id the Sentinel echoed in its verdict. A turn matching neither is not ours.
 */
export const matchTurn = (all: Record<string, Investigation>, turn: SentinelTurn): Investigation | undefined => {
  const active = Object.values(all).filter(isActive)
  if (turn.agentId) {
    const byAgent = active.find(i => i.agentId === turn.agentId)
    if (byAgent) return byAgent
  }
  const parsed = turn.reason === 'answer' ? parseVerdict(turn.answer) : undefined
  const token = parsed?.ok ? parsed.investigation : undefined
  // Only an investigation with no agent id of its own can be claimed by token: otherwise any
  // subagent could conclude it by quoting the id (code review, 2026-10-13)
  return token ? active.find(i => i.token === token && !i.agentId) : undefined
}

/** The investigation after this turn, and what to show. An "allow" never clears a hard signal. */
export const resolveTurn = (inv: Investigation, turn: SentinelTurn): TurnOutcome => {
  const parsed = turn.reason === 'answer' ? parseVerdict(turn.answer) : { ok: false as const, reason: `the Sentinel's turn ended (${turn.reason})` }
  if (!parsed.ok) {
    if (turn.reason === 'answer' && inv.attempts < MAX_ATTEMPTS) {
      const { agentId: _a, ...rest } = inv
      return { kind: 'retry', next: { ...rest, status: 'queued' } }
    }
    return {
      kind: 'failed',
      next: { ...inv, status: 'failed', failure: parsed.reason },
      tier: 'refuse',
      evidence: [`Investigation failed: ${parsed.reason}`],
    }
  }
  const allowed = parsed.verdict.verdict === 'allow' && !inv.hasHardSignal
  return {
    kind: 'concluded',
    next: { ...inv, status: 'concluded', verdict: parsed.verdict },
    allowed,
    tier: allowed ? 'pass' : 'refuse',
    evidence: parsed.verdict.evidence,
  }
}
