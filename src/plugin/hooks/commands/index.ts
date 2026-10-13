// The /watchtower command. Sub-command handlers live in their own files and are pure: they read a
// snapshot and return text plus actions. This file is the only one that turns actions into engine
// calls, because `$` may not cross an import (see context.ts).
import { atom, read, update } from 'claude-code'
import type { CommandRunInput, On } from 'claude-code'

import { appendEvents, type Ctx } from '../context'
import type { Investigation, Override, SceneEvent, WatchtowerTheme } from '../../types'

const events = atom({ plugin: 'omnis-watchtower', key: 'events' } as const, [] as SceneEvent[])
const investigations = atom({ plugin: 'omnis-watchtower', key: 'investigations' } as const, {} as Record<string, Investigation>)
const sessionOverrides = atom({ plugin: 'omnis-watchtower', key: 'sessionOverrides' } as const, {} as Record<string, Override>)
const theme = atom({ plugin: 'omnis-watchtower', key: 'theme' } as const, 'radar' as WatchtowerTheme)

export const PANE_ID = 'watchtower'

export type Snapshot = {
  /** 'unclassified' when the engine stamped no origin: treated as untrusted (never 'composer'). */
  origin: CommandRunInput['origin']['kind'] | 'unclassified'
  now: number
  theme: WatchtowerTheme
  events: SceneEvent[]
  investigations: Record<string, Investigation>
  sessionOverrides: Record<string, Override>
  permanentOverrides: Record<string, Override>
  ctx: Ctx
}

export type Action =
  | { type: 'openPane' }
  | { type: 'setTheme'; theme: WatchtowerTheme }
  | { type: 'putOverride'; override: Override }
  | { type: 'removeOverride'; key: string }
  | { type: 'requeueInvestigation'; investigation: Investigation; verdictCacheKey: string }
  | { type: 'startDemo' }

export type Reply = { text: string; actions?: Action[] }

/** A sub-command handler. `args` excludes the sub-command name itself. */
export type Handler = (args: string[], snap: Snapshot) => Reply

const handlers = new Map<string, Handler>()

/** Sub-command files call this at module load; '' is bare /watchtower. */
export const addSubcommand = (name: string, handler: Handler): void => {
  handlers.set(name, handler)
}

export const KNOWN = ['', 'theme', 'legend', 'demo', 'status', 'allow', 'block', 'overrides', 'recheck']

export const helpText = (): string =>
  [
    'Omnis Watchtower commands:',
    '  /watchtower                         open mission control',
    '  /watchtower theme <radar|cracktro>  switch theme',
    '  /watchtower legend                  explain every figure on screen',
    '  /watchtower demo                    replay the scripted attack (offline)',
    '  /watchtower status                  totals, investigations, overrides, faults',
    '  /watchtower allow <eco:pkg>[@ver] [--permanent]   human only',
    '  /watchtower block <eco:pkg> [--permanent]         human only',
    '  /watchtower overrides [clear <eco:pkg>]',
    '  /watchtower recheck <eco:pkg>[@ver]',
  ].join('\n')

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
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'watchtower', description: 'Omnis Watchtower: mission control and supply-chain tripwire' })
    return next(e)
  })

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
