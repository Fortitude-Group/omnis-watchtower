// The /watchtower command. Sub-command handlers live in their own files and are pure: they read a
// snapshot and return text plus actions. This file is the only one that turns actions into engine
// calls, because `$` may not cross an import (see context.ts).
import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { appendEvents, type Ctx } from '../context'
import type { Investigation, Override, SceneEvent, WatchtowerTheme } from '../../types'
import { handlers, helpText, KNOWN, type Reply, type Snapshot } from './registry'
// Each handler file registers its sub-command with addSubcommand when it loads
import './open'
import './theme'
import './legend'
import './status'
import './demo'
import './overrides'

export { addSubcommand, helpText, type Action, type Handler, type Reply, type Snapshot } from './registry'

const events = atom({ plugin: 'omnis-watchtower', key: 'events' } as const, [] as SceneEvent[])
const investigations = atom({ plugin: 'omnis-watchtower', key: 'investigations' } as const, {} as Record<string, Investigation>)
const sessionOverrides = atom({ plugin: 'omnis-watchtower', key: 'sessionOverrides' } as const, {} as Record<string, Override>)
const theme = atom({ plugin: 'omnis-watchtower', key: 'theme' } as const, 'radar' as WatchtowerTheme)

export const PANE_ID = 'watchtower'

export const splitArgs = (args: string): string[] => args.trim().split(/\s+/).filter(Boolean)

/** Pure dispatch, exported for unit tests. */
export const dispatch = (args: string, snap: Snapshot): Reply => {
  const [sub = '', ...rest] = splitArgs(args)
  const handler = handlers.get(sub)
  if (handler) return handler(rest, snap)
  if (KNOWN.includes(sub)) return { text: `/watchtower ${sub} is not available yet.` }
  return { text: `Unknown sub-command "${sub}".\n\n${helpText()}` }
}

export const PERMANENT_OVERRIDES_KEY = 'wt:overrides:permanent'
export const VERDICT_CACHE_PREFIX = 'wt:verdict:'

export const install = (on: On, ctx: Ctx): void => {
  on('command.run', { command: 'watchtower' }, async ($, e) => {
    const stored = await $.store.get(PERMANENT_OVERRIDES_KEY)
    const snap: Snapshot = {
      origin: e.origin?.kind ?? 'unclassified',
      now: await $.clock.now(),
      theme: await read($, theme),
      events: await read($, events),
      investigations: await read($, investigations),
      sessionOverrides: await read($, sessionOverrides),
      permanentOverrides: (stored ?? {}) as Record<string, Override>,
      ctx,
    }
    const reply = dispatch(e.args, snap)

    for (const action of reply.actions ?? []) {
      switch (action.type) {
        case 'openPane':
          await $.ui.open({ id: PANE_ID, title: 'Omnis Watchtower' })
          break
        case 'setTheme':
          await update($, theme, () => action.theme)
          break
        case 'putOverride': {
          const o = action.override
          if (o.scope === 'permanent') {
            await $.store.set(PERMANENT_OVERRIDES_KEY, { ...snap.permanentOverrides, [o.key]: o })
          } else {
            await update($, sessionOverrides, all => ({ ...all, [o.key]: o }))
          }
          await update($, events, l => appendEvents(l, snap.now, { type: 'OverrideApplied', key: o.key, action: o.action, scope: o.scope }))
          break
        }
        case 'removeOverride': {
          const { [action.key]: _s, ...session } = snap.sessionOverrides
          const { [action.key]: _p, ...permanent } = snap.permanentOverrides
          await update($, sessionOverrides, () => session)
          await $.store.set(PERMANENT_OVERRIDES_KEY, permanent)
          break
        }
        case 'requeueInvestigation':
          await $.store.delete(action.verdictCacheKey)
          await update($, investigations, all => ({ ...all, [action.investigation.key]: action.investigation }))
          break
        case 'startDemo':
          await $.ui.open({ id: PANE_ID, title: 'Omnis Watchtower — demo' })
          break
      }
    }
    return { text: reply.text }
  })
}
