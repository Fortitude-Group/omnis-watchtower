import { describe, expect, test } from 'vitest'
import type { PackageFacts } from '../../src/plugin/core/model'
import { evidenceLines } from '../../src/plugin/core/score/evidence'
import { buildSignals } from '../../src/plugin/core/score/signals'
import { decide } from '../../src/plugin/core/score/tier'
import { buildTyposquatIndex, type TyposquatIndex } from '../../src/plugin/core/score/typosquat'
import { adversarial, NOW } from './adversarial'
import { benign, corpusPopularNpm, corpusPopularPypi } from './benign'

const indexes = {
  npm: buildTyposquatIndex(corpusPopularNpm, 'npm'),
  pypi: buildTyposquatIndex(corpusPopularPypi, 'pypi'),
}

const check = (facts: PackageFacts, idx: TyposquatIndex = indexes[facts.ref.ecosystem]) =>
  decide({ ref: facts.ref, signals: buildSignals(facts, NOW, idx), now: NOW })

describe('adversarial corpus (SC-001)', () => {
  test.each(adversarial.map(a => [a.label, a] as const))('%s', (_, a) => {
    const c = check(a.facts)
    expect(['refuse', 'hold']).toContain(c.tier)
    expect(c.tier).toBe(a.expect)
    if (a.alternative) expect(c.alternative).toBe(a.alternative)
    expect(evidenceLines(c.signals).length).toBeGreaterThan(0)
  })
})

describe('benign corpus (SC-002 CI subset)', () => {
  const checks = benign.map(f => check(f))

  test('covers the 50 + 50 recorded packages and the named set', () => {
    expect(benign.length).toBe(108)
  })

  test('zero refusals', () => {
    const refused = checks.filter(c => c.tier === 'refuse').map(c => `${c.ref.ecosystem}:${c.ref.name}: ${evidenceLines(c.signals).join('; ')}`)
    expect(refused).toEqual([])
  })

  // Popular packages release often, so the 72-hour version-age rule (strong, data-model.md) holds
  // a handful at any moment. Those holds go to the Sentinel; nothing else may hold a benign package.
  test('benign holds come only from a fresh release', () => {
    const held = checks.filter(c => c.tier === 'hold')
    console.info(
      `benign holds: ${held.length}/${checks.length}\n` +
        held.map(c => `${c.ref.ecosystem}:${c.ref.name}: ${evidenceLines(c.signals).join('; ')}`).join('\n'),
    )
    const otherReasons = held.flatMap(c =>
      c.signals.filter(s => s.state === 'present' && s.kind !== 'exists' && s.kind !== 'versionAge').map(s => `${c.ref.name}: ${s.kind}`),
    )
    expect(otherReasons).toEqual([])
    expect(held.length).toBeLessThanOrEqual(15)
  })

  test('no benign package has a malware signal, present or unknown', () => {
    expect(checks.filter(c => c.signals.some(s => s.kind === 'malware' && s.state !== 'absent')).map(c => c.ref.name)).toEqual([])
  })

  test('no benign package is refused even when the popular list omits it (leave-one-out)', () => {
    const refused = benign.filter(f => {
      const list = (f.ref.ecosystem === 'npm' ? corpusPopularNpm : corpusPopularPypi).filter(n => n !== f.ref.name)
      return check(f, buildTyposquatIndex(list, f.ref.ecosystem)).tier === 'refuse'
    })
    expect(refused.map(f => f.ref.name)).toEqual([])
  })
})
