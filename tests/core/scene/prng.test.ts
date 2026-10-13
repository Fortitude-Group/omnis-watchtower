import { expect, test } from 'vitest'
import { draw, next } from '../../../src/plugin/core/scene/prng'

test('same seed gives the same sequence', () => {
  expect(draw(42, 100)).toEqual(draw(42, 100))
})

test('different seeds diverge', () => {
  expect(draw(1, 10).values).not.toEqual(draw(2, 10).values)
})

test('values are in [0, 1) and the state advances', () => {
  let s = 7
  for (let i = 0; i < 10_000; i++) {
    const r = next(s)
    expect(r.value).toBeGreaterThanOrEqual(0)
    expect(r.value).toBeLessThan(1)
    expect(r.state).not.toBe(s)
    s = r.state
  }
})

test('draw continues where next leaves off', () => {
  const a = next(99)
  const b = next(a.state)
  expect(draw(99, 2)).toEqual({ values: [a.value, b.value], state: b.state })
})
