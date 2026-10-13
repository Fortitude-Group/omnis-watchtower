// Look-alike detection against a ranked popular-name list (most popular first).

import { normalise, type Ecosystem } from '../model'

const HOMOGLYPHS: [RegExp, string][] = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/0/g, 'o'],
  [/1/g, 'l'],
  [/3/g, 'e'],
  [/5/g, 's'],
]

/** Lower-case, drop separators, fold homoglyphs: the form two look-alike names share. */
export const fold = (name: string): string => {
  let s = name.trim().toLowerCase().replace(/[-_.]/g, '')
  for (const [re, to] of HOMOGLYPHS) s = s.replace(re, to)
  return s
}

const MIN_LENGTH = 4

export const maxDistance = (length: number): number => (length <= 5 ? 1 : 2)

/** Optimal-string-alignment Damerau-Levenshtein, banded, abandoning once the row minimum exceeds `max`. */
export const distance = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1
  if (a === b) return 0
  const n = b.length
  let prev2 = new Array<number>(n + 1).fill(0)
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let cur = new Array<number>(n + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = i
    const lo = Math.max(1, i - max)
    const hi = Math.min(n, i + max)
    if (lo > 1) cur[lo - 1] = max + 1
    for (let j = lo; j <= hi; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (hi < n) cur[hi + 1] = max + 1
    if (rowMin > max) return max + 1
    ;[prev2, prev, cur] = [prev, cur, prev2]
  }
  return prev[n]!
}

type Entry = { name: string; folded: string; rank: number }

export type TyposquatIndex = {
  readonly names: ReadonlySet<string>
  readonly buckets: ReadonlyMap<number, readonly Entry[]>
  readonly ecosystem: Ecosystem
}

export type TyposquatMatch = { imitates: string; distance: number }

export const buildTyposquatIndex = (names: readonly string[], ecosystem: Ecosystem = 'npm'): TyposquatIndex => {
  const set = new Set<string>()
  const buckets = new Map<number, Entry[]>()
  names.forEach((raw, rank) => {
    const name = normalise(ecosystem, raw)
    if (set.has(name)) return
    set.add(name)
    if (name.length < MIN_LENGTH) return
    const folded = fold(name)
    const bucket = buckets.get(folded.length) ?? []
    bucket.push({ name, folded, rank })
    buckets.set(folded.length, bucket)
  })
  return { names: set, buckets, ecosystem }
}

/** The most popular name this one imitates, or undefined. A popular name never matches itself. */
export const findTyposquat = (index: TyposquatIndex, raw: string): TyposquatMatch | undefined => {
  const name = normalise(index.ecosystem, raw)
  if (name.length < MIN_LENGTH || index.names.has(name)) return undefined
  const folded = fold(name)
  const max = maxDistance(folded.length)
  let best: (TyposquatMatch & { rank: number }) | undefined
  for (let len = folded.length - max; len <= folded.length + max; len++) {
    for (const e of index.buckets.get(len) ?? []) {
      if (best && e.rank > best.rank) continue
      const d = distance(folded, e.folded, max)
      if (d > max) continue
      if (!best || e.rank < best.rank) best = { imitates: e.name, distance: d, rank: e.rank }
    }
  }
  return best && { imitates: best.imitates, distance: best.distance }
}
