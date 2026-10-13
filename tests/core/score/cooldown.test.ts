import { describe, expect, test } from 'vitest'
import type { PackageFacts, VersionInfo } from '../../../src/plugin/core/model'
import { compareVersions, cooldownPin, isPrerelease, versionRequested } from '../../../src/plugin/core/score/cooldown'

const NOW = Date.parse('2026-10-13T00:00:00Z')
const HOUR = 3_600_000
const at = (hoursAgo: number): string => new Date(NOW - hoursAgo * HOUR).toISOString()

const facts = (versions: VersionInfo[] | 'unknown', latest: string, ecosystem: 'npm' | 'pypi' = 'npm'): PackageFacts => ({
  ref: { ecosystem, name: 'pkg' },
  exists: true,
  resolvedVersion: latest,
  versions,
  installScripts: [],
  sdistOnly: false,
  weeklyDownloads: 1e6,
  maintainerCount: 3,
  repository: 'https://github.com/x/pkg',
  osv: [],
})

describe('isPrerelease', () => {
  test.each([
    ['npm', '1.0.0-beta.1', true],
    ['npm', '3.0.0-rc.0', true],
    ['npm', '1.0.0+build.5', false],
    ['npm', '1.0.0', false],
    ['pypi', '2.0.0rc1', true],
    ['pypi', '1.0a2', true],
    ['pypi', '1.0b1', true],
    ['pypi', '1.0.dev3', true],
    ['pypi', '1.0.post1', false],
    ['pypi', '1!2.0', false],
    ['pypi', '0.2.2.1', false],
  ] as const)('%s %s → %s', (eco, v, want) => expect(isPrerelease(eco, v)).toBe(want))
})

describe('compareVersions', () => {
  test('numeric, not lexical', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('2.0', '2.0.0')).toBe(0)
    expect(compareVersions('1.43.112', '1.43.113')).toBeLessThan(0)
  })
})

describe('versionRequested', () => {
  test('absent or "latest" is not a request', () => {
    expect(versionRequested({ ecosystem: 'npm', name: 'x' })).toBe(false)
    expect(versionRequested({ ecosystem: 'npm', name: 'x', version: 'latest' })).toBe(false)
    expect(versionRequested({ ecosystem: 'npm', name: 'x', version: '1.2.3' })).toBe(true)
  })
})

describe('cooldownPin', () => {
  test('newest release at least 72 h old', () => {
    const v = [
      { version: '1.0.0', publishedAt: at(5000) },
      { version: '1.1.0', publishedAt: at(100) },
      { version: '1.2.0', publishedAt: at(5) },
    ]
    expect(cooldownPin(facts(v, '1.2.0'), NOW)).toBe('1.1.0')
  })
  test('exactly 72 h qualifies; 71 h does not', () => {
    expect(cooldownPin(facts([{ version: '1.0.0', publishedAt: at(72) }, { version: '1.1.0', publishedAt: at(1) }], '1.1.0'), NOW)).toBe('1.0.0')
    expect(cooldownPin(facts([{ version: '1.0.0', publishedAt: at(71) }, { version: '1.1.0', publishedAt: at(1) }], '1.1.0'), NOW)).toBeUndefined()
  })
  test('skips pre-releases', () => {
    const v = [
      { version: '1.0.0', publishedAt: at(5000) },
      { version: '2.0.0-rc.1', publishedAt: at(200) },
      { version: '2.0.0', publishedAt: at(2) },
    ]
    expect(cooldownPin(facts(v, '2.0.0'), NOW)).toBe('1.0.0')
    const p = [
      { version: '1.0', publishedAt: at(5000) },
      { version: '2.0rc1', publishedAt: at(200) },
      { version: '2.0', publishedAt: at(2) },
    ]
    expect(cooldownPin(facts(p, '2.0', 'pypi'), NOW)).toBe('1.0')
  })
  test('highest by version, not by date: a fresh-ish backport does not win', () => {
    const v = [
      { version: '4.1.0', publishedAt: at(900) },
      { version: '3.9.9', publishedAt: at(80) },
      { version: '4.2.0', publishedAt: at(3) },
    ]
    expect(cooldownPin(facts(v, '4.2.0'), NOW)).toBe('4.1.0')
  })
  test('never pins above the latest dist-tag', () => {
    const v = [
      { version: '1.0.0', publishedAt: at(900) },
      { version: '5.0.0', publishedAt: at(400) },
      { version: '1.1.0', publishedAt: at(3) },
    ]
    expect(cooldownPin(facts(v, '1.1.0'), NOW)).toBe('1.0.0')
  })
  test('undefined when there is no older release or versions are unknown', () => {
    expect(cooldownPin(facts([{ version: '1.0.0', publishedAt: at(3) }], '1.0.0'), NOW)).toBeUndefined()
    expect(cooldownPin(facts('unknown', '1.0.0'), NOW)).toBeUndefined()
    expect(cooldownPin(facts([{ version: '0.9.0' }, { version: '1.0.0', publishedAt: at(3) }], '1.0.0'), NOW)).toBeUndefined()
  })
})
