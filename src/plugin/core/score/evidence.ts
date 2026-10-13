// One plain-English line per signal (FR-008), and the alternative offered on refusal (FR-010).

import type { Ecosystem, Signal } from '../model'

const registry = (e: Ecosystem): string => (e === 'npm' ? 'npm' : 'PyPI')

const count = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export const describeAge = (ms: number): string => {
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return 'less than an hour'
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  return `${days} days`
}

export const evidence = {
  exists: (e: Ecosystem, name: string, state: Signal['state']): string =>
    state === 'present'
      ? `${name} exists on ${registry(e)}`
      : state === 'absent'
        ? `${name} does not exist on ${registry(e)}; the name may have been invented`
        : `Could not reach ${registry(e)} to confirm ${name} exists`,

  malware: (state: Signal['state'], ids: string[] = [], summary?: string): string =>
    state === 'present'
      ? `Known malware advisory ${ids.join(', ')}${summary ? `: "${summary}"` : ''}`
      : state === 'absent'
        ? 'No known malware advisory'
        : 'Could not check the malware advisory database, so the package cannot be cleared',

  malwareVersionUnclear: (ids: string[]): string =>
    `Malware advisory ${ids.join(', ')} names specific versions, and the version to be installed is unknown`,

  dependencyConfusion: (name: string, state: Signal['state']): string =>
    state === 'present'
      ? `A public package named ${name} shadows a private package of the same name (dependency confusion)`
      : 'Does not shadow a private package',

  privateRegistry: (state: Signal['state'], where?: string): string =>
    state === 'present' ? `Resolves to a private source (${where ?? 'private registry'})` : 'Public registry package',

  packageAge: (state: Signal['state'], ageMs?: number): string =>
    state === 'unknown'
      ? 'First publish date unknown'
      : `First published ${describeAge(ageMs ?? 0)} ago${state === 'present' ? ' (under 7 days)' : ''}`,

  versionAge: (state: Signal['state'], version?: string, ageMs?: number): string =>
    state === 'unknown'
      ? 'Publish date of the requested version unknown'
      : `Version ${version ?? '?'} published ${describeAge(ageMs ?? 0)} ago${state === 'present' ? ' (under 72 hours)' : ''}`,

  typosquat: (state: Signal['state'], imitates?: string, distance?: number): string =>
    state === 'present'
      ? distance === 0
        ? `Name is a look-alike of the popular package ${imitates}`
        : `Name is ${distance === 1 ? 'one edit' : `${distance} edits`} away from the popular package ${imitates}`
      : 'Name does not resemble a popular package',

  installScripts: (state: Signal['state'], scripts: string[] = []): string =>
    state === 'present'
      ? `Runs install-time scripts: ${scripts.join(', ')}`
      : state === 'absent'
        ? 'No install-time scripts'
        : 'Install scripts unknown',

  sdistOnly: (state: Signal['state']): string =>
    state === 'present'
      ? 'Source distribution only (no wheel), so setup code runs at install'
      : state === 'absent'
        ? 'Ships a wheel'
        : 'Distribution types unknown',

  lowAdoption: (state: Signal['state'], weekly?: number): string =>
    state === 'unknown' ? 'Download count unknown' : `${count(weekly ?? 0)} downloads in the last week`,

  singleMaintainerLowAdoption: (state: Signal['state']): string =>
    state === 'present'
      ? 'A single maintainer and fewer than 1,000 downloads a week'
      : state === 'absent'
        ? 'Not a single-maintainer, low-adoption package'
        : 'Maintainer count unknown',

  noRepository: (state: Signal['state']): string =>
    state === 'present' ? 'No linked source repository' : state === 'absent' ? 'Links a source repository' : 'Source repository unknown',

  allowlisted: (name: string): string => `${name} matches the private package allowlist`,
}

/**
 * The signals worth showing: suspicious ones that are present, a package that does not exist
 * (`exists` is the one signal whose `absent` state is the bad one), and unknowns that block
 * clearing. A package that exists says nothing, so it is left out.
 */
export const contributing = (signals: Signal[]): Signal[] =>
  signals.filter(s =>
    s.kind === 'exists'
      ? s.state !== 'present'
      : s.state === 'present' || (s.state === 'unknown' && (s.weight === 'hard' || s.kind === 'malware')),
  )

export const evidenceLines = (signals: Signal[]): string[] => contributing(signals).map(s => s.evidence)

/** The imitated popular name, when the package looks like a typosquat. */
export const alternativeFor = (signals: Signal[]): string | undefined =>
  signals.find(s => s.kind === 'typosquat' && s.state === 'present' && s.imitates)?.imitates
