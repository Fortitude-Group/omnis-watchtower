import { beforeEach, describe, expect, it } from 'vitest'
import { TTL } from '../../src/plugin/adapters/cache'
import { depsDevUrl, fetchDepsDev } from '../../src/plugin/adapters/depsdev'
import {
  fetchNpmDownloads, fetchNpmDownloadsBulk, fetchPypiDownloads, npmDownloadsUrl, pypiStatsUrl,
} from '../../src/plugin/adapters/downloads'
import { resetLimiter } from '../../src/plugin/adapters/http'
import { fetchNpmManifest, isExactNpmVersion, LATEST_TTL_MS, npmManifestUrl } from '../../src/plugin/adapters/npm'
import { fetchOsv, osvQuery } from '../../src/plugin/adapters/osv'
import { fetchPypi, isExactPypiVersion, LATEST_TTL_MS as PYPI_LATEST_TTL_MS, parsePypi, pypiRepository } from '../../src/plugin/adapters/pypi'
import { allFixtures } from '../fixtures/http'
import { fixtureIo } from './fixture-io'

beforeEach(() => resetLimiter())

const body = (k: string) => allFixtures[k]!.body as Record<string, unknown>

describe('urls', () => {
  it('encodes scoped names for the registry and deps.dev, but not for downloads', () => {
    expect(npmManifestUrl({ ecosystem: 'npm', name: '@acme/widgets' })).toBe('https://registry.npmjs.org/@acme%2Fwidgets/latest')
    expect(npmManifestUrl({ ecosystem: 'npm', name: 'chalk', version: '5.3.0' })).toBe('https://registry.npmjs.org/chalk/5.3.0')
    expect(depsDevUrl('@acme/widgets')).toBe('https://api.deps.dev/v3/systems/npm/packages/@acme%2Fwidgets')
    expect(npmDownloadsUrl(['@acme/widgets'])).toBe('https://api.npmjs.org/downloads/point/last-week/@acme/widgets')
    expect(pypiStatsUrl('Python_Dateutil')).toBe('https://pypistats.org/api/packages/python-dateutil/recent')
  })

  it('sends a version to OSV only when it is exact', () => {
    expect(osvQuery({ ecosystem: 'pypi', name: 'ctx', version: '0.2.6' })).toEqual({ package: { name: 'ctx', ecosystem: 'PyPI' }, version: '0.2.6' })
    expect(osvQuery({ ecosystem: 'npm', name: 'chalk', version: '^5.0.0' })).toEqual({ package: { name: 'chalk', ecosystem: 'npm' } })
  })
})

describe('npm registry', () => {
  it('reads version, scripts, repository and maintainers from the manifest', async () => {
    const { io, calls } = fixtureIo()
    expect(await fetchNpmManifest(io, { ecosystem: 'npm', name: 'chalk' })).toEqual({
      exists: true,
      sdistOnly: false,
      resolvedVersion: '6.0.1',
      installScripts: [],
      repository: 'git+https://github.com/chalk/chalk.git',
      maintainerCount: 1,
    })
    expect(calls).toEqual(['GET https://registry.npmjs.org/chalk/latest'])
  })

  it('lists install-time lifecycle scripts only', async () => {
    const { io } = fixtureIo()
    expect((await fetchNpmManifest(io, { ecosystem: 'npm', name: 'esbuild' })).installScripts).toEqual(['postinstall'])
  })

  it('caches a 404 as nonexistent for the not-found TTL', async () => {
    const { io, calls, data } = fixtureIo()
    const ref = { ecosystem: 'npm' as const, name: 'react-dom-utilz' }
    expect((await fetchNpmManifest(io, ref)).exists).toBe(false)
    expect(data.get('wt:npm:react-dom-utilz@latest')).toMatchObject({ expiresAt: 1_000_000 + TTL.notFound })
    await fetchNpmManifest(io, ref)
    expect(calls).toHaveLength(1)
  })

  it('leaves existence unknown when only an exact version is missing', async () => {
    const { io } = fixtureIo({ 'GET https://registry.npmjs.org/chalk/99.0.0': { status: 404, body: null } })
    expect((await fetchNpmManifest(io, { ecosystem: 'npm', name: 'chalk', version: '99.0.0' })).exists).toBe('unknown')
  })

  it('reports every field unknown on a network failure, and caches nothing', async () => {
    const { io, data } = fixtureIo()
    expect(await fetchNpmManifest(io, { ecosystem: 'npm', name: 'not-recorded' })).toEqual({
      exists: 'unknown', resolvedVersion: 'unknown', installScripts: 'unknown', repository: 'unknown', maintainerCount: 'unknown',
    })
    expect(data.size).toBe(0)
  })

  it('reuses a cached latest answer for at most ten minutes', async () => {
    const { io, calls, advance, data } = fixtureIo()
    const ref = { ecosystem: 'npm' as const, name: 'chalk' }
    await fetchNpmManifest(io, ref)
    await fetchNpmManifest(io, ref)
    expect(calls).toHaveLength(1)
    expect(LATEST_TTL_MS).toBe(10 * 60 * 1000)
    expect(data.get('wt:npm:chalk@latest')).toMatchObject({ expiresAt: 1_000_000 + LATEST_TTL_MS })
    advance(LATEST_TTL_MS)
    await fetchNpmManifest(io, ref)
    expect(calls).toHaveLength(2)
  })

  it('keeps an exact version for the metadata TTL, and a dist-tag only briefly', async () => {
    const manifest = allFixtures['GET https://registry.npmjs.org/chalk/latest']!
    const { io, data } = fixtureIo({
      'GET https://registry.npmjs.org/chalk/6.0.1': manifest,
      'GET https://registry.npmjs.org/chalk/next': manifest,
    })
    await fetchNpmManifest(io, { ecosystem: 'npm', name: 'chalk', version: '6.0.1' })
    await fetchNpmManifest(io, { ecosystem: 'npm', name: 'chalk', version: 'next' })
    expect(data.get('wt:npm:chalk@6.0.1')).toMatchObject({ expiresAt: 1_000_000 + TTL.metadata })
    expect(data.get('wt:npm:chalk@next')).toMatchObject({ expiresAt: 1_000_000 + LATEST_TTL_MS })
  })

  it('treats ranges and tags as moving pointers', () => {
    expect(isExactNpmVersion('5.3.0')).toBe(true)
    expect(isExactNpmVersion('1.0.0-beta.1')).toBe(true)
    expect(isExactNpmVersion('^5')).toBe(false)
    expect(isExactNpmVersion('next')).toBe(false)
    expect(isExactNpmVersion(undefined)).toBe(false)
  })

  // Verified live 2026-10-13: registry.npmjs.org/chalk/%5E5 → 404 "version not found: ^5", and
  // /chalk/%3E%3D5 → 405. The registry resolves exact versions and dist-tags, never ranges.
  it('leaves the version unknown for a range the registry will not resolve', async () => {
    const { io } = fixtureIo({ 'GET https://registry.npmjs.org/chalk/%5E5': { status: 404, body: 'version not found: ^5' } })
    expect(await fetchNpmManifest(io, { ecosystem: 'npm', name: 'chalk', version: '^5' })).toMatchObject({ exists: 'unknown', resolvedVersion: 'unknown' })
  })
})

describe('deps.dev', () => {
  it('gives every version with its publish time and the default as resolved', async () => {
    const { io } = fixtureIo()
    const facts = await fetchDepsDev(io, { ecosystem: 'npm', name: 'crossenv' })
    expect(facts).toEqual({
      exists: true,
      resolvedVersion: '0.0.2-security',
      versions: [
        { version: '0.0.1-security', publishedAt: '2017-08-01T15:18:40Z' },
        { version: '0.0.2-security', publishedAt: '2017-08-02T17:51:51Z' },
        { version: '1.0.0', publishedAt: '2017-08-01T23:02:20Z' },
        { version: '1.0.1', publishedAt: '2017-08-01T23:04:34Z' },
      ],
    })
  })

  it('confirms a requested version only when it is listed', async () => {
    const { io } = fixtureIo()
    expect((await fetchDepsDev(io, { ecosystem: 'npm', name: 'chalk', version: '0.1.0' })).resolvedVersion).toBe('0.1.0')
    expect((await fetchDepsDev(io, { ecosystem: 'npm', name: 'chalk', version: '9.9.9' })).resolvedVersion).toBe('unknown')
  })

  it('reports a 404 as nonexistent', async () => {
    const { io } = fixtureIo()
    expect(await fetchDepsDev(io, { ecosystem: 'npm', name: 'react-dom-utilz' })).toEqual({ exists: false, versions: 'unknown', resolvedVersion: 'unknown' })
  })
})

describe('downloads', () => {
  it('reads last week for npm and PyPI, and unknown for a name the API does not know', async () => {
    const { io } = fixtureIo()
    expect(await fetchNpmDownloads(io, 'crossenv')).toBe(1780)
    expect(await fetchNpmDownloads(io, 'react-dom-utilz')).toBe('unknown')
    expect(await fetchPypiDownloads(io, 'requests')).toBe(310623963)
    expect(await fetchNpmDownloads(io, 'not-recorded')).toBe('unknown')
  })

  it('batches unscoped names into one bulk request and sends scoped names alone', async () => {
    const { io, calls } = fixtureIo({
      'GET https://api.npmjs.org/downloads/point/last-week/@acme/widgets': { status: 200, body: { downloads: 12 } },
    })
    const counts = await fetchNpmDownloadsBulk(io, ['crossenv', 'chalk', 'react-dom-utilz', '@acme/widgets', 'chalk'])
    expect(counts).toEqual({
      'crossenv': 1780,
      'chalk': body('GET https://api.npmjs.org/downloads/point/last-week/chalk').downloads,
      'react-dom-utilz': 'unknown',
      '@acme/widgets': 12,
    })
    expect(calls.sort()).toEqual([
      'GET https://api.npmjs.org/downloads/point/last-week/@acme/widgets',
      'GET https://api.npmjs.org/downloads/point/last-week/crossenv,chalk,react-dom-utilz',
    ])
  })

  it('splits more than 128 names into several bulk requests and then answers from cache', async () => {
    const { io, calls } = fixtureIo()
    const names = Array.from({ length: 130 }, (_, i) => `pkg-${i}`)
    const counts = await fetchNpmDownloadsBulk(io, names)
    expect(calls).toHaveLength(2)
    expect(calls[0]!.split(',')).toHaveLength(128)
    expect(Object.values(counts).every(c => c === 'unknown')).toBe(true)
    await fetchNpmDownloadsBulk(io, names)
    expect(calls).toHaveLength(2)
  })

  it('remembers a 429 for a minute, so a repeat check does not ask again straight away', async () => {
    const limited = { status: 429, body: {} }
    const { io, calls } = fixtureIo({
      'GET https://api.npmjs.org/downloads/point/last-week/busy': limited,
      'GET https://api.npmjs.org/downloads/point/last-week/a,b': limited,
    })
    expect(await fetchNpmDownloads(io, 'busy')).toBe('unknown')
    expect(await fetchNpmDownloadsBulk(io, ['a', 'b'])).toEqual({ a: 'unknown', b: 'unknown' })
    const afterFirst = calls.length
    expect(await fetchNpmDownloads(io, 'busy')).toBe('unknown')
    expect(await fetchNpmDownloadsBulk(io, ['a', 'b'])).toEqual({ a: 'unknown', b: 'unknown' })
    expect(calls).toHaveLength(afterFirst)

    let now = await io.now()
    io.now = async () => now
    now += TTL.rateLimited + 1
    await fetchNpmDownloads(io, 'busy')
    expect(calls.length).toBeGreaterThan(afterFirst)
  })

  it('does not remember a dropped connection', async () => {
    const { io, calls } = fixtureIo()
    io.fetch = async (url) => { calls.push(url); throw new Error('offline') }
    await fetchNpmDownloads(io, 'flaky')
    const afterFirst = calls.length
    await fetchNpmDownloads(io, 'flaky')
    expect(calls.length).toBeGreaterThan(afterFirst)
  })

  it('marks a whole chunk unknown when the bulk request fails', async () => {
    const { io } = fixtureIo()
    io.fetch = async () => { throw new Error('offline') }
    expect(await fetchNpmDownloadsBulk(io, ['a', 'b'])).toEqual({ a: 'unknown', b: 'unknown' })
  })
})

describe('PyPI', () => {
  it('reads existence, version, upload times, wheel availability and repository', async () => {
    const { io } = fixtureIo()
    const facts = await fetchPypi(io, { ecosystem: 'pypi', name: 'requests' })
    expect(facts).toMatchObject({
      exists: true,
      resolvedVersion: '2.34.2',
      sdistOnly: false,
      repository: 'https://github.com/psf/requests',
      maintainerCount: 'unknown',
    })
    const versions = facts.versions as Array<{ version: string, publishedAt?: string }>
    expect(versions).toContainEqual({ version: '2.19.1', publishedAt: '2018-06-14T13:40:38.236729Z' })
    // The earliest file of a release, whatever its order in the list
    expect(versions).toContainEqual({ version: '2.23.0', publishedAt: '2020-02-19T18:50:59.409378Z' })
    expect(versions).toContainEqual({ version: '0.0.1' })
  })

  it('reports a 404 as nonexistent', async () => {
    const { io } = fixtureIo()
    expect((await fetchPypi(io, { ecosystem: 'pypi', name: 'ctx' })).exists).toBe(false)
  })

  it('flags a resolved version with only a source distribution', () => {
    const json = {
      info: { name: 'x', version: '1.0', project_urls: null },
      releases: { '1.0': [{ packagetype: 'sdist', upload_time_iso_8601: '2026-01-01T00:00:00Z' }], '0.9': [] },
    }
    expect(parsePypi(json, { ecosystem: 'pypi', name: 'x' })).toMatchObject({ sdistOnly: true, repository: null })
    expect(parsePypi(json, { ecosystem: 'pypi', name: 'x', version: '0.9' })).toMatchObject({ resolvedVersion: '0.9', sdistOnly: 'unknown' })
  })

  it('resolves only an exact pin; any other specifier leaves the version unknown', () => {
    const json = { info: { name: 'x', version: '2.1.0', project_urls: null }, releases: { '2.1.0': [], '1.83.0': [] } }
    const at = (version?: string) => parsePypi(json, version === undefined ? { ecosystem: 'pypi', name: 'x' } : { ecosystem: 'pypi', name: 'x', version }).resolvedVersion
    expect(at()).toBe('2.1.0')
    expect(at('1.83.0')).toBe('1.83.0')
    expect(at('2.0rc1')).toBe('2.0rc1')
    expect(at('>=1.82')).toBe('unknown')
    expect(at('~=2.0')).toBe('unknown')
    expect(at('<2')).toBe('unknown')
    expect(at('1.*')).toBe('unknown')
    expect(at('!=1.0')).toBe('unknown')
  })

  it('accepts PEP 440 exact versions', () => {
    for (const v of ['1.0', '2.0.0', '1!2.0', '1.0a1', '1.0.post1', '1.0.dev3', '1.0+local.7']) expect(isExactPypiVersion(v)).toBe(true)
    for (const v of ['>=1', '~=2.0', '1.*', '==1.0', 'latest']) expect(isExactPypiVersion(v)).toBe(false)
  })

  it('keeps the unversioned answer for at most ten minutes, an exact version for the metadata TTL', async () => {
    const { io, data } = fixtureIo()
    await fetchPypi(io, { ecosystem: 'pypi', name: 'requests' })
    await fetchPypi(io, { ecosystem: 'pypi', name: 'requests', version: '2.34.2' })
    expect(data.get('wt:pypi:requests@latest')).toMatchObject({ expiresAt: 1_000_000 + PYPI_LATEST_TTL_MS })
    expect(data.get('wt:pypi:requests@2.34.2')).toMatchObject({ expiresAt: 1_000_000 + TTL.metadata })
  })

  it('finds the repository among the project URLs', () => {
    const info = (file: string) => body(`GET https://pypi.org/pypi/${file}/json`).info as Record<string, unknown>
    expect(pypiRepository(info('aiohttp'))).toBe('https://github.com/aio-libs/aiohttp')
    expect(pypiRepository(info('attrs'))).toBe('https://github.com/python-attrs/attrs')
    expect(pypiRepository(info('botocore'))).toBe('https://github.com/boto/botocore')
    expect(pypiRepository(info('anyio'))).toBe('https://github.com/agronholm/anyio')
    expect(pypiRepository(info('multidict'))).toBe('https://github.com/aio-libs/multidict')
    expect(pypiRepository(info('charset-normalizer'))).toBe('https://github.com/jawah/charset_normalizer')
    expect(pypiRepository({ project_urls: { Tracker: 'https://github.com/a/b/issues' } })).toBe('https://github.com/a/b')
    expect(pypiRepository({ project_urls: { Homepage: 'https://example.com' }, home_page: null })).toBeNull()
  })
})

describe('OSV', () => {
  it('maps advisories with CWE ids from database_specific', async () => {
    const { io, calls } = fixtureIo()
    expect(await fetchOsv(io, { ecosystem: 'npm', name: 'crossenv' })).toEqual([
      { id: 'GHSA-c2m4-w5hm-vqjw', summary: 'crossenv is malware', aliases: ['CVE-2017-16074'], cweIds: ['CWE-506'] },
    ])
    expect(calls).toEqual(['POST https://api.osv.dev/v1/query {"package":{"name":"crossenv","ecosystem":"npm"}}'])
  })

  it('keeps affected versions and drops empty CWE lists', async () => {
    const { io } = fixtureIo()
    const entries = await fetchOsv(io, { ecosystem: 'pypi', name: 'ctx' })
    expect(entries).toHaveLength(3)
    expect(entries).toContainEqual({ id: 'GHSA-67r3-h899-9w95', summary: 'Embedded Malicious Code in ctx' })
    expect(entries).toContainEqual(expect.objectContaining({ id: 'PYSEC-2022-199', versions: expect.arrayContaining(['0.2.6']) }))
  })

  it('treats an empty body as no advisories and a failure as unknown', async () => {
    const { io } = fixtureIo()
    expect(await fetchOsv(io, { ecosystem: 'npm', name: 'react-dom-utilz' })).toEqual([])
    expect(await fetchOsv(io, { ecosystem: 'npm', name: 'not-recorded' })).toBe('unknown')
  })

  it('posts the exact version when one was requested', async () => {
    const { io, calls } = fixtureIo({
      'POST https://api.osv.dev/v1/query {"package":{"name":"ctx","ecosystem":"PyPI"},"version":"0.2.6"}': { status: 200, body: { vulns: [{ id: 'X' }] } },
    })
    expect(await fetchOsv(io, { ecosystem: 'pypi', name: 'ctx', version: '0.2.6' })).toEqual([{ id: 'X' }])
    expect(calls[0]).toContain('"version":"0.2.6"')
  })
})
