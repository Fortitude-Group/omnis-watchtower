// The surface that works with the pane closed (T063, FR-018, FR-022): the status line, toasts for
// refusals, holds and faults, and verdict lines handed to the agent on its next turn.
//
// The status line and toasts hang off `state.set` for this plugin's own `events` and `fault`
// keys. Every writer (gate, Sentinel, fleet, commands) goes through it, including the gate's
// refusals, which an inner tool.call hook like this one never sees. So there is one refresh point
// and no polling.
import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { addTotals, emptyTotals, statusLine, toastsFor } from '../core/text/status-line'
import type { SceneEvent, WatchtowerFault } from '../types'
import type { Ctx } from './context'

const events = atom({ plugin: 'omnis-watchtower', key: 'events' } as const, [] as SceneEvent[])
const fault = atom({ plugin: 'omnis-watchtower', key: 'fault' } as const, null as WatchtowerFault | null)
const contextQueue = atom({ plugin: 'omnis-watchtower', key: 'contextQueue' } as const, [] as string[])
const demo = atom({ plugin: 'omnis-watchtower', key: 'demo' } as const, false)
const totals = atom({ plugin: 'omnis-watchtower', key: 'totals' } as const, emptyTotals())

/** True when a state.set resolved as written (the engine has been seen to wrap it as `{ value }`). */
const wasSet = (r: unknown): boolean => {
  const o = r as { isSet?: boolean; value?: { isSet?: boolean } } | undefined
  return (o?.isSet ?? o?.value?.isSet) === true
}

export const install = (on: On, ctx: Ctx): void => {
  on('state.set', { plugin: 'omnis-watchtower', key: ['events', 'fault'] }, async ($, e, next) => {
    const before = e.key === 'events' ? await read($, events) : undefined
    const r = await next(e)
    if (!wasSet(r)) return r
    const now = e.key === 'events' ? (e.value as SceneEvent[]) : await read($, events)
    const faulted = e.key === 'fault' ? e.value !== null && e.value !== undefined : (await read($, fault)) !== null
    // Tally only the newly appended events into the running totals, so nothing ages out of the
    // count when the ring buffer drops old events (Principle XII: a count must not silently shrink)
    const lastSeq = before?.at(-1)?.seq ?? 0
    const added = before ? now.filter(ev => ev.seq > lastSeq) : []
    const current = added.length ? await update($, totals, t => addTotals(t, added)) : await read($, totals)
    await $.ui.status(statusLine(current, faulted))
    if (added.length && !(await read($, demo))) {
      for (const text of toastsFor(before ?? [], added, ctx.options.mode)) await $.ui.toast(text)
    }
    return r
  })

  // Verdict lines reach the agent once: on the main loop's next tool result, or with the next
  // prompt if the loop is idle, whichever comes first
  on('tool.call', { tool: /./ }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || result.deny !== undefined || (await read($, contextQueue)).length === 0) return result
    let lines: string[] = []
    await update($, contextQueue, q => ((lines = q), []))
    return lines.length ? { ...result, context: [...(result.context ?? []), ...lines] } : result
  })

  on('prompt.submit', async ($, e, next) => {
    if ((await read($, contextQueue)).length === 0) return next(e)
    let lines: string[] = []
    await update($, contextQueue, q => ((lines = q), []))
    return next(lines.length ? { ...e, context: [...(e.context ?? []), ...lines] } : e)
  })
}
