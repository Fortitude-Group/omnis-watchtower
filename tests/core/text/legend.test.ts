import { describe, expect, test } from 'vitest'
import { LEGEND, legendFor, legendLine, legendText, type FigureId } from '../../../src/plugin/core/text/legend'
import { PRICES, estimateCostUsd, formatEstimate, priceFor } from '../../../src/plugin/core/data/prices'

const FIGURES: FigureId[] = ['intercepts', 'passed', 'held', 'refused', 'unverified', 'unchecked', 'overridden', 'tokens', 'estCost']

describe('legend (Principle XII, FR-023)', () => {
  test('covers every on-screen figure exactly once', () => {
    expect(LEGEND.map((e) => e.id).sort()).toEqual([...FIGURES].sort())
  })

  test.each(FIGURES)('%s says what, why and what follows', (id) => {
    const e = legendFor(id)
    for (const s of [e.label, e.what, e.why, e.whatFollows]) expect(s.trim().length).toBeGreaterThan(5)
    expect(legendLine(id)).toContain(e.what)
  })

  test('counts that leave things out name what they leave out', () => {
    const ex = (id: FigureId) => legendFor(id).excludes ?? ''
    expect(ex('intercepts')).toMatch(/npm and PyPI/)
    expect(ex('intercepts')).toMatch(/your own terminal/)
    expect(ex('passed')).toMatch(/private registry/)
    expect(ex('held')).toMatch(/counted .*again/)
    expect(ex('tokens')).toMatch(/rounded/)
    expect(ex('estCost')).toMatch(/without a bundled price/)
    expect(ex('estCost')).toMatch(/discounts/)
    for (const e of LEGEND) if (e.excludes !== undefined) expect(e.excludes.trim().length).toBeGreaterThan(10)
  })

  test('verdict labels carry their glyph', () => {
    expect(legendFor('passed').label).toContain('✔')
    expect(legendFor('held').label).toContain('◆')
    expect(legendFor('refused').label).toContain('✖')
  })

  test('the estimate legend names every priced model', () => {
    for (const id of Object.keys(PRICES)) expect(legendFor('estCost').excludes).toContain(id)
  })

  test('legendText has a block per figure', () => {
    const text = legendText()
    for (const e of LEGEND) expect(text).toContain(e.label)
    expect(text.match(/What to do:/g)).toHaveLength(LEGEND.length)
  })
})

describe('prices', () => {
  test('prices the current models and ignores context tags', () => {
    expect(priceFor('claude-opus-5-5')).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 })
    expect(priceFor('claude-sonnet-5-5[1m]')).toEqual(PRICES['claude-sonnet-5-5'])
    expect(priceFor('claude-haiku-4-5-20251001')?.input).toBe(1)
    expect(priceFor('claude-fable-5-1')?.output).toBe(50)
  })

  test('unknown and partner ids are unpriced, not guessed', () => {
    expect(priceFor('claude-made-up-9')).toBeUndefined()
    expect(priceFor('anthropic.claude-opus-5-5')).toBeUndefined()
    expect(priceFor('toString')).toBeUndefined()
    expect(estimateCostUsd('gpt-x', { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 })).toBeUndefined()
  })

  test('estimates from all four token kinds', () => {
    const usd = estimateCostUsd('claude-opus-5-5', { input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 200_000 })
    expect(usd).toBeCloseTo(4 + 2 + 0.2 + 1, 10)
  })

  test('the on-screen form is always approximate and labelled', () => {
    expect(formatEstimate(0.42)).toBe('≈ $0.42 est.')
    expect(formatEstimate(0.004)).toBe('≈ <$0.01 est.')
    expect(formatEstimate(0)).toBe('≈ $0.00 est.')
    expect(formatEstimate(12_345.6)).toBe('≈ $12,346 est.')
  })
})
