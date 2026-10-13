// Cooldown pin (FR-035): the newest stable release that has been public for at least 72 hours.

import type { Ecosystem, PackageFacts, PackageRef } from '../model'
import { NEW_VERSION_MS } from './signals'

const PEP440_PRE = /(a|b|c|rc|alpha|beta|pre|preview|dev)[-_.]?\d*/i

export const isPrerelease = (ecosystem: Ecosystem, version: string): boolean => {
  if (ecosystem === 'npm') return version.replace(/\+.*$/, '').includes('-')
  return PEP440_PRE.test(version.replace(/^\d+!/, '').replace(/\+.*$/, ''))
}

/** Compares the leading dotted numbers only; enough to order stable releases. */
export const compareVersions = (a: string, b: string): number => {
  const nums = (v: string): number[] => (/^v?(\d+(?:\.\d+)*)/.exec(v.replace(/^\d+!/, ''))?.[1] ?? '0').split('.').map(Number)
  const x = nums(a)
  const y = nums(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export const versionRequested = (ref: PackageRef): boolean => ref.version !== undefined && ref.version !== 'latest'

/**
 * The highest stable version, no higher than the resolved latest, published at least 72 h
 * before `now`. Highest by version rather than by date, so a backport to an old major line
 * published yesterday never becomes the pin.
 */
export const cooldownPin = (facts: PackageFacts, now: number): string | undefined => {
  if (facts.versions === 'unknown') return undefined
  const latest = facts.resolvedVersion
  let best: string | undefined
  for (const v of facts.versions) {
    const t = v.publishedAt ? Date.parse(v.publishedAt) : NaN
    if (!Number.isFinite(t) || now - t < NEW_VERSION_MS) continue
    if (isPrerelease(facts.ref.ecosystem, v.version)) continue
    if (latest !== 'unknown' && compareVersions(v.version, latest) >= 0) continue
    if (!best || compareVersions(v.version, best) > 0) best = v.version
  }
  return best
}
