import { expect, test } from 'claude-code/testing'

import { world } from './helpers/world'


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
