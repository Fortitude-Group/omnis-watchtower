// FR-035 cooldown pin: splice pinned package spellings back into the agent's command.

import type { InstallTool, PackageRef } from '../model'

export type Replacement = { span: [number, number]; text: string }

const UNSAFE_BARE = /[\s|&;<>()$`\\"'*?#{}!]/

const quoteWith = (text: string, q: string): string =>
  q === "'" ? `'${text.replace(/'/g, `'\\''`)}'` : `"${text.replace(/["$`\\]/g, '\\$&')}"`

/** The pinned spelling of a package for a tool: `name@1.2.3` (npm family) or `name[extras]==1.2.3` (pip, uv, pipx, poetry: poetry's docs give `poetry add pendulum==2.0.5` as the exact pin; `@2.0.5` is documented only with ^/~ constraints). */
export const pinnedToken = (ref: PackageRef, version: string, tool: InstallTool): string => {
  const extras = ref.extras && ref.extras.length > 0 ? `[${ref.extras.join(',')}]` : ''
  if (tool === 'pip' || tool === 'uv' || tool === 'pipx') return `${ref.name}${extras}==${version}`
  if (tool === 'poetry') return `${ref.name}${extras}==${version}`
  return `${ref.name}@${version}`
}

/**
 * Splices replacements into a command right to left. A replaced token that was wholly quoted keeps
 * its quote character; an unquoted one is single-quoted only if the new text needs it. Spans that
 * are out of range or overlap a later one are skipped.
 */
export const rewriteCommand = (command: string, replacements: Replacement[]): string => {
  let out = command
  let limit = command.length
  const ordered = [...replacements].sort((a, b) => b.span[0] - a.span[0])
  for (const { span, text } of ordered) {
    const [start, end] = span
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > limit || start >= end) continue
    const original = command.slice(start, end)
    const q = original[0]
    const wrapped = original.length >= 2 && (q === "'" || q === '"') && original[original.length - 1] === q
    const next = wrapped ? quoteWith(text, q) : UNSAFE_BARE.test(text) ? quoteWith(text, "'") : text
    out = out.slice(0, start) + next + out.slice(end)
    limit = start
  }
  return out
}
