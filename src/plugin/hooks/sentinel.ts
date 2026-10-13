// The Sentinel (FR-013..FR-018): a hidden, read-only investigator subagent for held packages.
//
// The gate can't call in here (`$` never crosses an import), so the hand-off runs through state:
// the gate queues an Investigation, and this module's tool.call hook (registered before the
// gate's, so it wraps it: "a plugin's registrations nest in order, first outermost") spawns a
// Sentinel for anything queued once the gate has decided. The verdict arrives on turn.complete,
// matched by agent id, or by the investigation id the Sentinel echoes (core/sentinel/turn.ts).
import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { fnv1a } from '../core/parse/index'
import { taskPrompt } from '../core/sentinel/prompt'
import { matchTurn, resolveTurn } from '../core/sentinel/turn'
import { label, verdictContext } from '../core/text/deny-text'
import type { Investigation, SceneEvent } from '../types'
import { appendEvents, type Ctx } from './context'

const events = atom({ plugin: 'omnis-watchtower', key: 'events' } as const, [] as SceneEvent[])
const investigations = atom({ plugin: 'omnis-watchtower', key: 'investigations' } as const, {} as Record<string, Investigation>)
const contextQueue = atom({ plugin: 'omnis-watchtower', key: 'contextQueue' } as const, [] as string[])

export const SENTINEL_NAME = 'sentinel'
export const SENTINEL_TYPE = `omnis-watchtower:${SENTINEL_NAME}`

/** The investigations record with one entry replaced (keeps the status literal typed). */
const put = (all: Record<string, Investigation>, inv: Investigation): Record<string, Investigation> => ({ ...all, [inv.key]: inv })

export const install = (on: On, _ctx: Ctx): void => {
  // Hidden from the model: only Watchtower dispatches it (FR-014)
  on('agent.offer', { agent: 'omnis-watchtower:sentinel' }, () => ({ isOffered: false }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    const queued = Object.values(await read($, investigations)).filter(inv => inv.status === 'queued')
    for (const inv of queued) {
      const now = await $.clock.now()
      const token = `wt-${fnv1a(`${inv.key}\u0000${now}\u0000${inv.attempts}`)}`
      const spawned = await $.agent.spawn({
        subagentType: SENTINEL_TYPE,
        description: `Watchtower: investigate ${label(inv.ref)}`,
        prompt: taskPrompt(inv.ref, inv.reasons, token),
      })
      if (spawned.deny !== undefined) {
        await update($, investigations, cur => put(cur, { ...inv, status: 'failed', failure: `the Sentinel could not start (${spawned.deny})` }))
        continue
      }
      // The host sets agentId for a subagent it started; the token covers the case where it doesn't
      const running: Investigation = { ...inv, status: 'running', token, attempts: inv.attempts + 1, ...(spawned.agentId ? { agentId: spawned.agentId } : {}) }
      await update($, investigations, cur => put(cur, running))
      await update($, events, l => appendEvents(l, now, { type: 'SentinelDispatched', key: inv.key, sentinelId: spawned.agentId ?? token }))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) return done
    const turn = { agentId: e.agentId, reason: e.reason, answer: e.answer }
    const inv = matchTurn(await read($, investigations), turn)
    if (!inv) return done

    const outcome = resolveTurn(inv, turn)
    await update($, investigations, cur => put(cur, outcome.next))
    if (outcome.kind === 'retry') return done // spawned again on the next Bash call

    const now = await $.clock.now()
    await update($, events, l => appendEvents(l, now, { type: 'VerdictIssued', key: inv.key, tier: outcome.tier, evidence: outcome.evidence }))
    if (outcome.kind === 'failed') {
      $.ui.toast(`✖ Watchtower: investigation of ${label(inv.ref)} failed; refused`)
      return done
    }
    await update($, contextQueue, q => [...q, verdictContext(inv.ref, outcome.allowed, outcome.evidence[0] ?? (outcome.allowed ? 'no concerns found' : 'unsafe'))])
    $.ui.toast(`${outcome.allowed ? '✔' : '✖'} Watchtower: ${label(inv.ref)} ${outcome.allowed ? 'cleared' : 'refused'} by the Sentinel`)
    return done
  })
}
