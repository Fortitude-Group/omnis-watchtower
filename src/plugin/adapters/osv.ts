import type { Fact, OsvEntry, PackageRef } from '../core/model'
import { cacheGet, cacheSet, TTL } from './cache'
import { fetchJson } from './http'
import type { SourceIo } from './ports'

const NS = 'osv'

export const OSV_URL = 'https://api.osv.dev/v1/query'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []

// A range (^1.2, >=2) would make OSV refuse the query, so only an exact version is sent
const EXACT = /^v?\d[0-9A-Za-z.+_!-]*$/

export const osvQuery = (ref: PackageRef) => {
  const pkg = { name: ref.name, ecosystem: ref.ecosystem === 'npm' ? 'npm' : 'PyPI' }
  return ref.version && EXACT.test(ref.version) ? { package: pkg, version: ref.version } : { package: pkg }
}

export const parseOsv = (json: unknown): Fact<OsvEntry[]> => {
  if (!isRecord(json)) return 'unknown'
  if (json.vulns === undefined) return []
  if (!Array.isArray(json.vulns)) return 'unknown'
  return json.vulns.filter(isRecord).filter(v => typeof v.id === 'string').map(v => {
    const entry: OsvEntry = { id: v.id as string }
    if (typeof v.summary === 'string') entry.summary = v.summary
    const aliases = strings(v.aliases)
    if (aliases.length) entry.aliases = aliases
    const cweIds = isRecord(v.database_specific) ? strings(v.database_specific.cwe_ids) : []
    if (cweIds.length) entry.cweIds = cweIds
    const versions = Array.isArray(v.affected)
      ? [...new Set(v.affected.flatMap(a => isRecord(a) ? strings(a.versions) : []))]
      : []
    if (versions.length) entry.versions = versions
    return entry
  })
}

export const fetchOsv = async (io: SourceIo, ref: PackageRef): Promise<Fact<OsvEntry[]>> => {
  const query = osvQuery(ref)
  const id = `${ref.ecosystem}:${ref.name}@${'version' in query ? query.version : 'any'}`
  const hit = await cacheGet<OsvEntry[]>(io, NS, id).catch(() => undefined)
  if (hit) return hit
  const res = await fetchJson(io, OSV_URL, { json: query })
  const parsed = res.ok ? parseOsv(res.json) : 'unknown'
  // With a version in the query OSV has already matched its ranges, so every entry applies to
  // that version; drop the explicit lists so they aren't mistaken for the only affected versions
  const entries = parsed !== 'unknown' && 'version' in query ? parsed.map(({ versions: _v, ...e }) => e) : parsed
  if (entries !== 'unknown') await cacheSet(io, NS, id, entries, TTL.osv).catch(() => {})
  return entries
}
