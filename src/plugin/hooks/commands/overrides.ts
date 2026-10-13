// /watchtower allow | block | overrides | recheck (T071). Pure handlers: (args, snapshot) => { text, actions }.
//
// The origin rule (research R1, FR-029): an override applies only when the person typed the
// command at their own prompt (`origin === 'composer'`). From anywhere else it is parked as a
// pending override, which the person confirms with a Watchtower pane Button (hooks/press.ts).
import { key, nameKey, normalise } from '../../core/model'
import type { Ecosystem, Override } from '../../core/model'
import { parseSpec } from '../../core/overrides'
import { addSubcommand, type Action, type Reply, type Snapshot } from './registry'

export const CONFIRM_PREFIX = 'confirm-override:'
export const DISMISS_PREFIX = 'dismiss-override:'

const ECOSYSTEMS: Ecosystem[] = ['npm', 'pypi']

/** Ecosystems a bare name has been seen in this session, from the event log. */
export const ecosystemsSeen = (name: string, snap: Pick<Snapshot, 'events'>): Ecosystem[] => {
  const seen = new Set<Ecosystem>()
  for (const ev of snap.events) {
    if (ev.type !== 'PackageIntercepted' && ev.type !== 'PackageScored') continue
    if (ev.ref.name === normalise(ev.ref.ecosystem, name)) seen.add(ev.ref.ecosystem)
  }
  return ECOSYSTEMS.filter(e => seen.has(e))
}

const resolve = (spec: string, snap: Snapshot) => {
  const bare = spec.includes(':') ? spec : spec.replace(/(.)@.*$/, '$1')
  return parseSpec(spec, ecosystemsSeen(bare, snap))
}

/** Button label for a pending override, as the pane draws it. */
export const confirmLabel = (o: Pick<Override, 'action' | 'key' | 'scope'>): string =>
  `${o.action === 'allow' ? 'Allow' : 'Block'} ${o.key} ${o.scope === 'permanent' ? 'permanently' : 'for this session'}`

const describe = (o: Pick<Override, 'action' | 'key' | 'scope'>): string =>
  `${o.action === 'allow' ? 'Allowed' : 'Blocked'} ${o.key} ${o.scope === 'permanent' ? 'permanently' : 'for this session'}.`

const notHuman = (sub: string, snap: Snapshot): string =>
  `Watchtower overrides need your own hand: this /watchtower ${sub} did not come from your prompt (origin: ${snap.origin}), so it was not applied.`

const override = (action: 'allow' | 'block') => (args: string[], snap: Snapshot): Reply => {
  const permanent = args.includes('--permanent')
  const specs = args.filter(a => !a.startsWith('--'))
  if (specs.length !== 1) return { text: `Usage: /watchtower ${action} <eco:pkg>${action === 'allow' ? '[@ver]' : ''} [--permanent]` }
  const parsed = resolve(specs[0]!, snap)
  if (!parsed.ok) return { text: `Cannot ${action} ${specs[0]}: ${parsed.message}.` }
  const o: Override = { key: parsed.key, action, scope: permanent ? 'permanent' : 'session', at: snap.now, via: 'composer' }

  if (snap.origin !== 'composer') {
    const pending: Override = { ...o, via: 'pane' }
    return {
      text: [
        notHuman(action, snap),
        `To apply it, press "${confirmLabel(pending)}" in the Watchtower pane (/watchtower opens it), or type the command at your prompt yourself.`,
      ].join('\n'),
      actions: [{ type: 'putPendingOverride', override: pending }],
    }
  }
  return { text: describe(o), actions: [{ type: 'putOverride', override: o }] }
}

const line = (o: Override): string => `  ${o.action.padEnd(5)} ${o.key.padEnd(40)} ${o.scope}${o.via === 'pane' ? ' (confirmed in pane)' : ''}`

/** The overrides listing: applied ones first, then those waiting for the person's confirmation. */
export const listOverrides = (snap: Pick<Snapshot, 'sessionOverrides' | 'permanentOverrides' | 'pendingOverrides'>): string => {
  const applied = [...Object.values(snap.permanentOverrides), ...Object.values(snap.sessionOverrides)].sort((a, b) => a.key.localeCompare(b.key))
  const pending = Object.values(snap.pendingOverrides)
  const out = applied.length ? ['Overrides:', ...applied.map(line)] : ['No overrides.']
  if (pending.length) {
    out.push('', 'Waiting for your confirmation (requested from outside your prompt):')
    out.push(...pending.map(o => `  ${confirmLabel(o)}: press it in the Watchtower pane`))
  }
  return out.join('\n')
}

const overrides = (args: string[], snap: Snapshot): Reply => {
  if (args.length === 0) return { text: listOverrides(snap) }
  if (args[0] !== 'clear' || args.length !== 2) return { text: 'Usage: /watchtower overrides [clear <eco:pkg>]' }
  if (snap.origin !== 'composer') return { text: `${notHuman('overrides clear', snap)}\nType it at your prompt yourself to remove the override.` }
  const parsed = resolve(args[1]!, snap)
  if (!parsed.ok) return { text: `Cannot clear ${args[1]}: ${parsed.message}.` }
  const known = parsed.key in snap.sessionOverrides || parsed.key in snap.permanentOverrides || parsed.key in snap.pendingOverrides
  if (!known) return { text: `There is no override for ${parsed.key}.` }
  return { text: `Removed the override for ${parsed.key}.`, actions: [{ type: 'removeOverride', key: parsed.key }] }
}

const recheck = (args: string[], snap: Snapshot): Reply => {
  if (args.length !== 1) return { text: 'Usage: /watchtower recheck <eco:pkg>[@ver]' }
  const parsed = resolve(args[0]!, snap)
  if (!parsed.ok) return { text: `Cannot recheck ${args[0]}: ${parsed.message}.` }
  const ref = { ecosystem: parsed.ecosystem, name: parsed.name, ...(parsed.version ? { version: parsed.version } : {}) }
  // A bare name rechecks every version already under investigation, plus the unversioned install
  const keys = new Set([key(ref)])
  if (!parsed.version) {
    for (const inv of Object.values(snap.investigations)) if (nameKey(inv.ref) === nameKey(ref)) keys.add(inv.key)
  }
  const deadline = snap.now + snap.ctx.options.sentinelTimeoutSec * 1000
  const actions: Action[] = [...keys].map(k => {
    const prior = snap.investigations[k]
    return {
      type: 'requeueInvestigation',
      verdictCacheKey: `wt:verdict:${k}`,
      investigation: {
        key: k,
        ref: prior?.ref ?? ref,
        status: 'queued',
        attempts: 0,
        startedAt: snap.now,
        deadline,
        reasons: prior?.reasons.length ? prior.reasons : ['the developer asked for a fresh investigation'],
        // A recheck never weakens a hard signal: a Sentinel "allow" still can't pass it (FR-015)
        hasHardSignal: prior?.hasHardSignal ?? false,
      },
    }
  })
  return { text: `Dropped the cached verdict for ${nameKey(ref)}${parsed.version ? `@${parsed.version}` : ''}; a Sentinel will investigate on the next shell command.`, actions }
}

addSubcommand('allow', override('allow'))
addSubcommand('block', override('block'))
addSubcommand('overrides', overrides)
addSubcommand('recheck', recheck)
