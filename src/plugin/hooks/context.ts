// Shared wiring for the hook modules: state references, typed options and pure event helpers.
//
// Engine rule (verified with `claude plugin validate`): `$` is never passed across an import. A hook
// file spells every engine call as `$.noun.method(...)` itself (or passes `$` to a top-level function
// in the same file, or to the kit's own `update`/`read`). So nothing here takes `$`: shared logic is
// pure, and each hook file applies it with its own `update($, atom, fn)`. State atoms must also be
// declared in the file that reads or writes them (the scan reads them literally), so each hook
// file declares the atoms it uses; types/index.d.ts keeps their shapes in one place.
import type { PluginOptions } from 'claude-code'

import type { SceneEvent, WatchtowerTheme } from '../types'
import type { SceneEventInput } from '../core/scene/events'

export const EVENT_LIMIT = 500

/** Pure: the event list with `inputs` appended, numbered and capped. Use as `update($, events, l => appendEvents(l, at, ...))`. */
export const appendEvents = (list: SceneEvent[], at: number, ...inputs: SceneEventInput[]): SceneEvent[] => {
  let seq = list.at(-1)?.seq ?? 0
  const added = inputs.map(input => ({ ...input, at, seq: ++seq }) as SceneEvent)
  return [...list, ...added].slice(-EVENT_LIMIT)
}

export type Options = {
  mode: 'enforce' | 'warn-only'
  strict: boolean
  theme: WatchtowerTheme
  autoOpen: boolean
  reducedMotion: boolean
  sentinelModel: 'haiku' | 'sonnet'
  sentinelTimeoutSec: number
  privateAllowlist: string[]
  /** Test-only: makes the gate throw, to exercise fail-open/strict (T072). Not in userConfig. */
  faultInjection: boolean
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

/** Reads userConfig values with the manifest's defaults; out-of-range values fall back safely. */
export const readOptions = (o: PluginOptions): Options => {
  const timeout = typeof o.sentinelTimeoutSec === 'number' ? o.sentinelTimeoutSec : 180
  return {
    mode: pick(o.mode, ['enforce', 'warn-only'], 'enforce'),
    strict: o.strict === true,
    theme: pick(o.theme, ['radar', 'cracktro'], 'radar'),
    autoOpen: o.autoOpen !== false,
    reducedMotion: o.reducedMotion === true,
    sentinelModel: pick(o.sentinelModel, ['haiku', 'sonnet'], 'haiku'),
    sentinelTimeoutSec: Math.min(900, Math.max(60, timeout)),
    privateAllowlist: typeof o.privateAllowlist === 'string'
      ? o.privateAllowlist.split(',').map(s => s.trim()).filter(Boolean)
      : [],
    faultInjection: o.faultInjection === true,
  }
}

/** What every area module receives from register.ts. */
export type Ctx = { options: Options }
