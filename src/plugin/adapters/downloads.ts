import type { Fact } from '../core/model'
import { normalisePypi } from '../core/model'
import { cacheGet, cacheSet, TTL } from './cache'
import { fetchJson } from './http'
import type { SourceIo } from './ports'

export const NPM_BULK_MAX = 128

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// The downloads API takes the raw name, scoped or not
export const npmDownloadsUrl = (names: string[]) =>
  `https://api.npmjs.org/downloads/point/last-week/${names.join(',')}`

export const pypiStatsUrl = (name: string) =>
  `https://pypistats.org/api/packages/${encodeURIComponent(normalisePypi(name))}/recent`

const count = (v: unknown): Fact<number> => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 'unknown'

export const parseNpmDownloads = (json: unknown): Fact<number> => isRecord(json) ? count(json.downloads) : 'unknown'

export const parsePypiStats = (json: unknown): Fact<number> =>
  isRecord(json) && isRecord(json.data) ? count(json.data.last_week) : 'unknown'

// A 404 means the API has no record of the name (a brand-new package reads 0, not 404), so
// the count is unknown. The 404 is still cached for the not-found TTL.
const cached = async (io: SourceIo, ns: string, id: string, url: string, parse: (json: unknown) => Fact<number>): Promise<Fact<number>> => {
  const hit = await cacheGet<Fact<number>>(io, ns, id).catch(() => undefined)
  if (hit !== undefined) return hit
  const res = await fetchJson(io, url)
  const value = res.ok ? parse(res.json) : 'unknown'
  if (res.ok ? value !== 'unknown' : res.status === 404) {
    await cacheSet(io, ns, id, value, res.ok ? TTL.metadata : TTL.notFound).catch(() => {})
  }
  return value
}

export const fetchNpmDownloads = (io: SourceIo, name: string) =>
  cached(io, 'dl-npm', name, npmDownloadsUrl([name]), parseNpmDownloads)

export const fetchPypiDownloads = (io: SourceIo, name: string) =>
  cached(io, 'dl-pypi', normalisePypi(name), pypiStatsUrl(name), parsePypiStats)

// The bulk form answers { "<name>": { downloads } | null }, but only for unscoped names and
// at most 128 at a time; scoped names and a lone name go through the single form
export const fetchNpmDownloadsBulk = async (io: SourceIo, names: string[]): Promise<Record<string, Fact<number>>> => {
  const out: Record<string, Fact<number>> = {}
  const todo: string[] = []
  for (const name of new Set(names)) {
    const hit = await cacheGet<Fact<number>>(io, 'dl-npm', name).catch(() => undefined)
    if (hit !== undefined) out[name] = hit
    else todo.push(name)
  }
  const bulk = todo.filter(name => !name.startsWith('@'))
  const single = todo.filter(name => name.startsWith('@'))
  if (bulk.length === 1) single.push(...bulk.splice(0))
  const chunks: string[][] = []
  for (let i = 0; i < bulk.length; i += NPM_BULK_MAX) chunks.push(bulk.slice(i, i + NPM_BULK_MAX))

  await Promise.all([
    ...single.map(async name => { out[name] = await fetchNpmDownloads(io, name) }),
    ...chunks.map(async chunk => {
      const res = await fetchJson(io, npmDownloadsUrl(chunk))
      const body = res.ok && isRecord(res.json) ? res.json : undefined
      for (const name of chunk) {
        if (!body) {
          out[name] = 'unknown'
          continue
        }
        // null marks a name the API does not know, the bulk form's 404
        const value = parseNpmDownloads(body[name])
        out[name] = value
        const ttl = value !== 'unknown' ? TTL.metadata : body[name] === null ? TTL.notFound : undefined
        if (ttl !== undefined) await cacheSet(io, 'dl-npm', name, value, ttl).catch(() => {})
      }
    }),
  ])
  return out
}
