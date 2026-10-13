import type { PackageRef } from '../core/model'
import { cacheGet, cacheSet, TTL } from './cache'
import type { PartialFacts } from './facts'
import { fetchJson } from './http'
import type { SourceIo } from './ports'

// `prepare` also runs on git installs, but not for registry tarballs, so it is left out
export const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'] as const

const NS = 'npm'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// The registry and deps.dev take a scoped name with its slash encoded: @scope%2Fname
export const encodeNpmName = (name: string) => name.replace('/', '%2F')

export const npmManifestUrl = (ref: PackageRef) =>
  `https://registry.npmjs.org/${encodeNpmName(ref.name)}/${ref.version ? encodeURIComponent(ref.version) : 'latest'}`

const npmRepository = (raw: unknown): string | null => {
  const url = isRecord(raw) ? raw.url : raw
  return typeof url === 'string' && url.trim() ? url.trim() : null
}

export const parseNpmManifest = (json: unknown): PartialFacts => {
  if (!isRecord(json)) return npmUnknown()
  const scripts = isRecord(json.scripts) ? json.scripts : {}
  return {
    exists: true,
    // Wheel versus sdist is a PyPI question; for npm the answer is simply no
    sdistOnly: false,
    resolvedVersion: typeof json.version === 'string' ? json.version : 'unknown',
    installScripts: INSTALL_SCRIPTS.filter(name => typeof scripts[name] === 'string'),
    repository: npmRepository(json.repository),
    maintainerCount: Array.isArray(json.maintainers) ? json.maintainers.length : 'unknown',
  }
}

// A 404 on `latest` means no such package. On an exact version it may only mean no such
// version, so existence is left to deps.dev.
export const npmNotFound = (ref: PackageRef): PartialFacts =>
  ref.version ? npmUnknown() : { ...npmUnknown(), exists: false }

export const npmUnknown = (): PartialFacts => ({
  exists: 'unknown',
  resolvedVersion: 'unknown',
  installScripts: 'unknown',
  repository: 'unknown',
  maintainerCount: 'unknown',
})

export const fetchNpmManifest = async (io: SourceIo, ref: PackageRef): Promise<PartialFacts> => {
  const id = `${ref.name}@${ref.version ?? 'latest'}`
  const hit = await cacheGet<PartialFacts>(io, NS, id).catch(() => undefined)
  if (hit) return hit
  const res = await fetchJson(io, npmManifestUrl(ref))
  const facts = res.ok ? parseNpmManifest(res.json) : res.status === 404 ? npmNotFound(ref) : undefined
  if (!facts) return npmUnknown()
  await cacheSet(io, NS, id, facts, res.ok ? TTL.metadata : TTL.notFound).catch(() => {})
  return facts
}
