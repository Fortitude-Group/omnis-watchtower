import { describe, expect, test } from 'vitest'
import { isValidName, key, nameKey, normalise, normalisePypi } from '../../src/plugin/core/model'

describe('normalisation', () => {
  test('PEP 503 folds case and separator runs', () => {
    expect(normalisePypi('Foo__Bar.baz')).toBe('foo-bar-baz')
    expect(normalisePypi('PyYAML')).toBe('pyyaml')
    expect(normalisePypi('a-_.-b')).toBe('a-b')
  })

  test('npm names compare lower-case and trimmed', () => {
    expect(normalise('npm', ' Chalk ')).toBe('chalk')
    expect(normalise('npm', '@Scope/Pkg')).toBe('@scope/pkg')
  })
})

describe('name grammar', () => {
  test.each([
    ['npm', 'chalk', true],
    ['npm', '@scope/pkg', true],
    ['npm', '@types/node', true],
    ['npm', 'a.b_c-d~e', true],
    ['npm', 'x'.repeat(214), true],
    ['npm', 'x'.repeat(215), false],
    ['npm', '', false],
    ['npm', '.hidden', false],
    ['npm', '_under', false],
    ['npm', 'Has Space', false],
    ['npm', '@scope/', false],
    ['npm', 'UPPER', false],
    ['pypi', 'requests', true],
    ['pypi', 'Flask-Login', true],
    ['pypi', 'zope.interface', true],
    ['pypi', 'a', true],
    ['pypi', '-leading', false],
    ['pypi', 'trailing-', false],
    ['pypi', 'has space', false],
    ['pypi', '', false],
  ] as const)('%s %j valid=%s', (eco, name, ok) => {
    expect(isValidName(eco, name)).toBe(ok)
  })
})

describe('keys', () => {
  test('version defaults to latest', () => {
    expect(key({ ecosystem: 'npm', name: 'chalk' })).toBe('npm:chalk@latest')
    expect(key({ ecosystem: 'pypi', name: 'requests', version: '2.32.3' })).toBe('pypi:requests@2.32.3')
    expect(nameKey({ ecosystem: 'npm', name: '@a/b' })).toBe('npm:@a/b')
  })
})
