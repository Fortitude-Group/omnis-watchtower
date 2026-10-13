import type { Fact, PackageFacts, PackageRef } from '../core/model'
import { key } from '../core/model'
import { fetchDepsDev } from './depsdev'
import { fetchNpmDownloadsBulk, fetchPypiDownloads } from './downloads'
import { fetchNpmManifest } from './npm'
import { fetchOsv } from './osv'
import type { SourceIo } from './ports'
import type { PrivateConfig, Resolution } from './project-config'
import { resolvePackage } from './project-config'
import { fetchPypi } from './pypi'

export type PartialFacts = Partial<Omit<PackageFacts, 'ref'>>

export const unknownFacts = (ref: PackageRef): PackageFacts => ({
  ref,
  exists: 'unknown',
  resolvedVersion: 'unknown',
  versions: 'unknown',
  installScripts: 'unknown',
  sdistOnly: 'unknown',
  weeklyDownloads: 'unknown',
  maintainerCount: 'unknown',
  repository: 'unknown',
  osv: 'unknown',
})

// Earlier partials win; a later one only fills a field still unknown
export const mergeFacts = (ref: PackageRef, ...partials: PartialFacts[]): PackageFacts => {
  const out = unknownFacts(ref) as Record<string, unknown>
  for (const partial of partials) {
    for (const [field, value] of Object.entries(partial)) {
      if (value === undefined || value === 'unknown') continue
      if (out[field] === 'unknown' || out[field] === undefined) out[field] = value
    }
  }
  return out as PackageFacts
}

const isKnown = <T>(v: Fact<T>): v is T => v !== 'unknown'

// Dependency confusion: does the public registry also serve this private name?
//
// Trade-off: this GET itself tells the public registry (and anything logging its traffic)
// that someone looked up the private name. FR-012 and US1-6 ask for dependency-confusion
// detection, and there is no way to learn whether a public name exists without asking, so
// the check is kept to one existence request against the registry, with no downloads,
// deps.dev or OSV calls. The answer is cached like any other registry lookup.
const shadowCheck = async (io: SourceIo, ref: PackageRef): Promise<boolean | undefined> => {
  const bare = { ecosystem: ref.ecosystem, name: ref.name }
  const facts = ref.ecosystem === 'npm' ? await fetchNpmManifest(io, bare) : await fetchPypi(io, bare)
  return isKnown(facts.exists ?? 'unknown') ? facts.exists as boolean : undefined
}

const privateFacts = async (io: SourceIo, ref: PackageRef, registry: string): Promise<PackageFacts> => {
  const facts: PackageFacts = { ...unknownFacts(ref), privateRegistry: registry }
  const shadows = await shadowCheck(io, ref)
  if (shadows !== undefined) facts.shadowsPrivate = shadows
  return facts
}

const publicFacts = async (io: SourceIo, ref: PackageRef, downloads: Promise<Record<string, Fact<number>>>): Promise<PackageFacts> => {
  if (ref.ecosystem === 'npm') {
    const [manifest, deps, dl, osv] = await Promise.all([
      fetchNpmManifest(io, ref),
      fetchDepsDev(io, ref),
      downloads.then(all => all[ref.name] ?? 'unknown'),
      fetchOsv(io, ref),
    ])
    return mergeFacts(ref, manifest, deps, { weeklyDownloads: dl, osv, sdistOnly: false })
  }
  const [meta, dl, osv] = await Promise.all([fetchPypi(io, ref), fetchPypiDownloads(io, ref.name), fetchOsv(io, ref)])
  return mergeFacts(ref, meta, { weeklyDownloads: dl, osv })
}

// One PackageFacts per ref, in order. Every source runs in parallel; http.ts's limiter caps
// the requests in flight. npm downloads for the whole batch go out as one bulk request.
export const gatherFacts = async (io: SourceIo, refs: PackageRef[], config: PrivateConfig): Promise<PackageFacts[]> => {
  const resolutions = new Map<string, Resolution>(refs.map(ref => [key(ref), resolvePackage(ref, config)]))
  const npmNames = refs
    .filter(ref => ref.ecosystem === 'npm' && resolutions.get(key(ref))!.kind !== 'private')
    .map(ref => ref.name)
  const downloads = npmNames.length
    ? fetchNpmDownloadsBulk(io, npmNames).catch(() => ({}) as Record<string, Fact<number>>)
    : Promise.resolve({})

  const inFlight = new Map<string, Promise<PackageFacts>>()
  const one = async (ref: PackageRef): Promise<PackageFacts> => {
    const resolution = resolutions.get(key(ref))!
    if (resolution.kind === 'private') return privateFacts(io, ref, resolution.registry)
    const facts = await publicFacts(io, ref, downloads)
    // Behind a mirror or a private extra index, a name the public registry lacks can only
    // come from the private index: report it as private rather than as nonexistent
    if (resolution.kind === 'mirror' && facts.exists === false) return { ...unknownFacts(ref), privateRegistry: resolution.registry }
    return facts
  }
  return Promise.all(refs.map(ref => {
    const id = key(ref)
    let pending = inFlight.get(id)
    if (!pending) inFlight.set(id, pending = one(ref))
    return pending.then(facts => ({ ...facts, ref }))
  }))
}
