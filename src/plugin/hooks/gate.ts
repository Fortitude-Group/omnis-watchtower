// The tripwire hook (FR-001..FR-018). Every Bash call any agent makes passes through here; the
// decision itself lives in adapters/tripwire.ts, and this file only turns `$` into ports and the
// outcome into an allow, a deny, scene events and queued investigations.
import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { evaluate } from '../adapters/tripwire'
import type { GateOutcome, TripwireIo } from '../adapters/tripwire'
import { key } from '../core/model'
import { evidenceLines } from '../core/score/evidence'
import type { Investigation, Override, SceneEvent, WatchtowerFault } from '../types'
import { PERMANENT_OVERRIDES_KEY } from './commands/index'
import { appendEvents, type Ctx } from './context'

const events = atom({ plugin: 'omnis-watchtower', key: 'events' } as const, [] as SceneEvent[])
const investigations = atom({ plugin: 'omnis-watchtower', key: 'investigations' } as const, {} as Record<string, Investigation>)
const sessionOverrides = atom({ plugin: 'omnis-watchtower', key: 'sessionOverrides' } as const, {} as Record<string, Override>)
const fault = atom({ plugin: 'omnis-watchtower', key: 'fault' } as const, null as WatchtowerFault | null)

const FAULT_TEXT = 'WATCHTOWER FAULT: the supply-chain check failed internally'

/** Scene events for one evaluated command: every package intercepted and scored, every unreadable fragment flagged. */
const sceneEventsFor = (outcome: Exclude<GateOutcome, { kind: 'not-install' }>, agentId: string) => [
  ...outcome.checks.flatMap(({ request, check }) => [
    { type: 'PackageIntercepted' as const, requestId: request.id, agentId, ref: check.ref },
    { type: 'PackageScored' as const, requestId: request.id, ref: check.ref, tier: check.tier, evidence: evidenceLines(check.signals), ...(check.pinnedTo ? { pinnedTo: check.pinnedTo } : {}) },
  ]),
  ...outcome.unchecked.map(({ request, fragment }) => ({
    type: 'PackageScored' as const,
    requestId: request.id,
    ref: { ecosystem: request.tool === 'pip' || request.tool === 'uv' || request.tool === 'poetry' || request.tool === 'pipx' ? 'pypi' as const : 'npm' as const, name: fragment.slice(0, 48) },
    tier: 'unchecked' as const,
    evidence: ['Watchtower could not read this part of the command, so it was allowed unchecked'],
  })),
]

export const install = (on: On, ctx: Ctx): void => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (ctx.options.faultInjection) throw new Error('fault injection (test only)')
    const io: TripwireIo = {
      fetch: (url, init) => $.http.fetch(url, init),
      after: (ms, fn) => $.clock.after(ms, fn),
      store: {
        get: k => $.store.get(k),
        set: (k, v) => $.store.set(k, v),
        delete: k => $.store.delete(k),
      },
      now: () => $.clock.now(),
      readFile: async path => {
        try {
          return await $.fs.read(path)
        } catch {
          return undefined
        }
      },
      // Literal names only (engine scan rule); must cover CONFIG_ENV_NAMES (tests/adapters/project-config.test.ts)
      env: name => {
        switch (name) {
          case 'HOME': return $.env.get('HOME')
          case 'USERPROFILE': return $.env.get('USERPROFILE')
          case 'APPDATA': return $.env.get('APPDATA')
          case 'VIRTUAL_ENV': return $.env.get('VIRTUAL_ENV')
          case 'PIP_CONFIG_FILE': return $.env.get('PIP_CONFIG_FILE')
          case 'PIP_INDEX_URL': return $.env.get('PIP_INDEX_URL')
          case 'PIP_EXTRA_INDEX_URL': return $.env.get('PIP_EXTRA_INDEX_URL')
          case 'npm_config_registry': return $.env.get('npm_config_registry')
          default: return undefined
        }
      },
      cwd: '.',
      overrides: async () => ({
        session: await read($, sessionOverrides),
        permanent: ((await $.store.get(PERMANENT_OVERRIDES_KEY)) ?? {}) as Record<string, Override>,
      }),
      investigations: () => read($, investigations),
    }

    const agentId = e.agentId ?? 'main'
    const outcome = await evaluate(io, e.command, agentId, { mode: ctx.options.mode, allowlist: ctx.options.privateAllowlist })
    if (outcome.kind === 'not-install') return next(e)

    const now = await $.clock.now()
    await update($, events, l => appendEvents(l, now, ...sceneEventsFor(outcome, agentId)))
    if (outcome.toInvestigate.length > 0) {
      const deadline = now + ctx.options.sentinelTimeoutSec * 1000
      await update($, investigations, all => {
        const added = { ...all }
        for (const c of outcome.toInvestigate) {
          const k = key(c.ref)
          if (added[k]?.status === 'queued' || added[k]?.status === 'running') continue
          added[k] = { key: k, ref: c.ref, status: 'queued', attempts: 0, startedAt: now, deadline, reasons: evidenceLines(c.signals), hasHardSignal: false }
        }
        return added
      })
    }

    if (outcome.kind === 'deny') return { deny: outcome.text }
    // FR-035: a cooldown pin runs the rewritten command
    const ran = await next(outcome.rewrite ? { ...e, command: outcome.rewrite } : e)
    return outcome.text && ran.deny === undefined ? { ...ran, context: [...(ran.context ?? []), outcome.text] } : ran
  }).catch(async ($, e, next) => {
    // Our own bug (FR-031): fail open with a loud fault, or closed under strict mode (FR-030)
    const now = await $.clock.now()
    const message = String(next.error?.message ?? 'unknown error').slice(0, 200)
    await update($, fault, () => ({ where: 'gate', message, at: now }))
    await update($, events, l => appendEvents(l, now, { type: 'Fault', where: 'gate', message }))
    return ctx.options.strict ? { deny: `${FAULT_TEXT} (${message}); strict mode refuses the command.` } : next(e)
  })
}
