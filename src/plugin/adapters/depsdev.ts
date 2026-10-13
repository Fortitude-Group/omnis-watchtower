import type { PackageRef, VersionInfo } from '../core/model'
import { cacheGet, cacheSet, TTL } from './cache'

import type { PartialFacts } from './facts'
import { fetchJson } from './http'
import { encodeNpmName, LATEST_TTL_MS } from './npm'
import type { SourceIo } from './ports'
import { isRecord } from './json'

const NS = 'depsdev'

export const depsDevUrl = (name: string) =>
  `https://api.deps.dev/v3/systems/npm/packages/${encodeNpmName(name)}`

// Version list with publish times; the default version stands in for `latest`
export const parseDepsDev = (json: unknown, ref: PackageRef): PartialFacts => {
  const raw = isRecord(json) && Array.isArray(json.versions) ? json.versions : undefined
  if (!raw) return depsDevUnknown()
  const versions: VersionInfo[] = []
  let defaultVersion: string | undefined
  for (const entry of raw) {
    if (!isRecord(entry) || !isRecord(entry.versionKey)) continue
    const version = entry.versionKey.version
    if (typeof version !== 'string') continue
    versions.push(typeof entry.publishedAt === 'string' ? { version, publishedAt: entry.publishedAt } : { version })
    if (entry.isDefault === true) defaultVersion = version
  }
  const resolved = ref.version
    ? versions.some(v => v.version === ref.version) ? ref.version : undefined
    : defaultVersion
  return { exists: true, versions, resolvedVersion: resolved ?? 'unknown' }
}

export const depsDevUnknown = (): PartialFacts => ({ exists: 'unknown', versions: 'unknown', resolvedVersion: 'unknown' })

export const fetchDepsDev = async (io: SourceIo, ref: PackageRef): Promise<PartialFacts> => {
  const id = `${ref.name}@${ref.version ?? 'latest'}`
  const hit = await cacheGet<PartialFacts>(io, NS, id).catch(() => undefined)
  if (hit) return hit
  const res = await fetchJson(io, depsDevUrl(ref.name))
  const facts = res.ok ? parseDepsDev(res.json, ref) : res.status === 404 ? { ...depsDevUnknown(), exists: false } : undefined
  if (!facts) return depsDevUnknown()
  // The version list is how a fresh release is spotted, so an unversioned lookup is only trusted
  // for as long as the latest pointer is; a 6 h list could hide a release published since
  const ttl = res.ok ? (ref.version ? TTL.metadata : LATEST_TTL_MS) : TTL.notFound
  await cacheSet(io, NS, id, facts, ttl).catch(() => {})
  return facts
}
