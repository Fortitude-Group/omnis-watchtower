// Developer overrides: spec parsing and precedence (data-model.md Override, FR-028).

import type { Ecosystem, Override, PackageRef } from './model'
import { key, nameKey, normalise } from './model'

export type SpecResult =
  | { ok: true; ecosystem: Ecosystem; name: string; version?: string; key: string }
  | { ok: false; error: 'ambiguous' | 'invalid'; message: string }

const ECOSYSTEMS: Ecosystem[] = ['npm', 'pypi']

/** Parses `<eco:pkg>[@ver]`. A bare name needs `ecosystems` to hold exactly one ecosystem. */
export const parseSpec = (spec: string, ecosystems: Ecosystem[] = []): SpecResult => {
  let rest = spec.trim()
  if (rest === '') return { ok: false, error: 'invalid', message: 'empty package spec' }
  let ecosystem: Ecosystem
  const colon = rest.indexOf(':')
  if (colon > 0) {
    const prefix = rest.slice(0, colon).toLowerCase()
    if (!ECOSYSTEMS.includes(prefix as Ecosystem)) {
      return { ok: false, error: 'invalid', message: `unknown ecosystem "${prefix}" (use npm: or pypi:)` }
    }
    ecosystem = prefix as Ecosystem
    rest = rest.slice(colon + 1)
  } else if (ecosystems.length === 1) {
    ecosystem = ecosystems[0] as Ecosystem
  } else {
    return { ok: false, error: 'ambiguous', message: `"${rest}" needs an ecosystem: npm:${rest} or pypi:${rest}` }
  }
  // The version separator is the last '@' after position 0 (a leading '@' is an npm scope).
  const at = rest.lastIndexOf('@')
  const version = at > 0 ? rest.slice(at + 1) : undefined
  const rawName = at > 0 ? rest.slice(0, at) : rest
  if (rawName === '' || version === '') {
    return { ok: false, error: 'invalid', message: `cannot read package spec "${spec}"` }
  }
  const name = normalise(ecosystem, rawName)
  const k = version ? key({ ecosystem, name, version }) : nameKey({ ecosystem, name })
  return { ok: true, ecosystem, name, ...(version ? { version } : {}), key: k }
}

const matches = (o: Override, ref: PackageRef): boolean =>
  o.key === nameKey(ref) || (ref.version !== undefined && o.key === key(ref))

/** Block beats allow whatever the scope; within an action the most recent `at` wins. */
export const matchOverride = (
  ref: PackageRef,
  session: Record<string, Override>,
  permanent: Record<string, Override>
): Override | undefined => {
  let best: Override | undefined
  for (const o of [...Object.values(permanent), ...Object.values(session)]) {
    if (!matches(o, ref)) continue
    if (!best) best = o
    else if (o.action !== best.action) best = o.action === 'block' ? o : best
    else if (o.at >= best.at) best = o
  }
  return best
}
