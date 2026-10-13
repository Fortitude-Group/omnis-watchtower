import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { recorded } from '../fixtures/http'

export const NOW = Date.parse('2026-10-13T00:00:00Z')

type Fixture = { status: number; body: unknown }

// Versioned lookups the recordings don't hold directly: the npm manifest of the latest version is
// the recorded /latest body, and OSV with a version is the name-only answer filtered by version
const versioned = (url: string, body?: string): Fixture | undefined => {
  const npm = url.match(/^https:\/\/registry\.npmjs\.org\/([^/]+)\/([^/]+)$/)
  if (npm && npm[2] !== 'latest') {
    const latest = recorded[`GET https://registry.npmjs.org/${npm[1]}/latest`]
    const v = (latest?.body as { version?: string } | null)?.version
    return latest && v === decodeURIComponent(npm[2]!) ? latest : undefined
  }
  if (url === 'https://api.osv.dev/v1/query' && body?.includes('"version"')) {
    const q = JSON.parse(body) as { package: object; version: string }
    const byName = recorded[`POST ${url} ${JSON.stringify({ package: q.package })}`]
    if (!byName) return undefined
    const vulns = ((byName.body as { vulns?: { affected?: { versions?: string[] }[] }[] }).vulns ?? [])
      .filter(v => { const listed = (v.affected ?? []).flatMap(a => a.versions ?? []); return listed.length === 0 || listed.includes(q.version) })
    return { status: 200, body: vulns.length ? { vulns } : {} }
  }
  return undefined
}

// The engine beneath the plugin: recorded HTTP, an empty project, no env, memory store and clock
export const world = (on: On, files: Record<string, string> = {}) => {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  const fetched: string[] = []
  on('http.fetch', (_$, e) => {
    const url = (e as { url: string }).url
    const init = (e as { init?: { method?: string; body?: string } }).init
    const k = init?.method === 'POST' ? `POST ${url} ${init.body ?? ''}` : `GET ${url}`
    fetched.push(k)
    const hit = recorded[k] ?? versioned(url, init?.body) ?? (url.includes('/downloads/point/last-week/') && url.includes(',')
      ? { status: 200, body: Object.fromEntries(url.split('/').pop()!.split(',').map(n => [n, recorded[`GET https://api.npmjs.org/downloads/point/last-week/${n}`]?.body ?? null])) }
      : undefined)
    if (!hit) throw new Error(`offline: ${k}`)
    return { value: { status: hit.status, ok: hit.status < 300, headers: {}, text: JSON.stringify(hit.body) } }
  })
  on('fs.read', (_$, e) => {
    // The engine resolves relative paths against the session's folder (the plugin folder here)
    const path = String((e as { path: string }).path).replace(/\\/g, '/').replace(/^.*\/src\/plugin\//, '').replace(/^\.\//, '')
    const text = files[path]
    return text === undefined ? { deny: `ENOENT: ${path}` } : { value: text }
  })
  on('env.get', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  const ran: string[] = []
  on('tool.call', (_$, e) => {
    ran.push(String((e as { command?: string }).command))
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  return { fetched, ran, clock }
}
