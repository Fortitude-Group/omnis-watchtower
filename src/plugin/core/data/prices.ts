// List prices for the spend estimate (research R14). USD per million tokens, Anthropic first-party
// API rates.
//
// Source: the Claude API reference bundled with Claude Code (model table cached 2026-09-25; cache
// economics in its prompt-caching notes). Input/output and cache-read rates are quoted there per
// model; cache writes are the published 1.25x-of-input rate for the 5-minute TTL. Haiku 4.5's cache
// read is the general 0.1x-of-input rate, as no model-specific figure is quoted.
// VERIFY against https://platform.claude.com/docs/en/about-claude/pricing before each release.
// A model missing from this table is counted as unpriced, never guessed.

import type { TokenUsage } from '../../types'

export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number }

export const PRICES_AS_OF = '2026-09-25'

export const PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
}

/**
 * The list price for a model id as Claude Code reports it. A trailing context tag such as `[1m]`
 * is ignored. Partner-prefixed ids (Bedrock, Vertex) are deliberately unpriced: their rates differ.
 */
export const priceFor = (model: string): ModelPrice | undefined => {
  const id = model.trim().replace(/\[[^\]]*\]$/, '')
  return Object.prototype.hasOwnProperty.call(PRICES, id) ? PRICES[id] : undefined
}

export const totalTokens = (t: TokenUsage): number => t.input + t.output + t.cacheRead + t.cacheWrite

/** Estimated list-price cost in USD, or undefined when the model has no bundled price. */
export const estimateCostUsd = (model: string, tokens: TokenUsage): number | undefined => {
  const p = priceFor(model)
  if (!p) return undefined
  return (tokens.input * p.input + tokens.output * p.output + tokens.cacheRead * p.cacheRead + tokens.cacheWrite * p.cacheWrite) / 1_000_000
}

/** The only way a cost is shown on screen: always marked approximate and estimated. */
export const formatEstimate = (usd: number): string => {
  if (!(usd > 0)) return '≈ $0.00 est.'
  if (usd < 0.01) return '≈ <$0.01 est.'
  if (usd < 100) return `≈ $${usd.toFixed(2)} est.`
  return `≈ $${String(Math.round(usd)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} est.`
}
