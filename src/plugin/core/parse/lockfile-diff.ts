// Manifest vs lockfile: dependencies declared but not yet locked. Targeted line parsers, no YAML/TOML library.

import { isValidName, normalise } from '../model'
import type { Ecosystem, InstallRequest, InstallTool, PackageRef } from '../model'
import { joinPath, uniqueRefs } from './fragment'
import { npmSpec } from './npm'
import { pypiSpec } from './pypi'
import type { FileContents } from './requirements'

/** A dependency as declared: its normalised name, the ref to check (absent if not a registry spec), the raw text. */
export type DeclaredDep = { name: string; ref?: PackageRef; raw: string }
export type TextFile = { path: string; text: string }
export type DiffResult = { packages: PackageRef[]; unchecked: string[] }

const base = (path: string) => path.replace(/^.*[/\\]/, '').toLowerCase()

const ECOSYSTEM_OF: Record<string, Ecosystem> = {
  'package.json': 'npm',
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'npm',
  'yarn.lock': 'npm',
  'bun.lock': 'npm',
  'pyproject.toml': 'pypi',
  'uv.lock': 'pypi',
  'poetry.lock': 'pypi',
}

const LOCKFILES: Partial<Record<InstallTool, string[]>> = {
  npm: ['package.json', 'package-lock.json', 'npm-shrinkwrap.json'],
  pnpm: ['package.json', 'pnpm-lock.yaml'],
  yarn: ['package.json', 'yarn.lock'],
  bun: ['package.json', 'bun.lock'],
  uv: ['pyproject.toml', 'uv.lock'],
  poetry: ['pyproject.toml', 'poetry.lock'],
}

const NPM_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

const packageJsonDeps = (text: string): DeclaredDep[] => {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  if (!json || typeof json !== 'object') return [{ name: '', raw: 'package.json (unparseable)' }]
  const out: DeclaredDep[] = []
  for (const section of NPM_SECTIONS) {
    const deps = (json as Record<string, unknown>)[section]
    if (!deps || typeof deps !== 'object') continue
    for (const [rawName, spec] of Object.entries(deps as Record<string, unknown>)) {
      const version = typeof spec === 'string' ? spec : ''
      const name = normalise('npm', rawName)
      const raw = version ? `${rawName}@${version}` : rawName
      const r = npmSpec(version && version !== '*' ? raw : rawName)
      out.push('ref' in r ? { name, ref: r.ref, raw } : { name, raw })
    }
  }
  return out
}

// Reads a TOML string array starting at `[`, returning top-level string items and the index after `]`.
const readArray = (text: string, start: number): { items: string[]; end: number } => {
  const items: string[] = []
  let depth = 0
  let braces = 0
  let i = start
  while (i < text.length) {
    const c = text[i]!
    if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i)
      const close = triple ? c.repeat(3) : c
      let j = i + close.length
      let value = ''
      while (j < text.length && !text.startsWith(close, j)) {
        if (c === '"' && text[j] === '\\' && j + 1 < text.length) {
          value += text[j + 1]
          j += 2
        } else value += text[j++]
      }
      if (depth === 1 && braces === 0) items.push(value)
      i = j + close.length
      continue
    }
    if (c === '#') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return { items, end: i + 1 }
    } else if (c === '{') braces++
    else if (c === '}') braces--
    i++
  }
  return { items, end: text.length }
}

const inlineValue = (value: string, field: string): string | undefined =>
  new RegExp(`(?:^|[{,\\s])${field}\\s*=\\s*["']([^"']*)["']`).exec(value)?.[1]

const pep508Dep = (spec: string): DeclaredDep => {
  const r = pypiSpec(spec)
  const rawName = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1] ?? spec
  return 'ref' in r ? { name: r.ref.name, ref: r.ref, raw: spec } : { name: normalise('pypi', rawName), raw: spec }
}

const poetryDep = (rawKey: string, value: string): DeclaredDep | undefined => {
  const keyName = rawKey.replace(/^["']|["']$/g, '')
  if (keyName.toLowerCase() === 'python') return undefined
  const name = normalise('pypi', keyName)
  const raw = `${keyName} = ${value.trim()}`
  if (!isValidName('pypi', keyName)) return { name, raw }
  const v = value.trim()
  let version: string | undefined
  if (/^["']/.test(v)) version = v.slice(1).replace(/["'].*$/, '')
  else if (v.startsWith('{')) {
    if (/(?:^|[{,\s])(?:git|path|url|file)\s*=/.test(v)) return { name, raw }
    version = inlineValue(v, 'version')
  }
  const ref: PackageRef = { ecosystem: 'pypi', name }
  if (version && version !== '*') ref.version = version
  return { name, ref, raw }
}

const pyprojectDeps = (text: string): DeclaredDep[] => {
  const out: DeclaredDep[] = []
  let table = ''
  let i = 0
  while (i < text.length) {
    const eol = text.indexOf('\n', i)
    const end = eol < 0 ? text.length : eol
    const line = text.slice(i, end)
    const next = end + 1
    const header = /^\s*\[([^[\]]+)\]\s*(?:#.*)?$/.exec(line)
    if (header) {
      table = header[1]!.trim().replace(/\s+/g, '')
      i = next
      continue
    }
    if (/^\s*\[\[/.test(line)) {
      table = ''
      i = next
      continue
    }
    const kv = /^\s*("[^"]+"|'[^']+'|[A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line)
    if (!kv) {
      i = next
      continue
    }
    const k = kv[1]!
    const value = kv[2]!
    const arrayTable =
      (table === 'project' && k === 'dependencies') || table === 'project.optional-dependencies' || table === 'dependency-groups'
    if (arrayTable && value.trimStart().startsWith('[')) {
      const at = i + line.indexOf('[', line.indexOf('='))
      const arr = readArray(text, at)
      for (const item of arr.items) out.push(pep508Dep(item))
      const after = text.indexOf('\n', arr.end)
      i = after < 0 ? text.length : after + 1
      continue
    }
    if (/^tool\.poetry\.(?:dev-dependencies|dependencies|group\.[^.]+\.dependencies)$/.test(table)) {
      const dep = poetryDep(k, value)
      if (dep) out.push(dep)
    }
    i = next
  }
  return out
}

/** Dependencies declared in a manifest (`package.json` or `pyproject.toml`), chosen by file name. */
export const manifestDeps = (path: string, text: string): DeclaredDep[] => {
  const b = base(path)
  if (b === 'package.json') return packageJsonDeps(text)
  if (b === 'pyproject.toml') return pyprojectDeps(text)
  return []
}

const NPM_KEY = /^(@[^/]+\/[^@/(]+|[^@/(]+)/

const npmLockNames = (text: string): string[] => {
  try {
    const json = JSON.parse(text) as { packages?: Record<string, unknown>; dependencies?: Record<string, unknown> }
    const names = Object.keys(json.packages ?? {}).filter(Boolean).map((k) => k.slice(k.lastIndexOf('node_modules/') + 13))
    return [...names, ...Object.keys(json.dependencies ?? {})]
  } catch {
    return [...text.matchAll(/"(?:[^"]*\/)?node_modules\/((?:@[^/"]+\/)?[^/"]+)"/g)].map((m) => m[1]!)
  }
}

const yamlKey = (line: string): string | undefined => {
  const t = line.trim()
  const quoted = /^(["'])(.*?)\1\s*:/.exec(t)
  if (quoted) return quoted[2]
  const m = /^([^\s:'"][^\s'"]*?):(?:\s|$)/.exec(t)
  return m?.[1]
}

const pnpmLockNames = (text: string): string[] => {
  const names: string[] = []
  let section = ''
  let depBlock = false
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    const k = yamlKey(line)
    if (indent === 0) {
      section = k ?? ''
      continue
    }
    if (!k) continue
    if (section === 'packages' || section === 'snapshots') {
      if (indent === 2) {
        const m = NPM_KEY.exec(k.replace(/^\//, ''))
        if (m) names.push(m[1]!)
      }
    } else if (section === 'importers') {
      if (indent === 4) depBlock = /^(?:dev|optional)?[dD]ependencies$/.test(k)
      else if (indent === 6 && depBlock) names.push(k)
    } else if (/^(?:dev|optional)?[dD]ependencies$/.test(section) && indent === 2) {
      names.push(k)
    }
  }
  return names
}

const yarnLockNames = (text: string): string[] => {
  const names: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^[\s#]/.test(line) || !line.trimEnd().endsWith(':')) continue
    for (const part of line.trimEnd().slice(0, -1).split(/,\s*/)) {
      const m = /^(@[^/@]+\/[^@]+|[^@]+)@/.exec(part.trim().replace(/^["']|["']$/g, ''))
      if (m) names.push(m[1]!)
    }
  }
  return names
}

// bun.lock keys are install paths (`parent/child` when nested); the last package segment is the name.
const bunLockNames = (text: string): string[] => {
  const body = /"packages"\s*:\s*\{([\s\S]*)$/.exec(text)?.[1] ?? ''
  return [...body.matchAll(/^\s*"([^"]+)"\s*:\s*\[/gm)].map((m) => /((?:@[^/]+\/)?[^/@]+)$/.exec(m[1]!)?.[1] ?? m[1]!)
}

const tomlLockNames = (text: string): string[] => {
  const names: string[] = []
  let inPackage = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      inPackage = /^\s*\[\[package\]\]\s*$/.test(line)
      continue
    }
    const m = inPackage ? /^name\s*=\s*["']([^"']+)["']/.exec(line) : null
    if (m) {
      names.push(m[1]!)
      inPackage = false
    }
  }
  return names
}

/** Normalised names of every package a lockfile pins, chosen by file name. */
export const lockedNames = (path: string, text: string): Set<string> => {
  const b = base(path)
  const eco = ECOSYSTEM_OF[b] ?? 'npm'
  const raw =
    b === 'package-lock.json' || b === 'npm-shrinkwrap.json'
      ? npmLockNames(text)
      : b === 'pnpm-lock.yaml'
        ? pnpmLockNames(text)
        : b === 'yarn.lock'
          ? yarnLockNames(text)
          : b === 'bun.lock'
            ? bunLockNames(text)
            : b === 'uv.lock' || b === 'poetry.lock'
              ? tomlLockNames(text)
              : []
  return new Set(raw.map((n) => normalise(eco, n)))
}

/** Declared dependencies absent from every lockfile of the same ecosystem; no lockfile → all of them. */
export const lockfileDiff = (manifests: TextFile[], lockfiles: TextFile[]): DiffResult => {
  const packages: PackageRef[] = []
  const unchecked: string[] = []
  for (const m of manifests) {
    const eco = ECOSYSTEM_OF[base(m.path)]
    if (!eco) continue
    const locks = lockfiles.filter((l) => ECOSYSTEM_OF[base(l.path)] === eco && base(l.path) !== base(m.path))
    const locked = new Set(locks.flatMap((l) => [...lockedNames(l.path, l.text)]))
    for (const dep of manifestDeps(m.path, m.text)) {
      if (locks.length > 0 && locked.has(dep.name)) continue
      if (dep.ref) packages.push(dep.ref)
      else unchecked.push(dep.raw)
    }
  }
  return { packages: uniqueRefs(packages), unchecked }
}

/** Manifest then lockfile paths a `lockfile-diff` request needs, for its tool and project directory. */
export const lockfilePaths = (request: InstallRequest): string[] => {
  if (request.source !== 'lockfile-diff') return []
  const dir = request.files?.[0] ?? ''
  return (LOCKFILES[request.tool] ?? LOCKFILES.npm!).map((f) => joinPath(dir, f))
}

/** Fills a `lockfile-diff` request from file contents; an unreadable manifest is reported unchecked. */
export const expandLockfileDiff = (request: InstallRequest, files: FileContents): InstallRequest => {
  if (request.source !== 'lockfile-diff') return request
  const [manifest, ...locks] = lockfilePaths(request)
  const text = manifest === undefined ? undefined : files[manifest]
  if (manifest === undefined || typeof text !== 'string') {
    return { ...request, unchecked: [...request.unchecked, `${manifest ?? 'manifest'} (unreadable)`] }
  }
  const lockfiles = locks.flatMap((path) => {
    const t = files[path]
    return typeof t === 'string' ? [{ path, text: t }] : []
  })
  const diff = lockfileDiff([{ path: manifest, text }], lockfiles)
  return {
    ...request,
    packages: uniqueRefs([...request.packages, ...diff.packages]),
    unchecked: [...request.unchecked, ...diff.unchecked],
  }
}
