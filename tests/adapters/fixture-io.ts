import { allFixtures } from '../fixtures/http'
import type { HttpReply, HttpRequest, SourceIo } from '../../src/plugin/adapters/ports'

type Fixture = { status: number, body: unknown }

const BULK = 'https://api.npmjs.org/downloads/point/last-week/'

const reply = ({ status, body }: Fixture): HttpReply => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {},
  text: JSON.stringify(body),
})

export const requestKey = (url: string, init?: HttpRequest) =>
  (init?.method ?? 'GET') === 'POST' ? `POST ${url} ${init?.body ?? ''}` : `GET ${url}`

// Serves the recorded responses. A key with no recording fails like a dropped connection.
// The bulk downloads form is assembled from the single-name recordings (null for a 404).
export const fixtureIo = (extra: Record<string, Fixture> = {}) => {
  const fixtures: Record<string, Fixture> = { ...allFixtures, ...extra }
  const calls: string[] = []
  const data = new Map<string, unknown>()
  let now = 1_000_000
  const io: SourceIo = {
    fetch: async (url, init) => {
      const k = requestKey(url, init)
      calls.push(k)
      const recorded = fixtures[k]
      if (recorded) return reply(recorded)
      // OSV answers a versioned query with only the entries affecting that version. Emulate it
      // from the name-only recording: entries listing versions keep only those that include it
      if (url === 'https://api.osv.dev/v1/query' && init?.body?.includes('"version"')) {
        const q = JSON.parse(init.body) as { package: { name: string; ecosystem: string }; version: string }
        const byName = fixtures[`POST ${url} ${JSON.stringify({ package: q.package })}`]
        if (byName && byName.status === 200) {
          const vulns = ((byName.body as { vulns?: { affected?: { versions?: string[] }[] }[] }).vulns ?? [])
            .filter(v => { const listed = (v.affected ?? []).flatMap(a => a.versions ?? []); return listed.length === 0 || listed.includes(q.version) })
          return reply({ status: 200, body: vulns.length ? { vulns } : {} })
        }
      }
      if (url.startsWith(BULK) && url.includes(',')) {
        const body: Record<string, unknown> = {}
        for (const name of url.slice(BULK.length).split(',')) {
          const single = fixtures[`GET ${BULK}${name}`]
          body[name] = single && single.status === 200 ? single.body : null
        }
        return reply({ status: 200, body })
      }
      throw new Error(`no recording for ${k}`)
    },
    after: (ms, fn) => {
      const t = setTimeout(fn, ms)
      return { cancel: () => clearTimeout(t) }
    },
    store: {
      get: async key => data.get(key),
      set: async (key, value) => { data.set(key, JSON.parse(JSON.stringify(value))) },
      delete: async key => { data.delete(key) },
    },
    now: async () => now,
  }
  return { io, calls, data, advance: (ms: number) => { now += ms } }
}
