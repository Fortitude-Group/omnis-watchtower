// /watchtower status (T064): session totals, investigations still open and their age, overrides
// in force and any current fault, as plain text. Pure handler.
import { formatEstimate, totalTokens } from '../../core/data/prices'
import { formatTokens } from '../../core/render/overlay'
import { currentFault, formatAge, sessionTotals } from '../../core/text/status-line'
import type { Override } from '../../types'
import { addSubcommand, type Snapshot } from './registry'

const overrideLines = (all: Record<string, Override>): string[] =>
  Object.values(all)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(o => `  ${o.action === 'allow' ? '✔ allow' : '✖ block'} ${o.key} (${o.scope}, via ${o.via})`)

export const statusText = (snap: Snapshot): string => {
  const t = sessionTotals(snap.events)
  const tokens = totalTokens(t.tokens)
  const spend = t.unpricedTokens > 0
    ? `${formatEstimate(t.estCostUsd)} (excludes ${formatTokens(t.unpricedTokens)} unpriced tokens)`
    : formatEstimate(t.estCostUsd)

  const open = Object.values(snap.investigations)
    .filter(inv => inv.status === 'queued' || inv.status === 'running')
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(inv => `  ◆ ${inv.key} ${inv.status}, ${formatAge(snap.now - inv.startedAt)} old`)

  const overrides = [...overrideLines(snap.sessionOverrides), ...overrideLines(snap.permanentOverrides)]
  const fault = currentFault(snap.events)

  return [
    'Omnis Watchtower status (this session; /watchtower legend explains each figure)',
    '',
    `Intercepts ${t.intercepts} · ✔ passed ${t.passed} · ◆ held ${t.held} · ✖ refused ${t.refused}`,
    `Unverified ${t.unverified} · unchecked ${t.unchecked} · overridden ${t.overridden}`,
    `Tokens ${formatTokens(tokens)} · ${spend}`,
    '',
    open.length ? `Investigations in progress (${open.length}):` : 'Investigations in progress: none',
    ...open,
    '',
    overrides.length ? `Overrides in force (${overrides.length}):` : 'Overrides in force: none',
    ...overrides,
    '',
    fault ? `⚠ FAULT in the ${fault.where}: ${fault.message}` : 'Faults: none',
  ].join('\n')
}

addSubcommand('status', (_args, snap) => ({ text: statusText(snap) }))
