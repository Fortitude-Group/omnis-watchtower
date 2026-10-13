import type { Ecosystem, PackageRef } from '../core/model'
import { normalisePypi } from '../core/model'
import type { EnvPort, ReadFilePort } from './ports'

export const NPM_PUBLIC = 'https://registry.npmjs.org/'
export const PYPI_PUBLIC = 'https://pypi.org/simple/'

const PUBLIC: Record<Ecosystem, string[]> = {
  npm: ['registry.npmjs.org', 'registry.yarnpkg.com'],
  pypi: ['pypi.org/simple', 'pypi.python.org/simple'],
}

export type NpmrcConfig = { registry?: string, scopes: Record<string, string> }
export type PipConfig = { indexUrl?: string, extraIndexUrls: string[] }

export type PrivateConfig = {
  npm: { registry: string, scopes: Record<string, string> }
  pypi: { indexUrl: string, extraIndexUrls: string[] }
  allowlist: string[]
}

// public: the public registry serves it.
// private: the name is declared private (allowlist, or a scope mapped to a private
//   registry); public sources must not be consulted for it.
// mirror: the default index is not public, or a private extra index sits beside the public
//   one. Such an index usually proxies the public registry, so the name is checked publicly,
//   and only a name the public registry lacks is taken to be private to `registry`.
export type Resolution =
  | { kind: 'public' }
  | { kind: 'private', registry: string, via: 'allowlist' | 'scope' }
  | { kind: 'mirror', registry: string }

export const emptyConfig = (): PrivateConfig => ({
  npm: { registry: NPM_PUBLIC, scopes: {} },
  pypi: { indexUrl: PYPI_PUBLIC, extraIndexUrls: [] },
  allowlist: [],
})

const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2').trim()

// Scheme, credentials and trailing slashes do not change which registry a URL names
const comparable = (url: string) =>
  url.trim().toLowerCase().replace(/^[a-z+]+:\/\//, '').replace(/^[^/@]*@/, '').replace(/\/+$/, '')

export const isPublicRegistry = (ecosystem: Ecosystem, url: string) =>
  PUBLIC[ecosystem].includes(comparable(url))

export const parseNpmrc = (text: string): NpmrcConfig => {
  const out: NpmrcConfig = { scopes: {} }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = unquote(line.slice(eq + 1))
    if (!value) continue
    if (key === 'registry') out.registry = value
    const scope = /^(@[^:\s]+):registry$/.exec(key)?.[1]
    if (scope) out.scopes[scope] = value
  }
  return out
}

// pip reads [global], then the command's own section ([install]) over it. A value may run
// on over indented continuation lines, and extra-index-url holds several URLs.
export const parsePipConf = (text: string): PipConfig => {
  const sections: Record<string, Record<string, string>> = {}
  let section = ''
  let lastKey: string | undefined
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || /^\s*[#;]/.test(raw)) continue
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(raw)
    if (header) {
      section = header[1]!.trim().toLowerCase()
      lastKey = undefined
      continue
    }
    const values = (sections[section] ??= {})
    if (/^\s/.test(raw) && lastKey) {
      values[lastKey] = `${values[lastKey]} ${raw.trim()}`
      continue
    }
    const eq = raw.indexOf('=')
    const colon = raw.indexOf(':')
    const cut = eq < 0 ? colon : colon < 0 ? eq : Math.min(eq, colon)
    if (cut < 0) continue
    lastKey = raw.slice(0, cut).trim().toLowerCase().replace(/_/g, '-')
    values[lastKey] = raw.slice(cut + 1).trim()
  }
  const merged = { ...sections.global, ...sections.install }
  const out: PipConfig = { extraIndexUrls: (merged['extra-index-url'] ?? '').split(/\s+/).filter(Boolean) }
  const index = merged['index-url'] ? unquote(merged['index-url']) : ''
  if (index) out.indexUrl = index
  return out
}

export const parseAllowlist = (raw: string | undefined): string[] =>
  (raw ?? '').split(/[,\s]+/).map(p => p.trim()).filter(Boolean)

const globToRegExp = (glob: string) =>
  new RegExp(`^${glob.split('*').map(part => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`, 'i')

// A pattern may carry an `npm:` or `pypi:` prefix; without one it applies to both
export const matchesAllowlist = (ref: Pick<PackageRef, 'ecosystem' | 'name'>, patterns: string[]) =>
  patterns.some(raw => {
    const prefixed = /^(npm|pypi):(.+)$/i.exec(raw)
    if (prefixed && prefixed[1]!.toLowerCase() !== ref.ecosystem) return false
    const pattern = prefixed ? prefixed[2]! : raw
    if (ref.ecosystem === 'npm') return globToRegExp(pattern.toLowerCase()).test(ref.name.toLowerCase())
    return globToRegExp(normalisePypi(pattern)).test(normalisePypi(ref.name))
  })

const scopeOf = (name: string) => name.startsWith('@') ? name.slice(0, name.indexOf('/')).toLowerCase() : undefined

export const resolvePackage = (ref: Pick<PackageRef, 'ecosystem' | 'name'>, config: PrivateConfig): Resolution => {
  const allowlisted = matchesAllowlist(ref, config.allowlist)
  if (ref.ecosystem === 'npm') {
    const scope = scopeOf(ref.name)
    const scoped = scope ? config.npm.scopes[scope] : undefined
    if (scoped && !isPublicRegistry('npm', scoped)) return { kind: 'private', registry: scoped, via: 'scope' }
    const registry = scoped ?? config.npm.registry
    const isDefaultPublic = isPublicRegistry('npm', registry)
    if (allowlisted) return { kind: 'private', registry: isDefaultPublic ? 'allowlist' : registry, via: 'allowlist' }
    return isDefaultPublic ? { kind: 'public' } : { kind: 'mirror', registry }
  }
  const privateIndexes = [config.pypi.indexUrl, ...config.pypi.extraIndexUrls].filter(url => !isPublicRegistry('pypi', url))
  if (allowlisted) return { kind: 'private', registry: privateIndexes[0] ?? 'allowlist', via: 'allowlist' }
  return privateIndexes[0] ? { kind: 'mirror', registry: privateIndexes[0] } : { kind: 'public' }
}

// Every environment variable the loader reads. The engine's scan wants `$.env.get` called with
// literal names, so hook files answer EnvPort with a switch over exactly this list.
export const CONFIG_ENV_NAMES = ['HOME', 'USERPROFILE', 'APPDATA', 'VIRTUAL_ENV', 'PIP_CONFIG_FILE', 'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL', 'npm_config_registry'] as const
export type ConfigEnvName = (typeof CONFIG_ENV_NAMES)[number]

export type ConfigSources = {
  readFile: ReadFilePort
  env: EnvPort
  cwd: string
  home?: string
  /** The raw `privateAllowlist` user setting (comma-separated globs). */
  allowlist?: string
  /** Index URLs from the install command (`--registry`, `--index-url`); the first is primary. */
  indexUrls?: Partial<Record<Ecosystem, string[]>>
}

const join = (dir: string, file: string) => `${dir.replace(/[\\/]+$/, '')}/${file}`

const read = async (readFile: ReadFilePort, path: string) => {
  try {
    return await readFile(path)
  } catch {
    return undefined
  }
}

const getEnv = async (env: EnvPort, name: string) => {
  try {
    const value = await env(name)
    return value?.trim() || undefined
  } catch {
    return undefined
  }
}

// Precedence, highest first: the command line, the environment, the project's files, the
// user's files. Extra indexes are pooled from every source, since pip consults them all.
export const loadPrivateConfig = async (src: ConfigSources): Promise<PrivateConfig> => {
  const config = emptyConfig()
  config.allowlist = parseAllowlist(src.allowlist)
  const [home, appData, venv, pipConfigFile, pipIndex, pipExtra, npmRegistry] = await Promise.all(
    (['HOME', 'APPDATA', 'VIRTUAL_ENV', 'PIP_CONFIG_FILE', 'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL', 'npm_config_registry'] as const)
      .map(name => getEnv(src.env, name)),
  )
  const userHome = src.home ?? home ?? await getEnv(src.env, 'USERPROFILE')

  const npmrcPaths = [join(src.cwd, '.npmrc'), ...userHome ? [join(userHome, '.npmrc')] : []]
  const npmrcs = (await Promise.all(npmrcPaths.map(p => read(src.readFile, p))))
    .filter((t): t is string => t !== undefined)
    .map(parseNpmrc)
  for (const rc of [...npmrcs].reverse()) {
    if (rc.registry) config.npm.registry = rc.registry
    Object.assign(config.npm.scopes, rc.scopes)
  }
  if (npmRegistry) config.npm.registry = npmRegistry
  const npmFlag = src.indexUrls?.npm?.[0]
  if (npmFlag) config.npm.registry = npmFlag

  const pipPaths = [
    pipConfigFile,
    venv && join(venv, 'pip.conf'),
    venv && join(venv, 'pip.ini'),
    join(src.cwd, 'pip.conf'),
    join(src.cwd, 'pip.ini'),
    userHome && join(userHome, '.config/pip/pip.conf'),
    userHome && join(userHome, '.pip/pip.conf'),
    appData && join(appData, 'pip/pip.ini'),
  ].filter((p): p is string => !!p)
  const pips = (await Promise.all(pipPaths.map(p => read(src.readFile, p))))
    .filter((t): t is string => t !== undefined)
    .map(parsePipConf)
  const extras = new Set<string>()
  const fileIndex = pips.find(p => p.indexUrl)?.indexUrl
  for (const p of pips) p.extraIndexUrls.forEach(u => extras.add(u))
  pipExtra?.split(/\s+/).filter(Boolean).forEach(u => extras.add(u))
  const [pipFlag, ...pipFlagExtras] = src.indexUrls?.pypi ?? []
  pipFlagExtras.forEach(u => extras.add(u))
  config.pypi.indexUrl = pipFlag ?? pipIndex ?? fileIndex ?? PYPI_PUBLIC
  config.pypi.extraIndexUrls = [...extras]
  return config
}
