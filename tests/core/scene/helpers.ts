import type { PackageRef } from '../../../src/plugin/types'
import type { SceneEvent, SceneEventInput } from '../../../src/plugin/core/scene/events'

let seq = 0
export const ev = (input: SceneEventInput, at = 0): SceneEvent => ({ ...input, at, seq: seq++ }) as SceneEvent

export const ref = (name: string, ecosystem: 'npm' | 'pypi' = 'npm', version = '1.0.0'): PackageRef => ({ ecosystem, name, version })

export const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

/** FNV-1a over a string, as hex. */
export const fnv = (s: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
