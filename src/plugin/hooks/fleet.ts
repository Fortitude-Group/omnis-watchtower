// The fleet (T061): helper agents launching, acting and finishing, and the tokens every turn used.
//
// Registered after the gate, so for Bash the gate wraps this hook: a call the gate refuses never
// reaches here. That is intended: the refused package is already on the map as a PackageScored
// event, and the command never ran, so there is no action to log.
import { atom, update } from 'claude-code'
import type { On } from 'claude-code'

import { estimateCostUsd } from '../core/data/prices'
import type { SceneEvent, TokenUsage } from '../types'
import { appendEvents, type Ctx } from './context'
import { SENTINEL_TYPE } from './sentinel'

const events = atom({ plugin: 'omnis-watchtower', key: 'events' } as const, [] as SceneEvent[])

const MAIN = 'main'
// The Agent tool's own call is shown as the launch it causes
const SPAWNING_TOOLS = new Set(['Agent', 'Task'])

const basename = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path

const clip = (s: string, max = 48): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

const hostOf = (url: string): string => url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i)?.[1] ?? url

/** "Edit auth.ts", "Bash npm test", "Read README.md": short, and never a whole command line. */
export const summarize = (e: Record<string, unknown>): string => {
  const tool = String(e.tool ?? 'tool')
  const str = (k: string) => (typeof e[k] === 'string' && e[k] !== '' ? (e[k] as string) : undefined)
  const path = str('file_path') ?? str('notebook_path') ?? str('path')
  if (path) return clip(`${tool} ${basename(path)}`)
  const command = str('command')
  if (command) return clip(`${tool} ${command.trim().split(/\s+/).slice(0, 3).join(' ')}`)
  const url = str('url')
  if (url) return clip(`${tool} ${hostOf(url)}`)
  const pattern = str('pattern') ?? str('query') ?? str('skill')
  if (pattern) return clip(`${tool} ${pattern}`)
  return clip(tool)
}

const tokensOf = (u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }): TokenUsage => ({
  input: u.input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
})

export const install = (on: On, _ctx: Ctx): void => {
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    // Types (2.1.288) say subagentType; the running engine hands over the Agent tool's own input
    const raw = e as unknown as { subagentType?: unknown; subagent_type?: unknown }
    const agentType = String(raw.subagentType ?? raw.subagent_type ?? 'general-purpose')
    // The Sentinel is drawn as a sentinel (SentinelDispatched); no agentId means nothing started
    if (started.deny !== undefined || !started.agentId || agentType === SENTINEL_TYPE) return started
    const agentId = started.agentId
    const now = await $.clock.now()
    await update($, events, l => appendEvents(l, now, { type: 'AgentLaunched', agentId, agentType }))
    return started
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined || SPAWNING_TOOLS.has(e.tool)) return result
    const summary = summarize(e as unknown as Record<string, unknown>)
    const now = await $.clock.now()
    await update($, events, l => appendEvents(l, now, { type: 'AgentActed', agentId: e.agentId ?? MAIN, summary }))
    return result
  })

  // sentinel.ts holds the one unmatched turn.complete registration; this matcher covers every turn
  on('turn.complete', { reason: ['answer', 'aborted', 'error', 'refusal'] }, async ($, e, next) => {
    const done = await next(e)
    const usage = e.usage ?? done.usage
    const agentId = e.agentId
    if (!agentId && !usage) return done
    const now = await $.clock.now()
    await update($, events, l => {
      const added: Parameters<typeof appendEvents>[2][] = []
      // Only agents shown as launched are finished (not the main loop, not the Sentinel)
      if (agentId && l.some(ev => ev.type === 'AgentLaunched' && ev.agentId === agentId)) added.push({ type: 'AgentFinished', agentId })
      if (usage) {
        const tokens = tokensOf(usage)
        const model = String(usage.model ?? 'unknown')
        const estCostUsd = estimateCostUsd(model, tokens)
        added.push({ type: 'UsageUpdated', agentId: agentId ?? MAIN, model, tokens, ...(estCostUsd === undefined ? {} : { estCostUsd }) })
      }
      return added.length ? appendEvents(l, now, ...added) : l
    })
    return done
  })
}
