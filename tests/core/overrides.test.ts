import { describe, expect, it } from 'vitest'
import type { Override } from '../../src/plugin/core/model'
import { matchOverride, parseSpec } from '../../src/plugin/core/overrides'

const ov = (key: string, action: 'allow' | 'block', at: number, scope: 'session' | 'permanent' = 'session'): Override => ({
  key,
  action,
  scope,
  at,
  via: 'composer'
})
const rec = (...os: Override[]) => Object.fromEntries(os.map((o) => [o.key, o]))

describe('parseSpec', () => {
  it('parses eco:name and eco:name@ver', () => {
    expect(parseSpec('npm:left-pad')).toMatchObject({ ok: true, ecosystem: 'npm', name: 'left-pad', key: 'npm:left-pad' })
    expect(parseSpec('pypi:Requests@2.31.0')).toMatchObject({
      ok: true,
      name: 'requests',
      version: '2.31.0',
      key: 'pypi:requests@2.31.0'
    })
  })

  it('handles npm scopes', () => {
    expect(parseSpec('npm:@acme/tool')).toMatchObject({ ok: true, name: '@acme/tool', key: 'npm:@acme/tool' })
    expect(parseSpec('npm:@acme/tool@1.2.3')).toMatchObject({ ok: true, name: '@acme/tool', version: '1.2.3' })
  })

  it('accepts a bare name only with a single-ecosystem hint', () => {
    expect(parseSpec('chalk', ['npm'])).toMatchObject({ ok: true, ecosystem: 'npm', name: 'chalk' })
    expect(parseSpec('chalk')).toMatchObject({ ok: false, error: 'ambiguous' })
    expect(parseSpec('chalk', ['npm', 'pypi'])).toMatchObject({ ok: false, error: 'ambiguous' })
  })

  it('rejects unknown ecosystems and empty specs', () => {
    expect(parseSpec('gem:rails')).toMatchObject({ ok: false, error: 'invalid' })
    expect(parseSpec('')).toMatchObject({ ok: false, error: 'invalid' })
    expect(parseSpec('npm:')).toMatchObject({ ok: false, error: 'invalid' })
    expect(parseSpec('npm:foo@')).toMatchObject({ ok: false, error: 'invalid' })
  })
})

describe('matchOverride', () => {
  const ref = { ecosystem: 'npm' as const, name: 'foo', version: '1.0.0' }

  it('returns undefined when nothing matches', () => {
    expect(matchOverride(ref, {}, {})).toBeUndefined()
    expect(matchOverride(ref, rec(ov('npm:bar', 'block', 1)), {})).toBeUndefined()
  })

  it('name-only overrides match every version; version-specific only theirs', () => {
    const nameOnly = rec(ov('npm:foo', 'allow', 1))
    expect(matchOverride(ref, nameOnly, {})?.action).toBe('allow')
    expect(matchOverride({ ...ref, version: '9.9.9' }, nameOnly, {})?.action).toBe('allow')
    expect(matchOverride({ ecosystem: 'npm', name: 'foo' }, nameOnly, {})?.action).toBe('allow')
    const pinned = rec(ov('npm:foo@1.0.0', 'block', 1))
    expect(matchOverride(ref, pinned, {})?.action).toBe('block')
    expect(matchOverride({ ...ref, version: '2.0.0' }, pinned, {})).toBeUndefined()
    expect(matchOverride({ ecosystem: 'npm', name: 'foo' }, pinned, {})).toBeUndefined()
  })

  it('block beats allow whatever the scope or recency', () => {
    const session = rec(ov('npm:foo', 'allow', 100))
    const permanent = rec(ov('npm:foo', 'block', 1, 'permanent'))
    expect(matchOverride(ref, session, permanent)?.action).toBe('block')
    expect(matchOverride(ref, permanent, session)?.action).toBe('block')
    expect(matchOverride(ref, rec(ov('npm:foo@1.0.0', 'allow', 100), ov('npm:foo', 'block', 1)), {})?.action).toBe('block')
  })

  it('within the same action the most recent wins', () => {
    const a = ov('npm:foo', 'allow', 5)
    const b = ov('npm:foo@1.0.0', 'allow', 9, 'permanent')
    expect(matchOverride(ref, rec(a), rec(b))).toBe(b)
    expect(matchOverride(ref, rec(ov('npm:foo', 'allow', 20)), rec(b))?.at).toBe(20)
  })
})
