import { describe, expect, test } from 'vitest'
import type { Investigation } from '../../../src/plugin/core/model'
import { matchTurn, resolveTurn } from '../../../src/plugin/core/sentinel/turn'

const inv = (over: Partial<Investigation> = {}): Investigation => ({
  key: 'npm:left-padx@latest', ref: { ecosystem: 'npm', name: 'left-padx' }, status: 'running', attempts: 1,
  startedAt: 0, deadline: 180_000, reasons: ['First published 2 days ago'], hasHardSignal: false,
  agentId: 'a-1', token: 'wt-abc', ...over,
})
const verdict = (v: 'allow' | 'block', extra: object = {}) => JSON.stringify({ verdict: v, confidence: 0.9, evidence: ['Checked the repository'], ...extra })

describe('matchTurn', () => {
  const all = { [inv().key]: inv(), 'npm:other@latest': inv({ key: 'npm:other@latest', agentId: 'a-2', token: 'wt-def' }) }
  test('by agent id when the host reports one', () => {
    expect(matchTurn(all, { agentId: 'a-2', reason: 'answer', answer: 'x' })?.key).toBe('npm:other@latest')
  })
  test('by the echoed investigation id when the host gave the Sentinel no agent id', () => {
    const noId = { k: inv({ agentId: undefined }) }
    expect(matchTurn(noId, { agentId: 'unknown', reason: 'answer', answer: verdict('allow', { investigation: 'wt-abc' }) })?.key).toBe('npm:left-padx@latest')
  })
  test('never by token when the investigation has its own agent id (another subagent quoting it)', () => {
    expect(matchTurn(all, { agentId: 'someone-else', reason: 'answer', answer: verdict('allow', { investigation: 'wt-abc' }) })).toBeUndefined()
  })
  test('a turn matching neither is not ours', () => {
    expect(matchTurn(all, { agentId: 'unknown', reason: 'answer', answer: verdict('allow') })).toBeUndefined()
    expect(matchTurn(all, { agentId: 'unknown', reason: 'error', answer: '' })).toBeUndefined()
  })
  test('finished investigations are never matched again', () => {
    expect(matchTurn({ k: inv({ status: 'concluded' }) }, { agentId: 'a-1', reason: 'answer', answer: verdict('allow') })).toBeUndefined()
  })
})

describe('resolveTurn', () => {
  test('allow clears the package', () => {
    expect(resolveTurn(inv(), { reason: 'answer', answer: verdict('allow') })).toMatchObject({ kind: 'concluded', allowed: true, tier: 'pass' })
  })
  test('allow never clears a package with a hard signal (FR-015)', () => {
    expect(resolveTurn(inv({ hasHardSignal: true }), { reason: 'answer', answer: verdict('allow') })).toMatchObject({ kind: 'concluded', allowed: false, tier: 'refuse' })
  })
  test('block refuses with the Sentinel\'s evidence', () => {
    expect(resolveTurn(inv(), { reason: 'answer', answer: verdict('block') })).toMatchObject({ kind: 'concluded', tier: 'refuse', evidence: ['Checked the repository'] })
  })
  test('malformed output is retried once, and the retry forgets the old agent', () => {
    const r = resolveTurn(inv({ attempts: 1 }), { reason: 'answer', answer: 'looks fine' })
    expect(r.kind).toBe('retry')
    expect(r.next).toMatchObject({ status: 'queued' })
    expect(r.next.agentId).toBeUndefined()
  })
  test('malformed output on the second attempt fails closed (FR-017)', () => {
    expect(resolveTurn(inv({ attempts: 2 }), { reason: 'answer', answer: 'still not JSON' })).toMatchObject({ kind: 'failed', tier: 'refuse', next: { status: 'failed' } })
  })
  test.each(['error', 'aborted', 'refusal'] as const)('a turn ending in %s fails closed without a retry', reason => {
    expect(resolveTurn(inv({ attempts: 1 }), { reason, answer: '' })).toMatchObject({ kind: 'failed', next: { failure: `the Sentinel's turn ended (${reason})` } })
  })
})
