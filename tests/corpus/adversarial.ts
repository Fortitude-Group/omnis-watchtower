// Adversarial corpus (SC-001): every entry must be refused or held.

import { emptyConfig } from '../../src/plugin/adapters/project-config'
import type { PackageFacts } from '../../src/plugin/core/model'
import { gather, versionedNpm } from './gather'

export const NOW = Date.parse('2026-10-13T00:00:00Z')
const DAY = 86_400_000
const iso = (ms: number): string => new Date(ms).toISOString()

export type CorpusEntry = { label: string; facts: PackageFacts; expect: 'refuse' | 'hold'; alternative?: string }

// Cases the recordings cannot express (a two-day-old package, an OSV outage) are facts directly.
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

export const loadAdversarial = async (): Promise<CorpusEntry[]> => {
  const [utilz, crossenv, reqeusts, ctx] = await gather([
    { ecosystem: 'npm', name: 'react-dom-utilz' },
    { ecosystem: 'npm', name: 'crossenv' },
    { ecosystem: 'pypi', name: 'reqeusts' },
    { ecosystem: 'pypi', name: 'ctx' },
  ])
  const [chalkHijack] = await gather([{ ecosystem: 'npm', name: 'chalk', version: '5.6.1' }], emptyConfig(), versionedNpm('chalk', '5.6.1'))
  const [zodFresh] = await gather([{ ecosystem: 'npm', name: 'zod', version: '4.6.7' }], emptyConfig(), versionedNpm('zod', '4.6.7'))
  const confusion = emptyConfig()
  confusion.allowlist = ['chalk']
  confusion.npm.scopes['@acme'] = 'https://npm.acme.internal/'
  const [twin, unanswered] = await gather([{ ecosystem: 'npm', name: 'chalk' }, { ecosystem: 'npm', name: '@acme/widgets' }], confusion)

  return [
    { label: 'invented npm name (404)', facts: utilz!, expect: 'refuse' },
    { label: 'crossenv: GHSA malware, CWE-506', facts: crossenv!, expect: 'refuse' },
    { label: 'reqeusts: PyPI typosquat of requests (404)', facts: reqeusts!, expect: 'refuse', alternative: 'requests' },
    { label: 'ctx: malware caught by summary', facts: ctx!, expect: 'refuse' },
    { label: 'chalk@5.6.1 requested explicitly: hijacked release (MAL- advisory)', facts: chalkHijack!, expect: 'refuse' },
    { label: 'zod@4.6.7 requested explicitly, 7 hours old: held, never pinned (US1-10)', facts: zodFresh!, expect: 'hold' },
    { label: 'dependency confusion: private name also served publicly', facts: twin!, expect: 'refuse' },
    { label: 'dependency confusion check failed: held', facts: unanswered!, expect: 'hold' },
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
    { label: 'malware database unreachable', facts: synthetic('plain-utility-lib', { osv: 'unknown' }), expect: 'hold' },
    { label: 'crossenv while the registry lookup fails: malware still refuses', facts: { ...crossenv!, exists: 'unknown' }, expect: 'refuse' },
    { label: 'registry and malware database both unreachable', facts: synthetic('quiet-lib', { exists: 'unknown', osv: 'unknown' }), expect: 'hold' },
    {
      label: 'popular package from a registry named on the command line',
      facts: { ...synthetic('chalk', {}), commandLineRegistry: 'https://attacker.example' },
      expect: 'refuse',
    },
    {
      label: 'npm typosquat of lodash with low adoption',
      facts: synthetic('lodahs', { weeklyDownloads: 14, maintainerCount: 1, repository: null }),
      expect: 'refuse',
      alternative: 'lodash',
    },
  ]
}
