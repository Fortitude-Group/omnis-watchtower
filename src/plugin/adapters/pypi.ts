import type { PackageRef, VersionInfo } from '../core/model'
import { cacheGet, cacheSet, TTL } from './cache'
import type { PartialFacts } from './facts'
import { fetchJson } from './http'
import { LATEST_TTL_MS } from './npm'
import type { SourceIo } from './ports'
import { isRecord } from './json'

export { LATEST_TTL_MS }

const NS = 'pypi'

// The parser stores `==X` as X, so an exact pin is a bare PEP 440 version (no operator, no `*`)
const EXACT_PEP440 = /^(?:\d+!)?\d+(?:\.\d+)*(?:[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview|post|rev|r|dev)[-_.]?\d*)*(?:\+[0-9A-Za-z.]+)?$/i

export const isExactPypiVersion = (version: string): boolean => EXACT_PEP440.test(version.trim())

// The project endpoint, not /<name>/<version>/json, which carries no release list
export const pypiUrl = (name: string) => `https://pypi.org/pypi/${encodeURIComponent(name)}/json`

const REPO_HOST = /^https?:\/\/(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)\/([^/?#]+)\/([^/?#]+)/i
// "Code" alone counts, but not "Code of Conduct" or "Coverage: codecov"
const REPO_KEY = /\b(?:repo|repository|source)\b|^code$/i
const HOME_KEY = /^(?:home ?page|home|github|gitlab)$/i

const repoRoot = (url: string): string | undefined => {
  const m = REPO_HOST.exec(url)
  if (!m || m[1]?.toLowerCase() === 'sponsors') return undefined
  return m[0].replace(/\.git$/i, '')
}

// Preference: a Source/Repository/Code link, then a Homepage on a code host, then any
// project URL on a code host trimmed to owner/repo (an issues or actions link still names it)
export const pypiRepository = (info: Record<string, unknown>): string | null => {
  const urls = isRecord(info.project_urls)
    ? Object.entries(info.project_urls).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== '')
    : []
  const source = urls.find(([k]) => REPO_KEY.test(k))
  if (source) return source[1].trim()
  const home = urls.find(([k, v]) => HOME_KEY.test(k) && repoRoot(v))
  if (home) return home[1].trim()
  if (typeof info.home_page === 'string' && repoRoot(info.home_page)) return info.home_page.trim()
  for (const [, v] of urls) {
    const root = repoRoot(v)
    if (root) return root
  }
  return null
}

type File = { packagetype?: unknown, upload_time_iso_8601?: unknown }

const earliest = (files: File[]): string | undefined =>
  files
    .map(f => f.upload_time_iso_8601)
    .filter((t): t is string => typeof t === 'string')
    .sort()[0]

// maintainerCount stays unknown: the JSON API exposes only free-text author/maintainer
// fields, not the account roles that own the project
export const parsePypi = (json: unknown, ref: PackageRef): PartialFacts => {
  if (!isRecord(json) || !isRecord(json.info)) return pypiUnknown()
  const releases = isRecord(json.releases) ? json.releases : {}
  const versions: VersionInfo[] = Object.entries(releases).map(([version, files]) => {
    const publishedAt = Array.isArray(files) ? earliest(files as File[]) : undefined
    return publishedAt ? { version, publishedAt } : { version }
  })
  // A range (>=1.82, ~=2.0, <2) cannot be resolved here without pip's resolver, so the version
  // stays unknown rather than a specifier no advisory or release could ever match
  const latest = typeof json.info.version === 'string' ? json.info.version : undefined
  const resolved = ref.version === undefined ? latest : isExactPypiVersion(ref.version) ? ref.version : undefined
  const files = resolved !== undefined ? releases[resolved] : undefined
  const sdistOnly = Array.isArray(files) && files.length > 0
    ? (files as File[]).every(f => f.packagetype === 'sdist')
    : 'unknown'
  return {
    exists: true,
    // npm lifecycle scripts have no PyPI counterpart; a source build is what sdistOnly reports
    installScripts: [],
    resolvedVersion: resolved ?? 'unknown',
    versions,
    sdistOnly,
    repository: pypiRepository(json.info),
    maintainerCount: 'unknown',
  }
}

export const pypiUnknown = (): PartialFacts => ({
  exists: 'unknown',
  resolvedVersion: 'unknown',
  versions: 'unknown',
  sdistOnly: 'unknown',
  repository: 'unknown',
  maintainerCount: 'unknown',
})

export const fetchPypi = async (io: SourceIo, ref: PackageRef): Promise<PartialFacts> => {
  const id = `${ref.name}@${ref.version ?? 'latest'}`
  const hit = await cacheGet<PartialFacts>(io, NS, id).catch(() => undefined)
  if (hit) return hit
  const res = await fetchJson(io, pypiUrl(ref.name))
  const facts = res.ok ? parsePypi(res.json, ref) : res.status === 404 ? { ...pypiUnknown(), exists: false } : undefined
  if (!facts) return pypiUnknown()
  // Unversioned requests follow the latest release, so their answer is kept briefly; a cached
  // 404 only ever refuses, so it keeps the long TTL
  const ttl = !res.ok ? TTL.notFound : ref.version === undefined ? LATEST_TTL_MS : TTL.metadata
  await cacheSet(io, NS, id, facts, ttl).catch(() => {})
  return facts
}
