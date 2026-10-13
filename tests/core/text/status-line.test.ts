import { describe, expect, test } from 'vitest'

import { currentFault, formatAge, sessionTotals, statusLine, toastsFor } from '../../../src/plugin/core/text/status-line'
import type { PackageRef, SceneEvent, Tier } from '../../../src/plugin/types'

let seq = 0
const ev = (e: Record<string, unknown>): SceneEvent => ({ at: 0, seq: ++seq, ...e }) as SceneEvent
const ref = (name: string, version?: string): PackageRef => ({ ecosystem: 'npm', name, ...(version ? { version } : {}) })
const scored = (name: string, tier: Tier, evidence: string[] = [`${name} ${tier}`], version?: string) =>
  ev({ type: 'PackageScored', requestId: `r${seq}`, ref: ref(name, version), tier, evidence })
const usage = (input: number, output: number, estCostUsd?: number) =>
  ev({ type: 'UsageUpdated', agentId: 'main', model: 'm', tokens: { input, output, cacheRead: 0, cacheWrite: 0 }, ...(estCostUsd === undefined ? {} : { estCostUsd }) })

describe('sessionTotals', () => {
  test('counts as the scene reducer does', () => {
    const t = sessionTotals([
      ev({ type: 'PackageIntercepted', requestId: 'a', agentId: 'main', ref: ref('a') }),
      scored('a', 'pass'), scored('b', 'refuse'), scored('c', 'hold'), scored('d', 'unverified'), scored('e', 'unchecked'),
      ev({ type: 'VerdictIssued', key: 'npm:c@latest', tier: 'pass', evidence: [] }),
      ev({ type: 'VerdictIssued', key: 'npm:c@latest', tier: 'hold', evidence: [] }),
      ev({ type: 'OverrideApplied', key: 'npm:b', action: 'allow', scope: 'session' }),
      usage(1000, 500, 0.01), usage(200, 0),
    ])
    expect(t).toMatchObject({ intercepts: 1, passed: 2, held: 1, refused: 1, unverified: 1, unchecked: 1, overridden: 1, estCostUsd: 0.01, unpricedTokens: 200 })
    expect(t.tokens).toEqual({ input: 1200, output: 500, cacheRead: 0, cacheWrite: 0 })
  })
})

describe('statusLine', () => {
  test('matches the contract format', () => {
    const t = sessionTotals([scored('a', 'pass'), scored('b', 'pass'), scored('c', 'hold'), scored('d', 'refuse'), usage(12_000, 345)])
    expect(statusLine(t, false)).toBe('🛡 2 ✔ · 1 ◆ · 1 ✖ · 12.3k tokens')
    expect(statusLine(t, true)).toBe('🛡 2 ✔ · 1 ◆ · 1 ✖ · 12.3k tokens · ⚠ FAULT')
  })
})

describe('toastsFor', () => {
  test('a refusal names the package and the top reason', () => {
    expect(toastsFor([], [scored('reqeusts', 'refuse', ['typosquat of requests'])])).toEqual(['✖ Watchtower refused npm:reqeusts — typosquat of requests'])
  })

  test('several refusals in one command make one toast', () => {
    expect(toastsFor([], [scored('a', 'refuse'), scored('b', 'refuse')])).toEqual(['✖ Watchtower refused 2 packages: npm:a, npm:b'])
  })

  test('warn-only says the package would have been refused', () => {
    expect(toastsFor([], [scored('a', 'refuse', ['x'])], 'warn-only')[0]).toBe('✖ Watchtower would refuse (warn-only, it ran) npm:a — x')
  })

  test('a hold toasts once until its verdict lands', () => {
    const first = scored('zod', 'hold', ['fresh release'], '4.6.7')
    expect(toastsFor([], [first])).toEqual(['◆ Watchtower held npm:zod@4.6.7 — fresh release; a Sentinel is investigating'])
    expect(toastsFor([first], [scored('zod', 'hold', ['fresh release'], '4.6.7')])).toEqual([])
    const verdict = ev({ type: 'VerdictIssued', key: 'npm:zod@4.6.7', tier: 'pass', evidence: [] })
    expect(toastsFor([first, verdict], [scored('zod', 'hold', ['fresh release'], '4.6.7')])).toHaveLength(1)
  })

  test('passes, verdicts and gate faults raise nothing here; other faults do', () => {
    expect(toastsFor([], [
      scored('a', 'pass'),
      ev({ type: 'VerdictIssued', key: 'npm:a@latest', tier: 'refuse', evidence: [] }),
      ev({ type: 'Fault', where: 'gate', message: 'boom' }),
    ])).toEqual([])
    expect(toastsFor([], [ev({ type: 'Fault', where: 'render', message: 'boom' })])).toEqual(['⚠ Watchtower fault in the render: boom'])
  })
})

describe('currentFault', () => {
  test('is the last fault not yet cleared', () => {
    const f = ev({ type: 'Fault', where: 'gate', message: 'x' })
    expect(currentFault([f])).toBe(f)
    expect(currentFault([f, ev({ type: 'FaultCleared' })])).toBeUndefined()
    expect(currentFault([])).toBeUndefined()
  })
})

describe('formatAge', () => {
  test.each([[0, '0s'], [59_999, '59s'], [65_000, '1m 05s'], [3_700_000, '1h 01m']])('%i ms → %s', (ms, text) => {
    expect(formatAge(ms)).toBe(text)
  })
})

describe('running totals (Principle XII: counts never shrink when the ring buffer drops events)', () => {
  test('adding events in batches equals tallying them all at once', async () => {
    const { addTotals, emptyTotals, sessionTotals } = await import('../../../src/plugin/core/text/status-line')
    const ref = { ecosystem: 'npm' as const, name: 'x' }
    const all = Array.from({ length: 1_200 }, (_, i) => i % 2 === 0
      ? { type: 'PackageIntercepted' as const, requestId: `r${i}`, agentId: 'main', ref, at: i, seq: i + 1 }
      : { type: 'PackageScored' as const, requestId: `r${i - 1}`, ref, tier: i % 4 === 1 ? 'refuse' as const : 'pass' as const, evidence: [], at: i, seq: i + 1 })
    let running = emptyTotals()
    for (let i = 0; i < all.length; i += 7) running = addTotals(running, all.slice(i, i + 7))
    expect(running).toEqual(sessionTotals(all))
    expect(running.intercepts).toBe(600)
    // what the 500-event buffer alone would report
    expect(sessionTotals(all.slice(-500)).intercepts).toBe(250)
  })
})
