// Corpus facts come from the real adapters over the recorded responses (Principle I).

import { gatherFacts } from '../../src/plugin/adapters/facts'
import { resetLimiter } from '../../src/plugin/adapters/http'
import { npmManifestUrl } from '../../src/plugin/adapters/npm'
import { OSV_URL, osvQuery } from '../../src/plugin/adapters/osv'
import { emptyConfig, type PrivateConfig } from '../../src/plugin/adapters/project-config'
import type { PackageFacts, PackageRef } from '../../src/plugin/core/model'
import { fixtureIo } from '../adapters/fixture-io'
import { allFixtures } from '../fixtures/http'

type Fixture = { status: number; body: unknown }

export const gather = async (refs: PackageRef[], config: PrivateConfig = emptyConfig(), extra: Record<string, Fixture> = {}): Promise<PackageFacts[]> => {
  resetLimiter()
  return gatherFacts(fixtureIo(extra).io, refs, config)
}

/**
 * Recordings exist only for `latest` and the version-less OSV query. For an explicit npm
 * version, serve the recorded manifest under that version, and the recorded advisories for the
 * versioned OSV query (OSV filters by version server-side; the scorer filters again).
 */
export const versionedNpm = (name: string, version: string): Record<string, Fixture> => {
  const latest = allFixtures[`GET ${npmManifestUrl({ ecosystem: 'npm', name })}`]
  const osv = allFixtures[`POST ${OSV_URL} ${JSON.stringify(osvQuery({ ecosystem: 'npm', name }))}`]
  if (!latest || !osv) throw new Error(`no recordings for npm:${name}`)
  return {
    [`GET ${npmManifestUrl({ ecosystem: 'npm', name, version })}`]: { status: 200, body: { ...(latest.body as object), version } },
    [`POST ${OSV_URL} ${JSON.stringify(osvQuery({ ecosystem: 'npm', name, version }))}`]: osv,
  }
}
