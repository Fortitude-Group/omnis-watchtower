// $.state contract for Omnis Watchtower, and the canonical home of every type persisted in it.
// The engine requires this file to be self-contained and to export types only, so core/model.ts
// and core/scene/events.ts re-export these rather than defining their own copies.

export type Ecosystem = 'npm' | 'pypi'

export type PackageRef = {
  ecosystem: Ecosystem
  name: string
  version?: string
  extras?: string[]
}

export type Tier = 'pass' | 'refuse' | 'hold' | 'unverified' | 'unchecked'

export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type SentinelVerdict = {
  verdict: 'allow' | 'block'
  confidence: number
  evidence: string[]
}

export type Investigation = {
  key: string
  ref: PackageRef
  agentId?: string
  status: 'queued' | 'running' | 'concluded' | 'failed' | 'timedOut'
  attempts: number
  startedAt: number
  deadline: number
  /** Evidence lines of the signals that caused the hold, handed to the Sentinel. */
  reasons: string[]
  /** True when a hard signal is present, so an "allow" verdict can never pass it (FR-015). */
  hasHardSignal: boolean
  verdict?: SentinelVerdict
  failure?: string
}

export type Override = {
  key: string
  action: 'allow' | 'block'
  scope: 'session' | 'permanent'
  at: number
  via: 'composer' | 'pane'
}

export type WatchtowerFault = { where: 'gate' | 'render' | 'sentinel'; message: string; at: number }

export type Stamp = { at: number; seq: number }

export type SceneEvent = Stamp &
  (
    | { type: 'AgentLaunched'; agentId: string; agentType: string }
    | { type: 'AgentActed'; agentId: string; summary: string }
    | { type: 'AgentFinished'; agentId: string }
    | { type: 'PackageIntercepted'; requestId: string; agentId: string; ref: PackageRef }
    | { type: 'PackageScored'; requestId: string; ref: PackageRef; tier: Tier; evidence: string[] }
    | { type: 'SentinelDispatched'; key: string; sentinelId: string }
    | { type: 'VerdictIssued'; key: string; tier: Tier; evidence: string[] }
    | { type: 'OverrideApplied'; key: string; action: 'allow' | 'block'; scope: 'session' | 'permanent' }
    | { type: 'UsageUpdated'; agentId: string; model: string; tokens: TokenUsage; estCostUsd?: number }
    | { type: 'Fault'; where: 'gate' | 'render' | 'sentinel'; message: string }
    | { type: 'FaultCleared' }
  )

export type WatchtowerTheme = 'radar' | 'cracktro'

declare module 'claude-code' {
  interface PluginState {
    'omnis-watchtower': {
      /** Ring buffer of the last 500 scene events, oldest first; `seq` increases by one per event. */
      events: SceneEvent[]
      investigations: Record<string, Investigation>
      sessionOverrides: Record<string, Override>
      theme: WatchtowerTheme
      fault: WatchtowerFault | null
      /** Lines added to the next turn's context (verdicts), drained by status.ts via prompt.context. */
      contextQueue: string[]
      /** True while the demo replay owns the pane. */
      demo: boolean
    }
  }
}
