import { describe, expect, test } from 'vitest'
import { popularNpm } from '../../src/plugin/core/data/popular-npm'
import { popularPypi } from '../../src/plugin/core/data/popular-pypi'
import type { PackageCheck, PackageFacts } from '../../src/plugin/core/model'
import { evidenceLines } from '../../src/plugin/core/score/evidence'
import { scorePackage } from '../../src/plugin/core/score/tier'
import { buildTyposquatIndex, isPopular, type TyposquatIndex } from '../../src/plugin/core/score/typosquat'
import { loadAdversarial, NOW } from './adversarial'
import { loadBenign } from './benign'

const indexes = {
  npm: buildTyposquatIndex(popularNpm, 'npm'),
  pypi: buildTyposquatIndex(popularPypi, 'pypi'),
}

const check = (facts: PackageFacts, idx: TyposquatIndex = indexes[facts.ref.ecosystem]): PackageCheck => scorePackage(facts, NOW, idx)
const line = (c: PackageCheck): string => `${c.ref.ecosystem}:${c.ref.name}: ${evidenceLines(c.signals).join('; ')}`

const adversarial = await loadAdversarial()
const benign = await loadBenign()

describe('adversarial corpus (SC-001)', () => {
  test.each(adversarial.map(a => [a.label, a] as const))('%s', (_, a) => {
    const c = check(a.facts)
    expect(['refuse', 'hold']).toContain(c.tier)
    expect(c.tier).toBe(a.expect)
    expect(c.pinnedTo).toBeUndefined()
    if (a.alternative) expect(c.alternative).toBe(a.alternative)
    expect(evidenceLines(c.signals).length).toBeGreaterThan(0)
  })
})

describe('benign corpus (SC-002 CI subset)', () => {
  const checks = benign.map(f => check(f))
  const held = checks.filter(c => c.tier === 'hold')
  const pinned = checks.filter(c => c.pinnedTo)

  test('covers the 50 + 50 recorded packages and the named set', () => {
    expect(benign.length).toBe(108)
  })

  test('zero refusals', () => {
    expect(checks.filter(c => c.tier === 'refuse').map(line)).toEqual([])
  })

  test('fresh releases of popular packages are pinned, not held (FR-035)', () => {
    console.info(
      `benign: ${pinned.length} pinned, ${held.length} held of ${checks.length}\n` +
        [...pinned.map(c => `PIN  ${line(c)}`), ...held.map(c => `HOLD ${line(c)}`)].join('\n'),
    )
    for (const c of pinned) {
      expect(c).toMatchObject({ tier: 'pass', decidedBy: 'cooldown' })
      expect(isPopular(indexes[c.ref.ecosystem], c.ref.name)).toBe(true)
    }
    expect(pinned.length).toBeGreaterThan(0)
  })

  test('remaining holds come only from a fresh release that could not be pinned', () => {
    const otherReasons = held.flatMap(c =>
      c.signals.filter(s => s.state === 'present' && s.kind !== 'exists' && s.kind !== 'versionAge').map(s => `${c.ref.name}: ${s.kind}`),
    )
    expect(otherReasons).toEqual([])
    expect(held.map(line)).toEqual([])
  })

  test('no benign package has a malware signal, present or unknown', () => {
    expect(checks.filter(c => c.signals.some(s => s.kind === 'malware' && s.state !== 'absent')).map(c => c.ref.name)).toEqual([])
  })

  test('no benign package is refused even when the popular list omits it (leave-one-out)', () => {
    const refused = benign.filter(f => {
      const list = (f.ref.ecosystem === 'npm' ? popularNpm : popularPypi).filter(n => n !== f.ref.name)
      return check(f, buildTyposquatIndex(list, f.ref.ecosystem)).tier === 'refuse'
    })
    expect(refused.map(f => f.ref.name)).toEqual([])
  })
})
