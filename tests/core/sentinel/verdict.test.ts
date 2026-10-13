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
    ['more than 8 items', { ...good, evidence: Array(9).fill('x') }],
    ['empty evidence line', { ...good, evidence: [''] }],
    ['evidence line over 200', { ...good, evidence: ['x'.repeat(201)] }],
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
