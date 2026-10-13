// Domain types shared by every layer. Plain, JSON-safe data only (data-model.md).

import type { Ecosystem, PackageRef, Tier, TokenUsage } from '../types'

// Persisted shapes live in the $.state contract (types/index.d.ts); re-exported here for core.
export type {
  Ecosystem,
  Investigation,
  Override,
  PackageRef,
  SentinelVerdict,
  Tier,
  TokenUsage,
} from '../types'

export const key = (ref: PackageRef): string =>
  `${ref.ecosystem}:${ref.name}@${ref.version ?? 'latest'}`

/** Name-only key, for overrides and private-registry checks that ignore the version. */
export const nameKey = (ref: Pick<PackageRef, 'ecosystem' | 'name'>): string =>
  `${ref.ecosystem}:${ref.name}`

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const PYPI_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

/** npm names are case-sensitive on old packages but new ones must be lower-case; we compare lower-case. */
export const normaliseNpm = (name: string): string => name.trim().toLowerCase()

/** PEP 503: lower-case, runs of `-`, `_` and `.` collapse to a single `-`. */
export const normalisePypi = (name: string): string => name.trim().toLowerCase().replace(/[-_.]+/g, '-')

export const normalise = (ecosystem: Ecosystem, name: string): string =>
  ecosystem === 'npm' ? normaliseNpm(name) : normalisePypi(name)

export const isValidName = (ecosystem: Ecosystem, name: string): boolean =>
  ecosystem === 'npm'
    ? name.length > 0 && name.length <= 214 && NPM_NAME.test(name)
    : PYPI_NAME.test(name)

/** `shell`: a script piped or substituted into a shell interpreter; its packages are unknowable (FR-003). */
export type InstallTool = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'npx' | 'pip' | 'uv' | 'poetry' | 'pipx' | 'shell'

export type InstallRequest = {
  id: string
  agentId: string
  command: string
  tool: InstallTool
  packages: PackageRef[]
  source: 'explicit' | 'requirements-file' | 'lockfile-diff'
  /** For `requirements-file`: the files to read. For `lockfile-diff`: the project dir ('' = cwd). */
  files?: string[]
  /** Index URLs named on the command line (`--index-url`, `--registry`). */
  indexUrls?: string[]
  /**
   * FR-035: `[start, end)` offsets, in `command`, of the token that named each package, keyed by
   * `key(ref)`. Only packages written on the command line, and only where the token can be
   * replaced by a pinned spelling (not `create` initialisers, aliases or `uvx`/`pipx run` targets).
   */
  spans?: Record<string, [number, number]>
  unchecked: string[]
  at: number
}

export type SignalKind =
  | 'exists'
  | 'malware'
  | 'dependencyConfusion'
  | 'packageAge'
  | 'versionAge'
  | 'typosquat'
  | 'installScripts'
  | 'sdistOnly'
  | 'lowAdoption'
  | 'singleMaintainerLowAdoption'
  | 'noRepository'
  | 'privateRegistry'
  | 'commandLineRegistry'

export type SignalState = 'present' | 'absent' | 'unknown'

export type Signal = {
  kind: SignalKind
  state: SignalState
  weight: 'hard' | 'strong' | 'weak'
  evidence: string
  imitates?: string
}

export type PackageCheck = {
  ref: PackageRef
  tier: Tier
  signals: Signal[]
  alternative?: string
  /** FR-035 cooldown pin: the version the install is rewritten to. */
  pinnedTo?: string
  /** The fresh release the pin avoided (the version `latest` resolved to). */
  pinnedFrom?: string
  decidedBy: 'fast-score' | 'sentinel' | 'override' | 'cache' | 'warn-only' | 'cooldown'
  decidedAt: number
  expiresAt: number
}

export type FleetAgent = {
  id: string
  type: string
  state: 'launching' | 'working' | 'returning' | 'gone'
  lastAction?: string
  tokens: TokenUsage
  estCostUsd?: number
}

/** A fact the adapters could not obtain. Never treated as clean (FR-009). */
export type Unknown = 'unknown'
export type Fact<T> = T | Unknown

export type OsvEntry = {
  id: string
  summary?: string
  aliases?: string[]
  cweIds?: string[]
  /** Exact affected versions when OSV lists them; absent means "all" or unlisted. */
  versions?: string[]
}

export type VersionInfo = { version: string; publishedAt?: string }

/** Everything the adapters learned about one package, merged; each field may be unknown. */
export type PackageFacts = {
  ref: PackageRef
  exists: Fact<boolean>
  /** The resolved version the facts describe (requested exact version, or latest). */
  resolvedVersion: Fact<string>
  versions: Fact<VersionInfo[]>
  /** Install-time lifecycle scripts present on the resolved version (npm). */
  installScripts: Fact<string[]>
  /** PyPI: true when the resolved version has no wheel, only a source distribution. */
  sdistOnly: Fact<boolean>
  weeklyDownloads: Fact<number>
  maintainerCount: Fact<number>
  repository: Fact<string | null>
  osv: Fact<OsvEntry[]>
  /** Set when the name resolves to a private registry and public sources were not consulted. */
  privateRegistry?: string
  /**
   * For a private package: whether the public registry also serves the name. Unknown when that
   * existence check failed, which blocks clearing (hold).
   */
  shadowsPrivate?: Fact<boolean>
  /** A registry or index URL named on the command line (`--registry`, `--index-url`); never trusted. */
  commandLineRegistry?: string
}
