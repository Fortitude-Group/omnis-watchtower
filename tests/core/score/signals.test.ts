import { describe, expect, test } from 'vitest'
import type { PackageFacts, Signal, SignalKind } from '../../../src/plugin/core/model'
import { buildSignals } from '../../../src/plugin/core/score/signals'
import { buildTyposquatIndex } from '../../../src/plugin/core/score/typosquat'

const NOW = Date.parse('2026-10-13T00:00:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR
const iso = (ms: number): string => new Date(ms).toISOString()
const popular = buildTyposquatIndex(['chalk', 'lodash', 'express', 'requests'])

const facts = (over: Partial<PackageFacts> = {}): PackageFacts => ({
  ref: { ecosystem: 'npm', name: 'some-package' },
  exists: true,
  resolvedVersion: '2.0.0',
  versions: [
    { version: '1.0.0', publishedAt: iso(NOW - 400 * DAY) },
    { version: '2.0.0', publishedAt: iso(NOW - 30 * DAY) },
  ],
  installScripts: [],
  sdistOnly: false,
  weeklyDownloads: 50_000,
  maintainerCount: 3,
  repository: 'git+https://github.com/x/some-package.git',
  osv: [],
  ...over,
})

const get = (signals: Signal[], kind: SignalKind): Signal => {
  const s = signals.find(x => x.kind === kind)
  if (!s) throw new Error(`no ${kind} signal`)
  return s
}
const build = (over: Partial<PackageFacts> = {}): Signal[] => buildSignals(facts(over), NOW, popular)
const state = (over: Partial<PackageFacts>, kind: SignalKind): Signal['state'] => get(build(over), kind).state

describe('buildSignals', () => {
  test('a clean established package has no present signals besides exists', () => {
    const s = build()
    expect(s.filter(x => x.state === 'present').map(x => x.kind)).toEqual(['exists'])
    expect(s.filter(x => x.state === 'unknown')).toEqual([])
  })

  test('every signal carries a one-line evidence string', () => {
    for (const s of build({ weeklyDownloads: 'unknown', osv: 'unknown' })) {
      expect(s.evidence.length).toBeGreaterThan(0)
      expect(s.evidence).not.toContain('\n')
    }
  })

  test('exists: present, absent, unknown', () => {
    expect(get(build(), 'exists')).toMatchObject({ state: 'present', weight: 'hard' })
    expect(get(build({ exists: false }), 'exists').state).toBe('absent')
    expect(get(build({ exists: false }), 'exists').evidence).toMatch(/does not exist on npm/)
    expect(state({ exists: 'unknown' }, 'exists')).toBe('unknown')
  })

  test('malware: present with ids, unknown when OSV unreachable, version filtering', () => {
    const m = get(build({ osv: [{ id: 'GHSA-c2m4-w5hm-vqjw', summary: 'crossenv is malware', cweIds: ['CWE-506'] }] }), 'malware')
    expect(m).toMatchObject({ state: 'present', weight: 'hard' })
    expect(m.evidence).toContain('GHSA-c2m4-w5hm-vqjw')
    expect(state({ osv: 'unknown' }, 'malware')).toBe('unknown')
    expect(state({ osv: [{ id: 'MAL-1', versions: ['1.0.0'] }] }, 'malware')).toBe('absent')
    expect(state({ osv: [{ id: 'MAL-1', versions: ['2.0.0'] }] }, 'malware')).toBe('present')
  })

  test('dependency confusion', () => {
    expect(state({}, 'dependencyConfusion')).toBe('absent')
    expect(get(build({ shadowsPrivate: true }), 'dependencyConfusion')).toMatchObject({ state: 'present', weight: 'hard' })
    expect(state({ shadowsPrivate: false }, 'dependencyConfusion')).toBe('absent')
    expect(get(build({ shadowsPrivate: 'unknown' }), 'dependencyConfusion')).toMatchObject({ state: 'unknown', weight: 'hard' })
  })

  test('private registry is recorded when set', () => {
    expect(build().some(s => s.kind === 'privateRegistry')).toBe(false)
    expect(get(build({ privateRegistry: 'https://npm.acme.dev' }), 'privateRegistry').state).toBe('present')
  })

  test('package age under 7 days is strong', () => {
    const young = [{ version: '2.0.0', publishedAt: iso(NOW - 2 * DAY) }]
    expect(get(build({ versions: young }), 'packageAge')).toMatchObject({ state: 'present', weight: 'strong' })
    expect(state({ versions: [{ version: '2.0.0', publishedAt: iso(NOW - 8 * DAY) }] }, 'packageAge')).toBe('absent')
    expect(state({ versions: 'unknown' }, 'packageAge')).toBe('unknown')
    expect(state({ versions: [{ version: '2.0.0' }] }, 'packageAge')).toBe('unknown')
  })

  test('version age under 72 hours is strong', () => {
    const versions = [
      { version: '1.0.0', publishedAt: iso(NOW - 400 * DAY) },
      { version: '2.0.0', publishedAt: iso(NOW - 71 * HOUR) },
    ]
    expect(get(build({ versions }), 'versionAge')).toMatchObject({ state: 'present', weight: 'strong' })
    expect(state({ versions: [{ version: '2.0.0', publishedAt: iso(NOW - 73 * HOUR) }] }, 'versionAge')).toBe('absent')
    expect(state({ resolvedVersion: 'unknown' }, 'versionAge')).toBe('unknown')
    expect(state({ resolvedVersion: '9.9.9' }, 'versionAge')).toBe('unknown')
  })

  test('typosquat names the imitated package', () => {
    const s = buildSignals(facts({ ref: { ecosystem: 'npm', name: 'lodahs' }, weeklyDownloads: 200 }), NOW, popular)
    expect(get(s, 'typosquat')).toMatchObject({ state: 'present', imitates: 'lodash', weight: 'strong' })
    expect(state({}, 'typosquat')).toBe('absent')
  })

  test('install scripts: only lifecycle hooks count', () => {
    const s = get(build({ installScripts: ['postinstall', 'test'] }), 'installScripts')
    expect(s).toMatchObject({ state: 'present', weight: 'weak' })
    expect(s.evidence).toContain('postinstall')
    expect(s.evidence).not.toContain('test')
    expect(state({ installScripts: ['prepublishOnly'] }, 'installScripts')).toBe('absent')
    expect(state({ installScripts: 'unknown' }, 'installScripts')).toBe('unknown')
  })

  test('sdist only', () => {
    expect(state({ sdistOnly: true }, 'sdistOnly')).toBe('present')
    expect(state({ sdistOnly: 'unknown' }, 'sdistOnly')).toBe('unknown')
  })

  test('low adoption under 1,000 a week', () => {
    expect(get(build({ weeklyDownloads: 999 }), 'lowAdoption')).toMatchObject({ state: 'present', weight: 'weak' })
    expect(state({ weeklyDownloads: 1_000 }, 'lowAdoption')).toBe('absent')
    expect(state({ weeklyDownloads: 'unknown' }, 'lowAdoption')).toBe('unknown')
  })

  test('single maintainer counts only with low adoption (research R8)', () => {
    // chalk: one maintainer, ~498M downloads a week.
    expect(state({ maintainerCount: 1, weeklyDownloads: 498_507_821 }, 'singleMaintainerLowAdoption')).toBe('absent')
    expect(state({ maintainerCount: 1, weeklyDownloads: 12 }, 'singleMaintainerLowAdoption')).toBe('present')
    expect(state({ maintainerCount: 2, weeklyDownloads: 12 }, 'singleMaintainerLowAdoption')).toBe('absent')
    expect(state({ maintainerCount: 'unknown', weeklyDownloads: 12 }, 'singleMaintainerLowAdoption')).toBe('unknown')
    expect(state({ maintainerCount: 'unknown', weeklyDownloads: 5_000 }, 'singleMaintainerLowAdoption')).toBe('absent')
    expect(state({ maintainerCount: 1, weeklyDownloads: 'unknown' }, 'singleMaintainerLowAdoption')).toBe('unknown')
  })

  test('no repository', () => {
    expect(state({ repository: null }, 'noRepository')).toBe('present')
    expect(state({ repository: '' }, 'noRepository')).toBe('present')
    expect(state({ repository: 'unknown' }, 'noRepository')).toBe('unknown')
  })

  test('a missing package propagates unknowns, never clean', () => {
    const s = build({
      exists: false,
      resolvedVersion: 'unknown',
      versions: 'unknown',
      installScripts: 'unknown',
      sdistOnly: 'unknown',
      weeklyDownloads: 'unknown',
      maintainerCount: 'unknown',
      repository: 'unknown',
    })
    for (const k of ['packageAge', 'versionAge', 'installScripts', 'sdistOnly', 'lowAdoption', 'singleMaintainerLowAdoption', 'noRepository'] as const) {
      expect(get(s, k).state).toBe('unknown')
    }
  })
})

describe('look-alikes that are themselves widely used (live sweep, 2026-10-13)', () => {
  test('a resembling name with 50k+ weekly downloads is a neighbour, not a squatter', async () => {
    const { buildSignals } = await import('../../../src/plugin/core/score/signals')
    const { buildTyposquatIndex } = await import('../../../src/plugin/core/score/typosquat')
    const index = buildTyposquatIndex(['pyyaml', 'uvicorn'], 'pypi')
    const base = {
      exists: true, resolvedVersion: '1.0.0', versions: [{ version: '1.0.0', publishedAt: '2020-01-01T00:00:00Z' }],
      installScripts: [], sdistOnly: false, maintainerCount: 'unknown' as const, repository: 'https://github.com/x/y', osv: [],
    }
    const now = Date.parse('2026-10-13T00:00:00Z')
    const wide = buildSignals({ ...base, ref: { ecosystem: 'pypi', name: 'pynacl' }, weeklyDownloads: 30_000_000 }, now, index)
    expect(wide.find(s => s.kind === 'typosquat')).toMatchObject({ state: 'absent' })
    expect(wide.find(s => s.kind === 'typosquat')?.evidence).toContain('resembles pyyaml')
    const tiny = buildSignals({ ...base, ref: { ecosystem: 'pypi', name: 'pyyamI' }, weeklyDownloads: 40 }, now, index)
    expect(tiny.find(s => s.kind === 'typosquat')).toMatchObject({ state: 'present', imitates: 'pyyaml' })
  })
})
