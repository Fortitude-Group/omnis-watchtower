// PackageFacts → Signals. Unknown facts become unknown signals, never clean ones (FR-009).

import type { Fact, PackageFacts, Signal, SignalKind, SignalState, VersionInfo } from '../model'
import { normalise } from '../model'
import { evidence } from './evidence'
import { findMalware } from './malware'
import { findTyposquat, type TyposquatIndex } from './typosquat'

export const DAY = 86_400_000
export const NEW_PACKAGE_MS = 7 * DAY
export const NEW_VERSION_MS = 72 * 3_600_000
export const LOW_ADOPTION_WEEKLY = 1_000
export const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'] as const

export const WEIGHTS: Record<SignalKind, Signal['weight']> = {
  exists: 'hard',
  malware: 'hard',
  dependencyConfusion: 'hard',
  packageAge: 'strong',
  versionAge: 'strong',
  typosquat: 'strong',
  installScripts: 'weak',
  sdistOnly: 'weak',
  lowAdoption: 'weak',
  singleMaintainerLowAdoption: 'weak',
  noRepository: 'weak',
  privateRegistry: 'weak',
}

const sig = (kind: SignalKind, state: SignalState, text: string, imitates?: string): Signal =>
  imitates ? { kind, state, weight: WEIGHTS[kind], evidence: text, imitates } : { kind, state, weight: WEIGHTS[kind], evidence: text }

const known = <T>(f: Fact<T>): f is T => f !== 'unknown'

const time = (v: VersionInfo): number | undefined => {
  const t = v.publishedAt ? Date.parse(v.publishedAt) : NaN
  return Number.isFinite(t) ? t : undefined
}

const firstPublished = (versions: Fact<VersionInfo[]>): number | undefined => {
  if (!known(versions)) return undefined
  const times = versions.map(time).filter((t): t is number => t !== undefined)
  return times.length ? Math.min(...times) : undefined
}

const versionPublished = (versions: Fact<VersionInfo[]>, version: Fact<string>): number | undefined => {
  if (!known(versions) || !known(version)) return undefined
  const v = versions.find(x => x.version === version)
  return v ? time(v) : undefined
}

export const buildSignals = (facts: PackageFacts, now: number, popular: TyposquatIndex): Signal[] => {
  const { ecosystem, name } = facts.ref
  const out: Signal[] = []

  const exists: SignalState = known(facts.exists) ? (facts.exists ? 'present' : 'absent') : 'unknown'
  out.push(sig('exists', exists, evidence.exists(ecosystem, name, exists)))

  if (facts.privateRegistry) out.push(sig('privateRegistry', 'present', evidence.privateRegistry('present', facts.privateRegistry)))

  const m = findMalware(facts.osv, facts.resolvedVersion)
  const ids = m.state === 'absent' ? [] : m.entries.map(e => e.id)
  out.push(
    sig(
      'malware',
      m.state,
      m.state === 'unknown' && ids.length ? evidence.malwareVersionUnclear(ids) : evidence.malware(m.state, ids, m.state === 'present' ? m.entries[0]?.summary : undefined),
    ),
  )

  const shadow: SignalState =
    facts.shadowsPrivate === 'unknown' ? 'unknown' : facts.shadowsPrivate ? 'present' : 'absent'
  out.push(sig('dependencyConfusion', shadow, evidence.dependencyConfusion(name, shadow)))

  const first = firstPublished(facts.versions)
  const pkgAge: SignalState = first === undefined ? 'unknown' : now - first < NEW_PACKAGE_MS ? 'present' : 'absent'
  out.push(sig('packageAge', pkgAge, evidence.packageAge(pkgAge, first === undefined ? undefined : now - first)))

  const published = versionPublished(facts.versions, facts.resolvedVersion)
  const verAge: SignalState = published === undefined ? 'unknown' : now - published < NEW_VERSION_MS ? 'present' : 'absent'
  out.push(
    sig(
      'versionAge',
      verAge,
      evidence.versionAge(verAge, known(facts.resolvedVersion) ? facts.resolvedVersion : undefined, published === undefined ? undefined : now - published),
    ),
  )

  const squat = findTyposquat(popular, normalise(ecosystem, name))
  out.push(
    squat
      ? sig('typosquat', 'present', evidence.typosquat('present', squat.imitates, squat.distance), squat.imitates)
      : sig('typosquat', 'absent', evidence.typosquat('absent')),
  )

  const scripts = known(facts.installScripts)
    ? facts.installScripts.filter(s => (INSTALL_SCRIPTS as readonly string[]).includes(s))
    : undefined
  const scriptState: SignalState = scripts === undefined ? 'unknown' : scripts.length ? 'present' : 'absent'
  out.push(sig('installScripts', scriptState, evidence.installScripts(scriptState, scripts)))

  const sdist: SignalState = known(facts.sdistOnly) ? (facts.sdistOnly ? 'present' : 'absent') : 'unknown'
  out.push(sig('sdistOnly', sdist, evidence.sdistOnly(sdist)))

  const weekly = facts.weeklyDownloads
  const low: SignalState = known(weekly) ? (weekly < LOW_ADOPTION_WEEKLY ? 'present' : 'absent') : 'unknown'
  out.push(sig('lowAdoption', low, evidence.lowAdoption(low, known(weekly) ? weekly : undefined)))

  const maint = facts.maintainerCount
  const single: SignalState =
    (known(maint) && maint !== 1) || low === 'absent' ? 'absent' : known(maint) && low === 'present' ? 'present' : 'unknown'
  out.push(sig('singleMaintainerLowAdoption', single, evidence.singleMaintainerLowAdoption(single)))

  const repo = facts.repository
  const noRepo: SignalState = known(repo) ? (repo && repo.trim() ? 'absent' : 'present') : 'unknown'
  out.push(sig('noRepository', noRepo, evidence.noRepository(noRepo)))

  return out
}
