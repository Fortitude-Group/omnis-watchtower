import { describe, expect, test } from 'vitest'
import type { PackageRef, Signal, SignalKind, SignalState } from '../../../src/plugin/core/model'
import { alternativeFor, evidenceLines } from '../../../src/plugin/core/score/evidence'
import { WEIGHTS } from '../../../src/plugin/core/score/signals'
import { decide, decideCommand, isAllowed, matchesAllowlist, scorePackage, tierFor, VERDICT_TTL_MS, type Cooldown } from '../../../src/plugin/core/score/tier'
import { buildTyposquatIndex } from '../../../src/plugin/core/score/typosquat'
import type { PackageFacts } from '../../../src/plugin/core/model'

const NOW = Date.parse('2026-10-13T00:00:00Z')
const ref: PackageRef = { ecosystem: 'npm', name: 'pkg' }

const s = (kind: SignalKind, state: SignalState, imitates?: string): Signal => ({
  kind,
  state,
  weight: WEIGHTS[kind],
  evidence: `${kind} ${state}`,
  ...(imitates ? { imitates } : {}),
})

// A clean baseline; individual tests override single kinds.
const base = (...over: Signal[]): Signal[] => {
  const kinds: SignalKind[] = [
    'exists', 'malware', 'dependencyConfusion', 'packageAge', 'versionAge', 'typosquat',
    'installScripts', 'sdistOnly', 'lowAdoption', 'singleMaintainerLowAdoption', 'noRepository',
  ]
  return kinds.map(k => over.find(o => o.kind === k) ?? s(k, k === 'exists' ? 'present' : 'absent')).concat(
    over.filter(o => !kinds.includes(o.kind)),
  )
}

describe('tierFor, rules in order', () => {
  test('8. clean → pass', () => expect(tierFor(base())).toBe('pass'))

  test('1. override wins over everything', () => {
    const bad = base(s('malware', 'present'), s('exists', 'absent'))
    expect(tierFor(bad, { action: 'allow' })).toBe('pass')
    expect(tierFor(base(), { action: 'block' })).toBe('refuse')
    expect(tierFor(base(s('privateRegistry', 'present')), { action: 'block' })).toBe('refuse')
  })

  test('2. private registry or allowlist → pass, ahead of hard signals', () => {
    expect(tierFor(base(s('privateRegistry', 'present'), s('exists', 'unknown')))).toBe('pass')
    expect(tierFor(base(s('exists', 'absent')), undefined, true)).toBe('pass')
  })

  test('2. a private name the public registry also serves is refused; an unanswered check holds', () => {
    expect(tierFor(base(s('privateRegistry', 'present'), s('exists', 'unknown'), s('dependencyConfusion', 'present')))).toBe('refuse')
    expect(tierFor(base(s('privateRegistry', 'present'), s('exists', 'unknown'), s('dependencyConfusion', 'unknown')))).toBe('hold')
    expect(tierFor(base(s('dependencyConfusion', 'unknown')), undefined, true)).toBe('hold')
  })

  test('dependency-confusion check unknown on a public package → hold', () => {
    expect(tierFor(base(s('dependencyConfusion', 'unknown')))).toBe('hold')
  })

  test('3. registry unreachable → unverified', () => {
    expect(tierFor(base(s('exists', 'unknown')))).toBe('unverified')
    expect(tierFor(base(s('exists', 'unknown'), s('malware', 'unknown')))).toBe('unverified')
  })

  test('4. hard signals → refuse', () => {
    expect(tierFor(base(s('exists', 'absent')))).toBe('refuse')
    expect(tierFor(base(s('malware', 'present')))).toBe('refuse')
    expect(tierFor(base(s('dependencyConfusion', 'present')))).toBe('refuse')
  })

  test('5. typosquat with low or unknown adoption → refuse', () => {
    expect(tierFor(base(s('typosquat', 'present', 'lodash'), s('lowAdoption', 'present')))).toBe('refuse')
    expect(tierFor(base(s('typosquat', 'present', 'lodash'), s('lowAdoption', 'unknown')))).toBe('refuse')
    expect(tierFor(base(s('typosquat', 'present', 'lodash')))).toBe('hold')
  })

  test('6. malware unknown → hold (cannot pass)', () => {
    expect(tierFor(base(s('malware', 'unknown')))).toBe('hold')
  })

  test('7. any strong → hold; two weak → hold; one weak → pass', () => {
    expect(tierFor(base(s('packageAge', 'present')))).toBe('hold')
    expect(tierFor(base(s('versionAge', 'present')))).toBe('hold')
    expect(tierFor(base(s('installScripts', 'present')))).toBe('pass')
    expect(tierFor(base(s('installScripts', 'present'), s('noRepository', 'present')))).toBe('hold')
    expect(tierFor(base(s('lowAdoption', 'present'), s('singleMaintainerLowAdoption', 'present')))).toBe('hold')
  })

  test('unknown weak signals never decide alone', () => {
    expect(tierFor(base(s('lowAdoption', 'unknown'), s('noRepository', 'unknown'), s('sdistOnly', 'unknown')))).toBe('pass')
  })
})

describe('decide', () => {
  test('stamps time, cache horizon and decidedBy', () => {
    const c = decide({ ref, signals: base(), now: NOW })
    expect(c).toMatchObject({ tier: 'pass', decidedBy: 'fast-score', decidedAt: NOW, expiresAt: NOW + VERDICT_TTL_MS })
    expect(isAllowed(c)).toBe(true)
  })

  test('override is recorded as decidedBy override', () => {
    const c = decide({ ref, signals: base(s('malware', 'present')), now: NOW, override: { action: 'allow' } })
    expect(c).toMatchObject({ tier: 'pass', decidedBy: 'override' })
  })

  test('allowlist adds a privateRegistry signal and passes', () => {
    const c = decide({ ref, signals: base(s('exists', 'absent')), now: NOW, allowlisted: true })
    expect(c.tier).toBe('pass')
    expect(c.signals.find(x => x.kind === 'privateRegistry')?.state).toBe('present')
  })

  test('refusal carries the imitated name as the alternative', () => {
    const c = decide({ ref, signals: base(s('typosquat', 'present', 'lodash'), s('lowAdoption', 'present')), now: NOW })
    expect(c).toMatchObject({ tier: 'refuse', alternative: 'lodash' })
    expect(isAllowed(c)).toBe(false)
  })

  test('9. warn-only keeps the tier but allows the call', () => {
    const c = decide({ ref, signals: base(s('malware', 'present')), now: NOW, mode: 'warn-only' })
    expect(c).toMatchObject({ tier: 'refuse', decidedBy: 'warn-only' })
    expect(isAllowed(c)).toBe(true)
    const h = decide({ ref, signals: base(s('packageAge', 'present')), now: NOW, mode: 'warn-only' })
    expect(h).toMatchObject({ tier: 'hold', decidedBy: 'warn-only' })
    expect(decide({ ref, signals: base(), now: NOW, mode: 'warn-only' }).decidedBy).toBe('fast-score')
  })

  test('warn-only does not soften a developer block', () => {
    const c = decide({ ref, signals: base(), now: NOW, mode: 'warn-only', override: { action: 'block' } })
    expect(isAllowed(c)).toBe(false)
  })

  test('unverified is allowed', () => {
    expect(isAllowed(decide({ ref, signals: base(s('exists', 'unknown')), now: NOW }))).toBe(true)
  })
})

describe('decideCommand', () => {
  const pass = decide({ ref, signals: base(), now: NOW })
  const hold = decide({ ref: { ...ref, name: 'young' }, signals: base(s('packageAge', 'present')), now: NOW })
  const refuse = decide({ ref: { ...ref, name: 'gone' }, signals: base(s('exists', 'absent')), now: NOW })
  const unverified = decide({ ref: { ...ref, name: 'u' }, signals: base(s('exists', 'unknown')), now: NOW })

  test('all pass → allow', () => expect(decideCommand([pass, unverified])).toEqual({ allow: true, blocking: [] }))
  test('any hold → refuse the command', () => expect(decideCommand([pass, hold])).toEqual({ allow: false, blocking: [hold] }))
  test('lists every blocking package', () => expect(decideCommand([refuse, pass, hold]).blocking).toEqual([refuse, hold]))
  test('empty command is allowed', () => expect(decideCommand([]).allow).toBe(true))
})

describe('evidence', () => {
  test('one line per contributing signal: present ones, and blocking unknowns', () => {
    const lines = evidenceLines(base(s('packageAge', 'present'), s('malware', 'unknown'), s('lowAdoption', 'unknown')))
    expect(lines).toEqual(['malware unknown', 'packageAge present'])
  })
  test('a missing package is evidence; an existing one is not', () => {
    expect(evidenceLines(base(s('exists', 'absent')))).toEqual(['exists absent'])
    expect(evidenceLines(base(s('exists', 'unknown')))).toEqual(['exists unknown'])
    expect(evidenceLines(base())).toEqual([])
  })
  test('alternative comes from imitates', () => {
    expect(alternativeFor(base(s('typosquat', 'present', 'requests')))).toBe('requests')
    expect(alternativeFor(base())).toBeUndefined()
  })
})

describe('matchesAllowlist', () => {
  test('comma-separated globs', () => {
    expect(matchesAllowlist('@acme/ui', '@acme/*, acme-*')).toBe(true)
    expect(matchesAllowlist('acme-tools', '@acme/*, acme-*')).toBe(true)
    expect(matchesAllowlist('lodash', '@acme/*, acme-*')).toBe(false)
    expect(matchesAllowlist('lodash', '')).toBe(false)
    expect(matchesAllowlist('a.b', ['a.b'])).toBe(true)
    expect(matchesAllowlist('axb', ['a.b'])).toBe(false)
  })
})

describe('6a. cooldown pin (FR-035)', () => {
  const fresh = (...over: Signal[]) => base(s('versionAge', 'present'), ...over)
  const cd = (over: Partial<Cooldown> = {}): Cooldown => ({ popular: true, requested: false, latest: '2.1.0', pin: '2.0.3', ...over })

  test('popular, unrequested, only a fresh release → pass pinned', () => {
    const c = decide({ ref, signals: fresh(), now: NOW, cooldown: cd() })
    expect(c).toMatchObject({ tier: 'pass', pinnedTo: '2.0.3', decidedBy: 'cooldown' })
    expect(evidenceLines(c.signals)).toEqual(['Latest release 2.1.0 is under 72 hours old; pinned to 2.0.3'])
    expect(isAllowed(c)).toBe(true)
  })

  test('each failed condition falls through to hold', () => {
    expect(tierFor(fresh(), undefined, false, cd({ popular: false }))).toBe('hold')
    expect(tierFor(fresh(), undefined, false, cd({ requested: true }))).toBe('hold')
    expect(tierFor(fresh(), undefined, false, cd({ pin: undefined }))).toBe('hold')
    expect(tierFor(fresh(s('packageAge', 'present')), undefined, false, cd())).toBe('hold')
    expect(tierFor(fresh(s('typosquat', 'present', 'lodash')), undefined, false, cd())).toBe('hold')
    expect(tierFor(fresh(s('installScripts', 'present')), undefined, false, cd())).toBe('hold')
    expect(tierFor(fresh(s('malware', 'unknown')), undefined, false, cd())).toBe('hold')
    expect(tierFor(fresh(), undefined, false, undefined)).toBe('hold')
  })

  test('hard and typosquat rules still come first', () => {
    expect(tierFor(fresh(s('malware', 'present')), undefined, false, cd())).toBe('refuse')
  })

  test('without a fresh release there is nothing to pin', () => {
    const c = decide({ ref, signals: base(), now: NOW, cooldown: cd() })
    expect(c.pinnedTo).toBeUndefined()
    expect(c.decidedBy).toBe('fast-score')
  })

  test('scorePackage wires facts, popularity and the request', () => {
    const H = 3_600_000
    const f: PackageFacts = {
      ref: { ecosystem: 'npm', name: 'zod' },
      exists: true,
      resolvedVersion: '4.6.7',
      versions: [
        { version: '4.6.6', publishedAt: new Date(NOW - 200 * H).toISOString() },
        { version: '4.6.7', publishedAt: new Date(NOW - 7 * H).toISOString() },
      ],
      installScripts: [],
      sdistOnly: false,
      weeklyDownloads: 1e7,
      maintainerCount: 2,
      repository: 'https://github.com/colinhacks/zod',
      osv: [],
    }
    const idx = buildTyposquatIndex(['zod', 'react'])
    expect(scorePackage(f, NOW, idx)).toMatchObject({ tier: 'pass', pinnedTo: '4.6.6', decidedBy: 'cooldown' })
    expect(scorePackage({ ...f, ref: { ...f.ref, version: '4.6.7' } }, NOW, idx).tier).toBe('hold')
    // off the list: popular by downloads (100k+/week) still pins; a little-used package holds
    expect(scorePackage(f, NOW, buildTyposquatIndex(['react']))).toMatchObject({ tier: 'pass', pinnedTo: '4.6.6' })
    expect(scorePackage({ ...f, weeklyDownloads: 99_999 }, NOW, buildTyposquatIndex(['react'])).tier).toBe('hold')
  })
})
