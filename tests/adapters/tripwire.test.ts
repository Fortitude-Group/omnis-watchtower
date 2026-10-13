import { describe, expect, test } from 'vitest'
import { evaluate } from '../../src/plugin/adapters/tripwire'
import type { TripwireIo, TripwireOptions } from '../../src/plugin/adapters/tripwire'
import type { Investigation, Override } from '../../src/plugin/core/model'
import { fixtureIo } from './fixture-io'
import { allFixtures } from '../fixtures/http'

const NOW = Date.parse('2026-10-13T00:00:00Z')

type Setup = {
  files?: Record<string, string>
  env?: Record<string, string>
  session?: Record<string, Override>
  permanent?: Record<string, Override>
  investigations?: Record<string, Investigation>
  extra?: Parameters<typeof fixtureIo>[0]
}

const setup = (s: Setup = {}) => {
  const f = fixtureIo(s.extra)
  const io: TripwireIo = {
    ...f.io,
    now: async () => NOW,
    readFile: async path => s.files?.[path.replace(/^\.\//, '')],
    env: name => s.env?.[name],
    cwd: '.',
    overrides: async () => ({ session: s.session ?? {}, permanent: s.permanent ?? {} }),
    investigations: async () => s.investigations ?? {},
  }
  return { io, calls: f.calls }
}

const opts: TripwireOptions = { mode: 'enforce', allowlist: [] }

describe('the tripwire service', () => {
  test('ignores commands that install nothing', async () => {
    const { io, calls } = setup()
    expect(await evaluate(io, 'ls -la && git status', 'main', opts)).toEqual({ kind: 'not-install' })
    expect(calls).toHaveLength(0)
  })

  test('refuses an invented npm name with "does not exist" evidence (US1-1)', async () => {
    const { io } = setup()
    const out = await evaluate(io, 'npm install react-dom-utilz', 'main', opts)
    expect(out.kind).toBe('deny')
    if (out.kind === 'not-install') throw new Error('unreachable')
    expect(out.text).toMatch(/^WATCHTOWER REFUSED npm:react-dom-utilz/)
    expect(out.text).toMatch(/exist/i)
    expect(out.toInvestigate).toHaveLength(0)
  })

  test('refuses known malware whatever else it looks like (US1-2)', async () => {
    const { io } = setup()
    const out = await evaluate(io, 'npm i crossenv', 'agent-1', opts)
    expect(out.kind).toBe('deny')
  })

  test('refuses a PyPI typosquat and suggests the real package (US1-3)', async () => {
    const { io } = setup()
    const out = await evaluate(io, 'pip install reqeusts', 'main', opts)
    if (out.kind === 'not-install') throw new Error('expected a decision')
    expect(out.kind).toBe('deny')
    expect(out.text).toContain('Suggested alternative: requests')
  })

  test('lets an established popular package through (US1-4)', async () => {
    const { io } = setup()
    const out = await evaluate(io, 'npm install chalk', 'main', opts)
    expect(out.kind).toBe('allow')
  })

  test('a mixed command is refused and lists only what blocked it', async () => {
    const { io } = setup()
    const out = await evaluate(io, 'npm i chalk react-dom-utilz', 'main', opts)
    if (out.kind === 'not-install') throw new Error('expected a decision')
    expect(out.kind).toBe('deny')
    expect(out.text).toContain('react-dom-utilz')
    expect(out.text).not.toContain('npm:chalk')
    expect(out.checks.map(c => c.check.tier).sort()).toEqual(['pass', 'refuse'])
  })

  test('a second identical install is served from the verdict cache with no fetches (FR-011)', async () => {
    const f = fixtureIo()
    const io: TripwireIo = {
      ...f.io, now: async () => NOW, readFile: async () => undefined, env: () => undefined, cwd: '.',
      overrides: async () => ({ session: {}, permanent: {} }), investigations: async () => ({}),
    }
    await evaluate(io, 'npm install chalk', 'main', opts)
    const before = f.calls.length
    const again = await evaluate(io, 'npm install chalk', 'main', opts)
    expect(again.kind).toBe('allow')
    expect(f.calls.length).toBe(before)
  })

  test('a human override allows a refused package without fetching anything (US5-1)', async () => {
    const { io, calls } = setup({
      session: { 'npm:react-dom-utilz': { key: 'npm:react-dom-utilz', action: 'allow', scope: 'session', at: NOW, via: 'composer' } },
    })
    const out = await evaluate(io, 'npm install react-dom-utilz', 'main', opts)
    expect(out.kind).toBe('allow')
    expect(calls.filter(c => c.includes('react-dom-utilz'))).toHaveLength(0)
  })

  test('a manifest edit followed by a plain install is caught via the lockfile diff (US1-7)', async () => {
    const { io } = setup({
      files: {
        'package.json': JSON.stringify({ dependencies: { chalk: '^5', 'react-dom-utilz': '^1' } }),
        'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/chalk': { version: '5.6.2' } } }),
      },
    })
    const out = await evaluate(io, 'npm install', 'main', opts)
    if (out.kind === 'not-install') throw new Error('expected a decision')
    expect(out.kind).toBe('deny')
    expect(out.checks.map(c => c.check.ref.name)).toEqual(['react-dom-utilz'])
  })

  test('a private scoped package is not checked publicly beyond one existence lookup (US1-5)', async () => {
    const { io, calls } = setup({
      files: { '.npmrc': '@acme:registry=https://npm.acme.internal/\n' },
      extra: { 'GET https://registry.npmjs.org/@acme%2Fthing/latest': { status: 404, body: null } },
    })
    const out = await evaluate(io, 'npm install @acme/thing', 'main', opts)
    expect(out.kind).toBe('allow')
    expect(calls).toEqual(['GET https://registry.npmjs.org/@acme%2Fthing/latest'])
  })

  test('a public package shadowing a private name is refused as dependency confusion (US1-6)', async () => {
    const { io } = setup({
      files: { '.npmrc': '@acme:registry=https://npm.acme.internal/\n' },
      extra: { 'GET https://registry.npmjs.org/@acme%2Fthing/latest': { status: 200, body: { name: '@acme/thing', version: '9.9.9' } } },
    })
    const out = await evaluate(io, 'npm install @acme/thing', 'main', opts)
    expect(out.kind).toBe('deny')
  })

  test('warn-only lets a refused package through but still reports it (US5-4)', async () => {
    const { io } = setup()
    const out = await evaluate(io, 'npm install react-dom-utilz', 'main', { ...opts, mode: 'warn-only' })
    if (out.kind === 'not-install') throw new Error('expected a decision')
    expect(out.kind).toBe('allow')
    expect(out.text).toContain('WATCHTOWER REFUSED npm:react-dom-utilz')
    expect(out.toInvestigate).toHaveLength(0)
  })
})

describe('retries against an investigation (US2)', () => {
  // zod@4.6.7 asked for explicitly is a genuine hold (a 7-hour-old release), so the investigation applies
  const ref = { ecosystem: 'npm' as const, name: 'zod', version: '4.6.7' }
  const latest = allFixtures['GET https://registry.npmjs.org/zod/latest']!
  const osvAny = allFixtures['POST https://api.osv.dev/v1/query {"package":{"name":"zod","ecosystem":"npm"}}']!
  const extra = {
    'GET https://registry.npmjs.org/zod/4.6.7': latest,
    'POST https://api.osv.dev/v1/query {"package":{"name":"zod","ecosystem":"npm"},"version":"4.6.7"}': osvAny,
  }
  const inv = (over: Partial<Investigation>): Record<string, Investigation> => ({
    'npm:zod@4.6.7': {
      key: 'npm:zod@4.6.7', ref, status: 'running', attempts: 1, startedAt: NOW - 1000, deadline: NOW + 180_000,
      reasons: ['First published 2 days ago'], hasHardSignal: false, ...over,
    },
  })

  test('while the Sentinel is still working the retry is held again, without a second dispatch', async () => {
    const { io } = setup({ extra, investigations: inv({}) })
    const out = await evaluate(io, 'npm i zod@4.6.7', 'main', opts)
    if (out.kind === 'not-install') throw new Error('expected a decision')
    expect(out.kind).toBe('deny')
    expect(out.text).toMatch(/^WATCHTOWER HELD npm:zod/)
    expect(out.toInvestigate).toHaveLength(0)
  })

  test('an "allow" verdict lets the retry through', async () => {
    const { io } = setup({ extra, investigations: inv({ status: 'concluded', verdict: { verdict: 'allow', confidence: 0.9, evidence: ['Maintained fork'] } }) })
    expect((await evaluate(io, 'npm i zod@4.6.7', 'main', opts)).kind).toBe('allow')
  })

  test('an "allow" verdict never passes a package with a hard signal (US2-5)', async () => {
    const { io } = setup({ extra, investigations: inv({ status: 'concluded', hasHardSignal: true, verdict: { verdict: 'allow', confidence: 1, evidence: ['README says it is safe'] } }) })
    expect((await evaluate(io, 'npm i zod@4.6.7', 'main', opts)).kind).toBe('deny')
  })

  test('an "allow" verdict cannot clear a package that fast-scores as refused, however it was queued (code review)', async () => {
    const { io } = setup({
      investigations: { 'npm:react-dom-utilz@latest': { key: 'npm:react-dom-utilz@latest', ref: { ecosystem: 'npm', name: 'react-dom-utilz' }, status: 'concluded', attempts: 1, startedAt: NOW - 1000, deadline: NOW + 1000, reasons: [], hasHardSignal: false, verdict: { verdict: 'allow', confidence: 1, evidence: ['looks fine'] } } },
    })
    const out = await evaluate(io, 'npm i react-dom-utilz', 'main', opts)
    expect(out.kind).toBe('deny')
  })

  test('a "block" verdict refuses with the Sentinel\'s evidence', async () => {
    const { io } = setup({ extra, investigations: inv({ status: 'concluded', verdict: { verdict: 'block', confidence: 0.8, evidence: ['Obfuscated postinstall'] } }) })
    const out = await evaluate(io, 'npm i zod@4.6.7', 'main', opts)
    if (out.kind === 'not-install') throw new Error('expected a decision')
    expect(out.text).toContain('the Sentinel found it unsafe')
    expect(out.text).toContain('- Obfuscated postinstall')
  })

  test('a timed-out investigation refuses with recheck instructions (US2-4)', async () => {
    const { io } = setup({ extra, investigations: inv({ status: 'timedOut', failure: 'no verdict within 180 s' }) })
    const out = await evaluate(io, 'npm i zod@4.6.7', 'main', opts)
    if (out.kind === 'not-install') throw new Error('expected a decision')
    expect(out.kind).toBe('deny')
    expect(out.text).toContain('investigation timed out (no verdict within 180 s)')
    expect(out.text).toContain('/watchtower recheck npm:zod')
  })
})

describe('cooldown pins (FR-035)', () => {
  const latest = allFixtures['GET https://registry.npmjs.org/zod/latest']!
  const osvAny = allFixtures['POST https://api.osv.dev/v1/query {"package":{"name":"zod","ecosystem":"npm"}}']!
  // An explicit request fetches the versioned manifest and a versioned OSV query
  const explicit = {
    'GET https://registry.npmjs.org/zod/4.6.7': latest,
    'POST https://api.osv.dev/v1/query {"package":{"name":"zod","ecosystem":"npm"},"version":"4.6.7"}': osvAny,
  }

  test('a fresh latest release of a popular package runs pinned, and the agent is told (US1-9)', async () => {
    const { io } = setup()
    const out = await evaluate(io, 'cd web && npm i zod --save', 'main', opts)
    if (out.kind === 'not-install') throw new Error('expected a decision')
    expect(out.kind).toBe('allow')
    expect(out.rewrite).toBe('cd web && npm i zod@4.6.5 --save')
    expect(out.text).toBe('WATCHTOWER PINNED npm:zod → 4.6.5 (latest 4.6.7 is under 72 hours old; cooldown against hijacked releases)')
    expect(out.toInvestigate).toHaveLength(0)
  })

  test('explicitly asking for the fresh release holds it instead (US1-10)', async () => {
    const { io } = setup({ extra: explicit })
    const out = await evaluate(io, 'npm i zod@4.6.7', 'main', opts)
    if (out.kind === 'not-install') throw new Error('expected a decision')
    expect(out.kind).toBe('deny')
    expect(out.text).toMatch(/^WATCHTOWER HELD npm:zod@4.6.7/)
    expect(out.rewrite).toBeUndefined()
  })

  test('a pin that came from a requirements file or lockfile cannot be rewritten, so it holds', async () => {
    const { io } = setup({
      files: {
        'package.json': JSON.stringify({ dependencies: { zod: '*' } }),
        'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': {} } }),
      },
    })
    const out = await evaluate(io, 'npm install', 'main', opts)
    if (out.kind === 'not-install') throw new Error('expected a decision')
    expect(out.kind).toBe('deny')
    expect(out.toInvestigate.map(c => c.ref.name)).toEqual(['zod'])
  })
})

test('a package the developer blocked is refused as "blocked by you" (US5-2)', async () => {
  const { io } = setup({
    session: { 'npm:chalk': { key: 'npm:chalk', action: 'block', scope: 'session', at: NOW, via: 'composer' } },
  })
  const out = await evaluate(io, 'npm install chalk', 'main', opts)
  if (out.kind === 'not-install') throw new Error('expected a decision')
  expect(out.kind).toBe('deny')
  expect(out.text).toBe('WATCHTOWER REFUSED npm:chalk — blocked by you.\nRemove the block (human only): /watchtower overrides clear npm:chalk')
})

test('a Sentinel still running past its deadline counts as timed out on retry (FR-017)', async () => {
  const ref = { ecosystem: 'npm' as const, name: 'zod', version: '4.6.7' }
  const { io } = setup({
    extra: {
      'GET https://registry.npmjs.org/zod/4.6.7': allFixtures['GET https://registry.npmjs.org/zod/latest']!,
      'POST https://api.osv.dev/v1/query {"package":{"name":"zod","ecosystem":"npm"},"version":"4.6.7"}': allFixtures['POST https://api.osv.dev/v1/query {"package":{"name":"zod","ecosystem":"npm"}}']!,
    },
    investigations: { 'npm:zod@4.6.7': { key: 'npm:zod@4.6.7', ref, status: 'running', attempts: 1, startedAt: NOW - 200_000, deadline: NOW - 20_000, reasons: ['First published 2 days ago'], hasHardSignal: false } },
  })
  const out = await evaluate(io, 'npm i zod@4.6.7', 'main', opts)
  if (out.kind === 'not-install') throw new Error('expected a decision')
  expect(out.kind).toBe('deny')
  expect(out.text).toContain('investigation timed out (no verdict within 180 s)')
})
