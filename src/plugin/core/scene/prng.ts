// Seeded mulberry32. The state is a plain number so it can live inside Scene and replay exactly.

export type PrngResult = { value: number; state: number }

export const next = (state: number): PrngResult => {
  const s = (state + 0x6d2b79f5) >>> 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: s }
}

/** Draws `count` values in [0, 1), returning them with the advanced state. */
export const draw = (state: number, count: number): { values: number[]; state: number } => {
  const values: number[] = []
  let s = state
  for (let i = 0; i < count; i++) {
    const r = next(s)
    values.push(r.value)
    s = r.state
  }
  return { values, state: s }
}
