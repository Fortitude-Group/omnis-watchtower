// Pane confirmation of a pending override (research R1, FR-029). A press on a Watchtower Button is
// the person's own gesture, so it may apply what an agent or a relayed command could only ask for.
// The pane draws `confirm-override:<key>` and `dismiss-override:<key>` for each pending override.
import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { Override, SceneEvent } from '../types'
import { PERMANENT_OVERRIDES_KEY } from './commands/index'
import { CONFIRM_PREFIX, DISMISS_PREFIX } from './commands/overrides'
import { appendEvents, type Ctx } from './context'

const events = atom({ plugin: 'omnis-watchtower', key: 'events' } as const, [] as SceneEvent[])
const sessionOverrides = atom({ plugin: 'omnis-watchtower', key: 'sessionOverrides' } as const, {} as Record<string, Override>)
const pendingOverrides = atom({ plugin: 'omnis-watchtower', key: 'pendingOverrides' } as const, {} as Record<string, Override>)

export const install = (on: On, _ctx: Ctx): void => {
  on('ui.press', { plugin: 'omnis-watchtower' }, async ($, e, next) => {
    const confirm = e.element.startsWith(CONFIRM_PREFIX)
    if (!confirm && !e.element.startsWith(DISMISS_PREFIX)) return next(e)
    const k = e.element.slice((confirm ? CONFIRM_PREFIX : DISMISS_PREFIX).length)
    const pending = (await read($, pendingOverrides))[k]
    await update($, pendingOverrides, ({ [k]: _, ...rest }) => rest)
    if (!pending || !confirm) return { element: e.element }

    const now = await $.clock.now()
    const o: Override = { ...pending, at: now, via: 'pane' }
    if (o.scope === 'permanent') {
      const stored = ((await $.store.get(PERMANENT_OVERRIDES_KEY)) ?? {}) as Record<string, Override>
      await $.store.set(PERMANENT_OVERRIDES_KEY, { ...stored, [o.key]: o })
    } else {
      await update($, sessionOverrides, all => ({ ...all, [o.key]: o }))
    }
    await update($, events, l => appendEvents(l, now, { type: 'OverrideApplied', key: o.key, action: o.action, scope: o.scope }))
    $.ui.toast(`Watchtower: ${o.action === 'allow' ? 'allowed' : 'blocked'} ${o.key} ${o.scope === 'permanent' ? 'permanently' : 'for this session'}`)
    return { element: e.element }
  })
}
