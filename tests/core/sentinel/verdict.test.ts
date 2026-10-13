import { describe, expect, it } from 'vitest'
import { parseVerdict } from '../../../src/plugin/core/sentinel/verdict'

const good = { verdict: 'block', confidence: 0.9, evidence: ['postinstall downloads a binary'] }
const json = (o: unknown) => JSON.stringify(o)

describe('parseVerdict', () => {
  it('accepts a bare JSON object', () => {
    expect(parseVerdict(json(good))).toEqual({ ok: true, verdict: good })
  })

  it('extracts JSON from a fenced block', () => {
    const answer = 'Here is my finding:\n```json\n' + json(good) + '\n```\nDone.'
    expect(parseVerdict(answer)).toEqual({ ok: true, verdict: good })
  })

  it('extracts JSON surrounded by prose, including braces inside strings', () => {
    const v = { verdict: 'allow', confidence: 0.4, evidence: ['script is `{ "a": 1 }` only'] }
    expect(parseVerdict(`I looked at it. ${json(v)} That is all.`)).toEqual({ ok: true, verdict: v })
  })

  it('skips a non-verdict object and finds the real one', () => {
    expect(parseVerdict(`note {"x":1} then ${json(good)}`).ok).toBe(true)
  })

  it('trims chatty evidence instead of rejecting a sound verdict (live runs, 2026-10-13)', () => {
    const long = parseVerdict(json({ ...good, evidence: ['x'.repeat(450)] }))
    expect(long.ok).toBe(true)
    if (long.ok) expect(long.verdict.evidence[0]).toHaveLength(200)
    const many = parseVerdict(json({ ...good, evidence: Array.from({ length: 12 }, (_, i) => `line ${i}`) }))
    expect(many.ok).toBe(true)
    if (many.ok) expect(many.verdict.evidence).toHaveLength(8)
  })

  it('accepts the boundaries: confidence 0 and 1, 8 items, 200 chars', () => {
    expect(parseVerdict(json({ ...good, confidence: 0 })).ok).toBe(true)
    expect(parseVerdict(json({ ...good, confidence: 1 })).ok).toBe(true)
    expect(parseVerdict(json({ ...good, evidence: Array(8).fill('x') })).ok).toBe(true)
    expect(parseVerdict(json({ ...good, evidence: ['x'.repeat(200)] })).ok).toBe(true)
  })

  it.each([
    ['extra keys', { ...good, note: 'hi' }],
    ['confidence above 1', { ...good, confidence: 1.1 }],
    ['confidence below 0', { ...good, confidence: -0.1 }],
    ['confidence as string', { ...good, confidence: '0.5' }],
    ['empty evidence', { ...good, evidence: [] }],
    ['empty evidence line', { ...good, evidence: [''] }],
    ['non-string evidence', { ...good, evidence: [3] }],
    ['unknown verdict', { ...good, verdict: 'maybe' }],
    ['missing verdict', { confidence: 0.5, evidence: ['x'] }]
  ])('rejects %s', (_name, value) => {
    const r = parseVerdict(json(value))
    expect(r.ok).toBe(false)
  })

  it.each(['', 'looks fine to me', '{not json}', '[1,2]', '```json\nnope\n```'])('rejects non-JSON %j', (answer) => {
    expect(parseVerdict(answer).ok).toBe(false)
  })

  it('explains the failure', () => {
    expect(parseVerdict(json({ ...good, note: 1 }))).toEqual({ ok: false, reason: 'unexpected key: note' })
  })
})

describe("the echoed investigation id", () => {
  it('is accepted and returned', () => {
    const r = parseVerdict(JSON.stringify({ investigation: 'wt-1a2b', verdict: 'allow', confidence: 1, evidence: ['ok'] }))
    expect(r).toMatchObject({ ok: true, investigation: 'wt-1a2b' })
  })
  it('must be a short string', () => {
    expect(parseVerdict(JSON.stringify({ investigation: 'x'.repeat(65), verdict: 'allow', confidence: 1, evidence: ['ok'] })).ok).toBe(false)
    expect(parseVerdict(JSON.stringify({ investigation: 7, verdict: 'allow', confidence: 1, evidence: ['ok'] })).ok).toBe(false)
  })
})
