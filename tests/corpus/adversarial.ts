// Adversarial corpus (SC-001): every entry must be refused or held.

import type { PackageFacts } from '../../src/plugin/core/model'
import { factsFromFixtures } from './facts-from-fixtures'

export const NOW = Date.parse('2026-10-13T00:00:00Z')
const DAY = 86_400_000
const iso = (ms: number): string => new Date(ms).toISOString()

export type CorpusEntry = { label: string; facts: PackageFacts; expect: 'refuse' | 'hold'; alternative?: string }

const synthetic = (name: string, over: Partial<PackageFacts>): PackageFacts => ({
  ref: { ecosystem: 'npm', name },
  exists: true,
  resolvedVersion: '1.0.0',
  versions: [{ version: '1.0.0', publishedAt: iso(NOW - 400 * DAY) }],
  installScripts: [],
  sdistOnly: false,
  weeklyDownloads: 25_000,
  maintainerCount: 2,
  repository: `git+https://github.com/example/${name}.git`,
  osv: [],
  ...over,
})

export const adversarial: CorpusEntry[] = [
  { label: 'invented npm name (404)', facts: factsFromFixtures('npm', 'react-dom-utilz'), expect: 'refuse' },
  { label: 'crossenv: GHSA malware, CWE-506', facts: factsFromFixtures('npm', 'crossenv'), expect: 'refuse' },
  { label: 'reqeusts: PyPI typosquat of requests (404)', facts: factsFromFixtures('pypi', 'reqeusts'), expect: 'refuse', alternative: 'requests' },
  { label: 'ctx: malware caught by summary', facts: factsFromFixtures('pypi', 'ctx'), expect: 'refuse' },
  {
    label: 'two-day-old package with postinstall',
    facts: synthetic('fresh-helper-kit', {
      versions: [{ version: '1.0.0', publishedAt: iso(NOW - 2 * DAY) }],
      installScripts: ['postinstall'],
      weeklyDownloads: 40,
      maintainerCount: 1,
    }),
    expect: 'hold',
  },
  {
    label: 'dependency confusion: public package shadows a private name',
    facts: synthetic('acme-internal-auth', { shadowsPrivate: true, weeklyDownloads: 3 }),
    expect: 'refuse',
  },
  { label: 'malware database unreachable', facts: synthetic('plain-utility-lib', { osv: 'unknown' }), expect: 'hold' },
  {
    label: 'npm typosquat of lodash with low adoption',
    facts: synthetic('lodahs', { weeklyDownloads: 14, maintainerCount: 1, repository: null }),
    expect: 'refuse',
    alternative: 'lodash',
  },
  {
    label: 'hijacked chalk release 5.6.1 (MAL- advisory)',
    facts: { ...factsFromFixtures('npm', 'chalk'), resolvedVersion: '5.6.1' },
    expect: 'refuse',
  },
]
