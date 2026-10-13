// Parses and validates the Sentinel's answer (contracts/sentinel-verdict.schema.json). Hand-written, no dependency.

import type { SentinelVerdict } from '../model'

export type ParsedVerdict = { ok: true; verdict: SentinelVerdict } | { ok: false; reason: string }

const KEYS = ['verdict', 'confidence', 'evidence']
const MAX_ITEMS = 8
const MAX_LEN = 200

/** Candidate JSON texts: the whole answer, fenced blocks, then every balanced top-level object in the prose. */
const candidates = (answer: string): string[] => {
  const found: string[] = [answer.trim()]
  for (const m of answer.matchAll(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/g)) found.push((m[1] ?? '').trim())
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < answer.length; i++) {
    const c = answer[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
    } else if (c === '"' && depth > 0) inString = true
    else if (c === '{') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}' && depth > 0) {
      depth--
      if (depth === 0) found.push(answer.slice(start, i + 1))
    }
  }
  return found.filter((t) => t.startsWith('{'))
}

const validate = (value: unknown): ParsedVerdict => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'verdict is not a JSON object' }
  }
  const o = value as Record<string, unknown>
  const extra = Object.keys(o).filter((k) => !KEYS.includes(k))
  if (extra.length > 0) return { ok: false, reason: `unexpected key: ${extra[0]}` }
  for (const k of KEYS) if (!(k in o)) return { ok: false, reason: `missing key: ${k}` }
  if (o.verdict !== 'allow' && o.verdict !== 'block') return { ok: false, reason: 'verdict must be "allow" or "block"' }
  const c = o.confidence
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) {
    return { ok: false, reason: 'confidence must be a number from 0 to 1' }
  }
  const e = o.evidence
  if (!Array.isArray(e)) return { ok: false, reason: 'evidence must be an array' }
  if (e.length < 1) return { ok: false, reason: 'evidence must not be empty' }
  if (e.length > MAX_ITEMS) return { ok: false, reason: `evidence has more than ${MAX_ITEMS} items` }
  for (const line of e) {
    if (typeof line !== 'string' || line.length < 1) return { ok: false, reason: 'evidence items must be non-empty strings' }
    if (line.length > MAX_LEN) return { ok: false, reason: `evidence item longer than ${MAX_LEN} characters` }
  }
  return { ok: true, verdict: { verdict: o.verdict, confidence: c, evidence: e as string[] } }
}

export const parseVerdict = (answer: string): ParsedVerdict => {
  if (typeof answer !== 'string' || answer.trim() === '') return { ok: false, reason: 'empty answer' }
  let firstFailure: ParsedVerdict | undefined
  for (const text of candidates(answer)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    const result = validate(parsed)
    if (result.ok) return result
    firstFailure ??= result
  }
  return firstFailure ?? { ok: false, reason: 'no JSON object found in answer' }
}
