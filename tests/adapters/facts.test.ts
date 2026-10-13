import { beforeEach, describe, expect, it } from 'vitest'
import { gatherFacts, mergeFacts, unknownFacts } from '../../src/plugin/adapters/facts'
import { resetLimiter } from '../../src/plugin/adapters/http'
import { emptyConfig } from '../../src/plugin/adapters/project-config'
import { fixtureIo } from './fixture-io'

beforeEach(() => resetLimiter())

describe('mergeFacts', () => {
  it('fills each field from the first partial that knows it', () => {
    const ref = { ecosystem: 'npm' as const, name: 'x' }
    expect(mergeFacts(ref, { exists: 'unknown', resolvedVersion: '1.0.0' }, { exists: true, resolvedVersion: '2.0.0' })).toEqual({
      ...unknownFacts(ref), exists: true, resolvedVersion: '1.0.0',
    })
  })
})

describe('gatherFacts', () => {
  it('merges every public source for an npm package', async () => {
    const { io, calls } = fixtureIo()
    const [facts] = await gatherFacts(io, [{ ecosystem: 'npm', name: 'crossenv' }], emptyConfig())
    expect(facts).toMatchObject({
      ref: { ecosystem: 'npm', name: 'crossenv' },
      exists: true,
      resolvedVersion: '0.0.2-security',
      installScripts: [],
      sdistOnly: false,
      weeklyDownloads: 1780,
      maintainerCount: 1,
      repository: 'git+https://github.com/npm/security-holder.git',
      osv: [expect.objectContaining({ id: 'GHSA-c2m4-w5hm-vqjw', cweIds: ['CWE-506'] })],
    })
    expect(facts!.versions).toHaveLength(4)
    expect(calls).toHaveLength(4)
  })

  it('merges every public source for a PyPI package', async () => {
    const { io } = fixtureIo()
    const [requests, ctx] = await gatherFacts(io, [{ ecosystem: 'pypi', name: 'requests' }, { ecosystem: 'pypi', name: 'ctx' }], emptyConfig())
    expect(requests).toMatchObject({ exists: true, resolvedVersion: '2.34.2', sdistOnly: false, weeklyDownloads: 310623963, installScripts: [] })
    expect(ctx).toMatchObject({ exists: false, weeklyDownloads: 51 })
    expect(ctx!.osv).toHaveLength(3)
  })

  it('reports a nonexistent npm name from the registry 404', async () => {
    const { io } = fixtureIo()
    const [facts] = await gatherFacts(io, [{ ecosystem: 'npm', name: 'react-dom-utilz' }], emptyConfig())
    expect(facts).toMatchObject({ exists: false, weeklyDownloads: 'unknown', osv: [] })
  })

  it('sends npm downloads for the batch as one bulk request and dedupes repeated refs', async () => {
    const { io, calls } = fixtureIo()
    const refs = [{ ecosystem: 'npm' as const, name: 'chalk' }, { ecosystem: 'npm' as const, name: 'crossenv' }, { ecosystem: 'npm' as const, name: 'chalk' }]
    const facts = await gatherFacts(io, refs, emptyConfig())
    expect(facts.map(f => f.ref.name)).toEqual(['chalk', 'crossenv', 'chalk'])
    expect(facts[1]!.weeklyDownloads).toBe(1780)
    expect(calls.filter(c => c.includes('/downloads/'))).toEqual(['GET https://api.npmjs.org/downloads/point/last-week/chalk,crossenv'])
    expect(calls).toHaveLength(1 + 2 * 3)
  })

  it('keeps unknown what a failed source could not supply', async () => {
    const { io } = fixtureIo()
    const [facts] = await gatherFacts(io, [{ ecosystem: 'npm', name: 'never-recorded' }], emptyConfig())
    expect(facts).toEqual({ ...unknownFacts({ ecosystem: 'npm', name: 'never-recorded' }), sdistOnly: false })
  })

  it('makes only one public existence call for a private package, and flags a public twin', async () => {
    const { io, calls } = fixtureIo()
    const config = emptyConfig()
    config.allowlist = ['chalk', 'acme-*']
    config.npm.scopes['@acme'] = 'https://npm.acme.internal/'
    const [twin, scoped] = await gatherFacts(io, [{ ecosystem: 'npm', name: 'chalk', version: '5.3.0' }, { ecosystem: 'npm', name: '@acme/widgets' }], config)
    expect(twin).toEqual({ ...unknownFacts({ ecosystem: 'npm', name: 'chalk', version: '5.3.0' }), privateRegistry: 'allowlist', shadowsPrivate: true })
    // No recording for the scoped name: the existence check failed, so the answer is unknown
    expect(scoped).toEqual({ ...unknownFacts({ ecosystem: 'npm', name: '@acme/widgets' }), privateRegistry: 'https://npm.acme.internal/', shadowsPrivate: 'unknown' })
    expect(calls.sort()).toEqual(['GET https://registry.npmjs.org/@acme%2Fwidgets/latest', 'GET https://registry.npmjs.org/chalk/latest'])
  })

  it('reports no public twin when the public registry lacks the private name', async () => {
    const { io, calls } = fixtureIo()
    const config = emptyConfig()
    config.allowlist = ['pypi:ctx']
    config.pypi.extraIndexUrls = ['https://pkgs.acme.internal/simple']
    const [facts] = await gatherFacts(io, [{ ecosystem: 'pypi', name: 'ctx' }], config)
    expect(facts).toMatchObject({ privateRegistry: 'https://pkgs.acme.internal/simple', shadowsPrivate: false, osv: 'unknown' })
    expect(calls).toEqual(['GET https://pypi.org/pypi/ctx/json'])
  })

  it('behind a mirror, checks publicly and treats a name the public lacks as private', async () => {
    const { io } = fixtureIo()
    const config = emptyConfig()
    config.npm.registry = 'https://proxy.acme.internal/'
    const [known, missing] = await gatherFacts(io, [{ ecosystem: 'npm', name: 'crossenv' }, { ecosystem: 'npm', name: 'react-dom-utilz' }], config)
    expect(known).toMatchObject({ exists: true, weeklyDownloads: 1780 })
    expect(known!.privateRegistry).toBeUndefined()
    expect(missing).toEqual({ ...unknownFacts({ ecosystem: 'npm', name: 'react-dom-utilz' }), privateRegistry: 'https://proxy.acme.internal/' })
  })
})
