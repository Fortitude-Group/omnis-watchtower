// Test oracle: recorded raw HTTP responses → PackageFacts, mirroring what the adapters produce.

import type { Fact, OsvEntry, PackageFacts, VersionInfo } from '../../src/plugin/core/model'
import { fixturesFor } from '../fixtures/http/index'

type Fixture = { status: number; body: unknown }
type Json = Record<string, unknown>

const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

const find = (fx: Record<string, Fixture>, prefix: string): Fixture | undefined =>
  Object.entries(fx).find(([k]) => k.startsWith(prefix))?.[1]

const ok = (f: Fixture | undefined): Json | undefined => (f && f.status === 200 ? obj(f.body) : undefined)

export const osvFrom = (f: Fixture | undefined): Fact<OsvEntry[]> => {
  if (!f || f.status !== 200) return 'unknown'
  return arr(obj(f.body)?.vulns).map(raw => {
    const v = obj(raw) ?? {}
    const db = obj(v.database_specific)
    const versions = arr(v.affected).flatMap(a => arr(obj(a)?.versions).map(String))
    const cwe = arr(db?.cwe_ids).map(String)
    const e: OsvEntry = { id: String(v.id) }
    const summary = str(v.summary)
    if (summary) e.summary = summary
    const aliases = arr(v.aliases).map(String)
    if (aliases.length) e.aliases = aliases
    if (cwe.length) e.cweIds = cwe
    if (versions.length) e.versions = versions
    return e
  })
}

const existence = (f: Fixture | undefined): Fact<boolean> =>
  !f ? 'unknown' : f.status === 200 ? true : f.status === 404 ? false : 'unknown'

const repoUrl = (v: unknown): string | null => str(v) ?? str(obj(v)?.url) ?? null

const npmFacts = (name: string, fx: Record<string, Fixture>): PackageFacts => {
  const latestF = find(fx, `GET https://registry.npmjs.org/${name}/`)
  const latest = ok(latestF)
  const deps = ok(find(fx, 'GET https://api.deps.dev/'))
  const dl = ok(find(fx, 'GET https://api.npmjs.org/downloads/'))
  const scripts = obj(latest?.scripts)
  const maintainers = latest?.maintainers
  return {
    ref: { ecosystem: 'npm', name },
    exists: existence(latestF),
    resolvedVersion: str(latest?.version) ?? 'unknown',
    versions: deps
      ? arr(deps.versions).map(raw => {
          const v = obj(raw) ?? {}
          const info: VersionInfo = { version: String(obj(v.versionKey)?.version) }
          const at = str(v.publishedAt)
          if (at) info.publishedAt = at
          return info
        })
      : 'unknown',
    installScripts: latest ? Object.keys(scripts ?? {}) : 'unknown',
    sdistOnly: false,
    weeklyDownloads: typeof dl?.downloads === 'number' ? dl.downloads : 'unknown',
    maintainerCount: Array.isArray(maintainers) ? maintainers.length : 'unknown',
    repository: latest ? repoUrl(latest.repository) : 'unknown',
    osv: osvFrom(find(fx, 'POST https://api.osv.dev/')),
  }
}

const REPO_HOST = /\b(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org|sr\.ht)\b/i
const REPO_KEY = /source|repo|code|github|gitlab/i

export const pypiRepository = (info: Json): string | null => {
  const urls = Object.entries(obj(info.project_urls) ?? {}).filter(([, v]) => typeof v === 'string') as [string, string][]
  const byKey = urls.find(([k]) => REPO_KEY.test(k))?.[1]
  const byHost = urls.find(([, v]) => REPO_HOST.test(v))?.[1]
  const home = str(info.home_page)
  return byKey ?? byHost ?? (home && REPO_HOST.test(home) ? home : null)
}

const pypiFacts = (name: string, fx: Record<string, Fixture>): PackageFacts => {
  const jsonF = find(fx, 'GET https://pypi.org/pypi/')
  const json = ok(jsonF)
  const stats = ok(find(fx, 'GET https://pypistats.org/'))
  const info = obj(json?.info)
  const releases = obj(json?.releases)
  const version = str(info?.version)
  const files = (v: string): Json[] => arr(releases?.[v]).map(f => obj(f) ?? {})
  const weekly = obj(stats?.data)?.last_week
  let sdistOnly: Fact<boolean> = 'unknown'
  if (version && files(version).length) {
    const types = files(version).map(f => f.packagetype)
    sdistOnly = types.includes('sdist') && !types.includes('bdist_wheel')
  }
  return {
    ref: { ecosystem: 'pypi', name },
    exists: existence(jsonF),
    resolvedVersion: version ?? 'unknown',
    versions: releases
      ? Object.keys(releases).map(v => {
          const times = files(v).map(f => str(f.upload_time_iso_8601)).filter((t): t is string => !!t).sort()
          return times[0] ? { version: v, publishedAt: times[0] } : { version: v }
        })
      : 'unknown',
    installScripts: json ? [] : 'unknown',
    sdistOnly,
    weeklyDownloads: typeof weekly === 'number' ? weekly : 'unknown',
    maintainerCount: 'unknown',
    repository: info ? pypiRepository(info) : 'unknown',
    osv: osvFrom(find(fx, 'POST https://api.osv.dev/')),
  }
}

export const factsFromFixtures = (ecosystem: 'npm' | 'pypi', name: string): PackageFacts => {
  const fx = fixturesFor(ecosystem, name)
  if (!fx) throw new Error(`no recorded fixtures for ${ecosystem}:${name}`)
  return ecosystem === 'npm' ? npmFacts(name, fx) : pypiFacts(name, fx)
}
