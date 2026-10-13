import { expect, test } from 'vitest'
import type { PackageCheck } from '../../../src/plugin/core/model'
import {
  commandText,
  heldText,
  investigationFailedText,
  refusedText,
  sentinelRefusedText,
  verdictContext,
} from '../../../src/plugin/core/text/deny-text'

const check = (over: Partial<PackageCheck>): PackageCheck => ({
  ref: { ecosystem: 'npm', name: 'x' },
  tier: 'pass',
  signals: [],
  decidedBy: 'fast-score',
  decidedAt: 0,
  expiresAt: 0,
  ...over,
})

const typosquat = check({
  ref: { ecosystem: 'pypi', name: 'reqeusts' },
  tier: 'refuse',
  alternative: 'requests',
  signals: [
    { kind: 'typosquat', state: 'present', weight: 'strong', evidence: 'Name is one edit away from the popular package requests', imitates: 'requests' },
    { kind: 'lowAdoption', state: 'present', weight: 'weak', evidence: '12 downloads in the last week' },
    { kind: 'installScripts', state: 'absent', weight: 'strong', evidence: 'No install scripts' },
  ],
})

test('refused text', () => {
  expect(refusedText(typosquat)).toMatchInlineSnapshot(`
    "WATCHTOWER REFUSED pypi:reqeusts
    - Name is one edit away from the popular package requests
    - 12 downloads in the last week
    Suggested alternative: requests
    Override (human only): /watchtower allow pypi:reqeusts"
  `)
})

test('refused text lists an unknown hard signal, so "could not check" is visible', () => {
  const c = check({ tier: 'hold', signals: [{ kind: 'malware', state: 'unknown', weight: 'hard', evidence: 'Malware database unreachable' }] })
  expect(heldText(c)).toContain('- Malware database unreachable')
})

test('held text', () => {
  const c = check({
    ref: { ecosystem: 'npm', name: 'left-padx', version: '1.0.0' },
    tier: 'hold',
    signals: [{ kind: 'packageAge', state: 'present', weight: 'strong', evidence: 'First published 2 days ago' }],
  })
  expect(heldText(c)).toMatchInlineSnapshot(`
    "WATCHTOWER HELD npm:left-padx@1.0.0 — the Sentinel is investigating.
    Carry on with other work and retry this exact command later; the verdict will be applied.
    - First published 2 days ago"
  `)
})

test('investigation failure, sentinel refusal and verdict context', () => {
  const ref = { ecosystem: 'npm' as const, name: 'fastapi-auth-kit' }
  expect(investigationFailedText(ref, 'timed out', 'no verdict within 180 s')).toMatchInlineSnapshot(`
    "WATCHTOWER REFUSED npm:fastapi-auth-kit — investigation timed out (no verdict within 180 s).
    Re-investigate: /watchtower recheck npm:fastapi-auth-kit   Override (human only): /watchtower allow npm:fastapi-auth-kit"
  `)
  expect(sentinelRefusedText(ref, ['Obfuscated postinstall downloads a binary'])).toMatchInlineSnapshot(`
    "WATCHTOWER REFUSED npm:fastapi-auth-kit — the Sentinel found it unsafe.
    - Obfuscated postinstall downloads a binary
    Override (human only): /watchtower allow npm:fastapi-auth-kit"
  `)
  expect(verdictContext(ref, true, 'Maintained fork of a known library')).toBe(
    'WATCHTOWER VERDICT npm:fastapi-auth-kit → allowed: Maintained fork of a known library',
  )
})

test('multi-package commands list refused first, then held, and omit passes', () => {
  const held = check({ ref: { ecosystem: 'npm', name: 'held' }, tier: 'hold' })
  const passed = check({ ref: { ecosystem: 'npm', name: 'ok' }, tier: 'pass' })
  const refused = check({ ref: { ecosystem: 'npm', name: 'bad' }, tier: 'refuse' })
  const text = commandText([held, passed, refused], c => (c.tier === 'refuse' ? refusedText(c) : heldText(c)))
  expect(text.indexOf('REFUSED npm:bad')).toBeLessThan(text.indexOf('HELD npm:held'))
  expect(text).not.toContain('npm:ok')
  expect(text.split('\n\n')).toHaveLength(2)
})
