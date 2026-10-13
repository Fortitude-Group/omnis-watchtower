import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { recorded } from './fixtures/http'

const NOW = Date.parse('2026-10-13T00:00:00Z')

// The engine beneath the plugin: recorded HTTP, an empty project, no env, memory store and clock
const world = (on: On, files: Record<string, string> = {}) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const fetched: string[] = []
  on('http.fetch', (_$, e) => {
    const url = (e as { url: string }).url
    const init = (e as { init?: { method?: string; body?: string } }).init
    const k = init?.method === 'POST' ? `POST ${url} ${init.body ?? ''}` : `GET ${url}`
    fetched.push(k)
    const hit = recorded[k] ?? (url.includes('/downloads/point/last-week/') && url.includes(',')
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
  const ran: string[] = []
  on('tool.call', (_$, e) => {
    ran.push(String((e as { command?: string }).command))
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  return { fetched, ran }
}

test('an invented package name is refused before it runs (US1-1)', async ($, on) => {
  const w = world(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'npm install react-dom-utilz' })
  expect(r.deny).toContain('WATCHTOWER REFUSED npm:react-dom-utilz')
  expect(r.deny).toContain('does not exist on npm')
  expect(w.ran).toEqual([])
})

test('a popular package installs and the command really runs (US1-4)', async ($, on) => {
  const w = world(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'npm install chalk' })
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual(['npm install chalk'])
})

test('commands that install nothing pass straight through without a fetch', async ($, on) => {
  const w = world(on)
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(w.ran).toEqual(['git status'])
  expect(w.fetched).toEqual([])
})

test('a subagent\'s install is checked and attributed to it (research R3)', async ($, on) => {
  const w = world(on)
  // agentId is pinned by the engine for real subagent loops; a test can only claim one
  const r = await $.tool.call({ tool: 'Bash', command: 'npm i react-dom-utilz', agentId: 'agent-7' } as Parameters<typeof $.tool.call>[0])
  expect(r.deny).toContain('WATCHTOWER REFUSED npm:react-dom-utilz')
  expect(w.ran).toEqual([])
})

test('a repeat install is decided from the cache with no network (FR-011)', async ($, on) => {
  const w = world(on)
  await $.tool.call({ tool: 'Bash', command: 'npm install chalk' })
  const after = w.fetched.length
  await $.tool.call({ tool: 'Bash', command: 'npm install chalk' })
  expect(w.fetched.length).toBe(after)
  expect(w.ran).toHaveLength(2)
})

test('a fresh release of a popular package runs pinned (FR-035)', async ($, on) => {
  const w = world(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'npm i zod' })
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual(['npm i zod@4.6.5'])
})
