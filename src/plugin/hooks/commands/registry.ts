// The /watchtower sub-command registry: types and the handler map. Kept apart from index.ts so the
// handler files can import it without a cycle (index.ts imports every handler file).
import type { CommandRunInput } from 'claude-code'

import type { Ctx } from '../context'
import type { Investigation, Override, SceneEvent, WatchtowerTheme } from '../../types'

export type Snapshot = {
  /** 'unclassified' when the engine stamped no origin: treated as untrusted (never 'composer'). */
  origin: CommandRunInput['origin']['kind'] | 'unclassified'
  now: number
  theme: WatchtowerTheme
  events: SceneEvent[]
  investigations: Record<string, Investigation>
  sessionOverrides: Record<string, Override>
  permanentOverrides: Record<string, Override>
  /** Overrides asked for from outside the person's prompt, waiting for a pane confirmation. */
  pendingOverrides: Record<string, Override>
  ctx: Ctx
}

export type Action =
  | { type: 'openPane' }
  | { type: 'setTheme'; theme: WatchtowerTheme }
  | { type: 'putOverride'; override: Override }
  | { type: 'removeOverride'; key: string }
  | { type: 'putPendingOverride'; override: Override }
  | { type: 'requeueInvestigation'; investigation: Investigation; verdictCacheKey: string }
  | { type: 'startDemo' }

export type Reply = { text: string; actions?: Action[] }

/** A sub-command handler. `args` excludes the sub-command name itself. */
export type Handler = (args: string[], snap: Snapshot) => Reply

export const handlers = new Map<string, Handler>()

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

