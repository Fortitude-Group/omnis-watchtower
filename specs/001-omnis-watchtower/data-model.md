# Data Model: Omnis Watchtower

All entities are plain, serialisable data (JSON-safe). None hold functions, so they can live in
`$.state` and `$.store`, be recorded in the event log, and be snapshot-tested. Times are epoch
milliseconds supplied by the caller (never read from a clock inside `core/`; Principle IV).

## Package identity

```
PackageRef {
  ecosystem: 'npm' | 'pypi'
  name: string            // normalised: npm lower-case as published; PyPI PEP 503 (lower, runs of -_. → -)
  version?: string        // exact version or specifier as requested; absent = latest
  extras?: string[]       // PyPI extras, e.g. ['cli']
}
key(PackageRef) = `${ecosystem}:${name}@${version ?? 'latest'}`
```

Validation: `name` must match the ecosystem's name grammar (npm: optional `@scope/`, url-safe,
≤ 214 chars; PyPI: `^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$`). A name failing the grammar is
an `unchecked` parse result, never a fetch.

## InstallRequest

```
InstallRequest {
  id: string              // tool_use_id when present, else a deterministic hash of command + agent
  agentId: string | 'main'
  command: string         // raw Bash command
  tool: 'npm'|'pnpm'|'yarn'|'bun'|'npx'|'pip'|'uv'|'poetry'|'pipx'
  packages: PackageRef[]  // explicit names, requirements-file entries, or lockfile-diff additions
  source: 'explicit' | 'requirements-file' | 'lockfile-diff'
  unchecked: string[]     // fragments the parser could not read (FR-003)
  at: number
}
```

## Signal

```
SignalKind =
  'exists' | 'malware' | 'dependencyConfusion' | 'packageAge' | 'versionAge'
  | 'typosquat' | 'installScripts' | 'sdistOnly' | 'lowAdoption' | 'singleMaintainerLowAdoption'
  | 'noRepository' | 'privateRegistry'

Signal {
  kind: SignalKind
  state: 'present' | 'absent' | 'unknown'   // unknown = could not be fetched (FR-009)
  weight: 'hard' | 'strong' | 'weak'
  evidence: string        // one human-readable line (FR-008)
  imitates?: string       // typosquat: the popular name it resembles
}
```

Rules (from research R7, R8):
- `malware` present ⇒ id `MAL-*` OR `cwe_ids ∋ CWE-506` OR summary `/\b(malware|malicious)\b/i`.
- `singleMaintainerLowAdoption` present ⇒ exactly 1 maintainer AND < 1,000 downloads/week.
- `packageAge` strong ⇒ first publish < 7 days ago. `versionAge` strong ⇒ requested version
  published < 72 h ago.
- `typosquat` ⇒ within edit distance ≤ 2 (or a homoglyph or `-`/`_`/`.` variant) of a name in the
  popular list, and not itself in the list.

## PackageCheck (the decision)

```
Tier = 'pass' | 'refuse' | 'hold' | 'unverified' | 'unchecked'

PackageCheck {
  ref: PackageRef
  tier: Tier
  signals: Signal[]
  alternative?: string    // FR-010, e.g. the imitated popular name
  pinnedTo?: string       // FR-035 cooldown pin: the version the install was rewritten to
  decidedBy: 'fast-score' | 'sentinel' | 'override' | 'cache' | 'warn-only' | 'cooldown'
  decidedAt: number
  expiresAt: number       // cache horizon (FR-011): verdicts 24 h
}
```

Tier function (pure, in `core/`), applied in order:
1. Developer override exists → its tier (`pass` for allow, `refuse` for block).
2. Resolves to a private registry or matches the allowlist → `pass` (signal `privateRegistry`).
3. Registry unreachable for `exists` → `unverified` (allowed, flagged).
4. Any **hard** signal present (`exists` absent, `malware`, `dependencyConfusion`) → `refuse`.
5. `typosquat` present AND (`lowAdoption` present or unknown) → `refuse`.
6. `malware` unknown → `hold` (FR-009: cannot pass).
6a. Cooldown pin (FR-035): the package is on the popular list, no version was requested, the
    only present strong signal is `versionAge`, no weak signals are present, and a release at
    least 72 h old exists → `pass` with `pinnedTo` that release (`decidedBy: 'cooldown'`).
7. Any **strong** signal present, or two or more **weak** signals present → `hold`.
8. Otherwise → `pass`.
9. Warn-only mode maps `refuse`/`hold` to an allowed call but keeps the tier for display and
   notification.

A command's overall decision: refuse if any package is `refuse` or `hold` (the reason lists each
package); otherwise allow.

## Investigation

```
Investigation {
  key: string             // PackageRef key
  agentId?: string        // the Sentinel's agentId once spawned
  status: 'queued' | 'running' | 'concluded' | 'failed' | 'timedOut'
  attempts: number        // malformed-output retry: max 2
  startedAt: number
  deadline: number        // startedAt + sentinelTimeoutSec*1000
  verdict?: SentinelVerdict
  failure?: string        // why it failed, shown in the deny text
}

SentinelVerdict { verdict: 'allow' | 'block', confidence: number /*0..1*/, evidence: string[] }
```

State transitions: `queued → running → concluded | failed | timedOut`; `failed` after a second
malformed answer or a non-`answer` `turn.complete`. `concluded` with `allow` can only produce
`pass` if no hard signal is present (FR-015); `failed` and `timedOut` produce `refuse` (FR-017).
At most one investigation per key runs at a time.

## Override

```
Override { key: string, action: 'allow' | 'block', scope: 'session' | 'permanent', at: number,
           via: 'composer' | 'pane' }
```

Session overrides live in `$.state`. Permanent overrides live in `$.store`. Every override emits
a scene event (FR-028).

## Fleet and scene

```
FleetAgent {
  id: string | 'main'
  type: string            // subagentType, 'main', or 'sentinel'
  state: 'launching' | 'working' | 'returning' | 'gone'
  lastAction?: string     // e.g. "Edit auth.ts"
  tokens: { input: number, output: number, cacheRead: number, cacheWrite: number }
  estCostUsd?: number     // only when the model is in the price table (R14)
}

SceneEvent =                                   // all carry { at: number, seq: number }
  | { type: 'AgentLaunched', agentId, agentType }
  | { type: 'AgentActed', agentId, summary }
  | { type: 'AgentFinished', agentId }
  | { type: 'PackageIntercepted', requestId, agentId, ref }
  | { type: 'PackageScored', requestId, ref, tier, evidence: string[] }
  | { type: 'SentinelDispatched', key, sentinelId }
  | { type: 'VerdictIssued', key, tier, evidence: string[] }
  | { type: 'OverrideApplied', key, action, scope }
  | { type: 'UsageUpdated', agentId, tokens, estCostUsd? }
  | { type: 'Fault', where: 'gate' | 'render' | 'sentinel', message }

Scene {
  seed: number
  agents: Record<id, AgentSprite>          // FleetAgent + world position, orbit, trail
  packages: Record<requestId:key, PackageSprite> // ref, tier, phase (inbound|atRing|passing|bursting|held), position
  sentinels: Record<id, SentinelSprite>    // target key, phase (outbound|scanning|returning)
  effects: Effect[]                        // one-shot bursts and glints with remaining life
  log: LogLine[]                           // last N event lines (text + verdict glyph)
  totals: { intercepts, passed, held, refused, unverified, unchecked, overridden }
  fault?: { message, at }
}
```

`reduce(scene, event) → scene` and `step(scene, dtMs) → scene` are pure. World coordinates are
normalised (0..1), with the command ship at (0.5, 0.5) and the tripwire ring at radius 0.36.
Randomness (orbit radius, entry angle) comes only from a seeded PRNG held in `Scene`, so a
recorded event log replays identically (FR-027, SC-008).

## Persistence map

| Data | Where | Lifetime |
|---|---|---|
| Fetched registry/OSV/deps.dev responses | `$.store` | 6 h metadata, 1 h OSV, 404s 6 h |
| PackageCheck verdicts | `$.store` | 24 h |
| Permanent overrides | `$.store` | until removed |
| Session overrides, investigations, Scene, theme selection | `$.state` | session |
| Event log for replay | memory ring buffer (last 500); demo script shipped as a TS module | session |
