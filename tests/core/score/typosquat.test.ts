import { describe, expect, test } from 'vitest'
import { buildTyposquatIndex, distance, findTyposquat, fold } from '../../../src/plugin/core/score/typosquat'
import { benignNpm, benignPypi } from '../../fixtures/http/benign-names'

const npm = buildTyposquatIndex(['react', 'lodash', 'express', 'chalk', 'commander', 'modern-normalize', 'ms', 'vue'])
const pypi = buildTyposquatIndex(['requests', 'numpy', 'PyYAML', 'typing_extensions', 'django'], 'pypi')

describe('distance', () => {
  test('substitution, insertion, deletion', () => {
    expect(distance('lodash', 'lodasx', 2)).toBe(1)
    expect(distance('lodash', 'lodashh', 2)).toBe(1)
    expect(distance('lodash', 'odash', 2)).toBe(1)
  })
  test('transposition counts as one edit', () => expect(distance('reqeusts', 'requests', 2)).toBe(1))
  test('early exit reports max + 1', () => {
    expect(distance('abcdefgh', 'zyxwvuts', 2)).toBe(3)
    expect(distance('a', 'abcdef', 2)).toBe(3)
  })
  test('identical is zero', () => expect(distance('chalk', 'chalk', 1)).toBe(0))
})

describe('fold', () => {
  test('homoglyphs and separators', () => {
    expect(fold('rnodern')).toBe('modem')
    expect(fold('l0dash')).toBe('lodash')
    expect(fold('1odash')).toBe('lodash')
    expect(fold('vvebpack')).toBe('webpack')
    expect(fold('py-yaml')).toBe(fold('py_yaml'))
    expect(fold('Py.Yaml')).toBe('pyyaml')
  })
})

describe('findTyposquat', () => {
  test('edit distance 1 and 2 on longer names', () => {
    expect(findTyposquat(npm, 'lodahs')).toEqual({ imitates: 'lodash', distance: 1 })
    expect(findTyposquat(npm, 'expresss')?.imitates).toBe('express')
    expect(findTyposquat(npm, 'commandre')?.imitates).toBe('commander')
    expect(findTyposquat(npm, 'comandre')).toEqual({ imitates: 'commander', distance: 2 })
  })
  test('names of length 5 or less allow only one edit', () => {
    expect(findTyposquat(npm, 'raect')?.imitates).toBe('react')
    expect(findTyposquat(npm, 'chalx')?.imitates).toBe('chalk')
    expect(findTyposquat(npm, 'cholx')).toBeUndefined()
  })
  test('transposition', () => expect(findTyposquat(pypi, 'reqeusts')).toEqual({ imitates: 'requests', distance: 1 }))
  test('homoglyphs', () => {
    expect(findTyposquat(npm, 'l0dash')?.imitates).toBe('lodash')
    expect(findTyposquat(npm, '1odash')?.imitates).toBe('lodash')
    expect(findTyposquat(npm, 'rnodern-normalize')?.imitates).toBe('modern-normalize')
    expect(findTyposquat(npm, 'expre55')?.imitates).toBe('express')
  })
  test('separator variants', () => {
    expect(findTyposquat(pypi, 'py-yaml')?.imitates).toBe('pyyaml')
    expect(findTyposquat(pypi, 'py_yaml')?.imitates).toBe('pyyaml')
    expect(findTyposquat(npm, 'lo-dash')?.imitates).toBe('lodash')
    expect(findTyposquat(npm, 'modernnormalize')?.imitates).toBe('modern-normalize')
  })
  test('popular names never flag themselves (after normalisation)', () => {
    expect(findTyposquat(npm, 'lodash')).toBeUndefined()
    expect(findTyposquat(npm, 'Chalk')).toBeUndefined()
    expect(findTyposquat(pypi, 'pyyaml')).toBeUndefined()
    expect(findTyposquat(pypi, 'typing-extensions')).toBeUndefined()
    expect(findTyposquat(pypi, 'Typing.Extensions')).toBeUndefined()
  })
  test('short names (3 chars or less) are excluded', () => {
    expect(findTyposquat(npm, 'mss')).toBeUndefined()
    expect(findTyposquat(npm, 'vuu')).toBeUndefined()
    expect(findTyposquat(npm, 'vuex')).toBeUndefined()
  })
  test('unrelated names do not match', () => {
    expect(findTyposquat(npm, 'zustand')).toBeUndefined()
    expect(findTyposquat(pypi, 'flask')).toBeUndefined()
  })
  test('prefers the most popular match', () => {
    const idx = buildTyposquatIndex(['abcdef', 'abcdeg', 'abcdeh'])
    expect(findTyposquat(idx, 'abcdex')?.imitates).toBe('abcdef')
    const rev = buildTyposquatIndex(['abcdeh', 'abcdeg', 'abcdef'])
    expect(findTyposquat(rev, 'abcdex')?.imitates).toBe('abcdeh')
  })
  test('benign recorded names never flag against a list that contains them', () => {
    const n = buildTyposquatIndex(benignNpm)
    const p = buildTyposquatIndex(benignPypi, 'pypi')
    expect(benignNpm.filter(x => findTyposquat(n, x))).toEqual([])
    expect(benignPypi.filter(x => findTyposquat(p, x))).toEqual([])
  })
})

describe('performance', () => {
  // Deterministic pseudo-random names (no Math.random in tests that assert timing).
  let seed = 7
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const word = (): string => {
    const len = 4 + Math.floor(rnd() * 12)
    let s = ''
    for (let i = 0; i < len; i++) s += 'abcdefghijklmnopqrstuvwxyz-'[Math.floor(rnd() * 26.5)]
    return s.replace(/^-+|-+$/g, 'x')
  }
  const names = Array.from({ length: 5_000 }, word)
  const queries = Array.from({ length: 1_000 }, word)

  test('1,000 lookups against 5,000 names take under 200 ms', () => {
    const idx = buildTyposquatIndex(names)
    const t0 = performance.now()
    for (const q of queries) findTyposquat(idx, q)
    expect(performance.now() - t0).toBeLessThan(200)
  })
})
