// Shared pieces of the install-command parser: option scanning, fragments, paths, ids.

import { key, normalise } from '../model'
import type { Ecosystem, InstallRequest, InstallTool, PackageRef } from '../model'
import type { Word } from './tokenize'

/** What one install command contributes before the request is assembled. */
export type Fragment = {
  tool: InstallTool
  packages: PackageRef[]
  unchecked: string[]
  source: InstallRequest['source']
  /** Requirement files as written on the command line. */
  files: string[]
  indexUrls: string[]
  /** Directory named by `--prefix`, `--cwd`, `--directory`…, '' when absent. */
  dir: string
  /** Offsets of the token that named each package, keyed by `key(ref)` (FR-035). */
  spans: Record<string, [number, number]>
}

export type SpecResult = { ref: PackageRef } | { unchecked: string }
export type Spec = (text: string) => SpecResult

export type Role = 'index' | 'dir' | 'package' | 'from' | 'file' | 'editable' | 'shell' | 'pipArgs'
export type Table = { values: ReadonlySet<string>; roles: Readonly<Record<string, Role>> }
export type Opt = { flag: string; value?: Word }
export type Scan = { opts: Opt[]; positionals: Word[]; rest: number }

/** Builds an option table: the flags that take a value, and what some of those values mean. */
export const table = (values: string, roles: Record<string, Role> = {}): Table => ({
  values: new Set([...values.split(/\s+/).filter(Boolean), ...Object.keys(roles)]),
  roles,
})

/** Combines option tables, later roles winning. */
export const merge = (...tables: Table[]): Table => ({
  values: new Set(tables.flatMap((t) => [...t.values])),
  roles: Object.assign({}, ...tables.map((t) => t.roles)),
})

/** An empty fragment for a tool. */
export const fragment = (tool: InstallTool): Fragment => ({
  tool,
  packages: [],
  unchecked: [],
  source: 'explicit',
  files: [],
  indexUrls: [],
  dir: '',
  spans: {},
})

/** Records a parsed spec as a package or an unchecked fragment. */
export const addSpec = (f: Fragment, r: SpecResult, w?: Word): void => {
  if (!('ref' in r)) {
    f.unchecked.push(r.unchecked)
    return
  }
  f.packages.push(r.ref)
  const k = key(r.ref)
  if (w && w.start >= 0 && !(k in f.spans) && tokenName(r.ref.ecosystem, w.text) === r.ref.name) f.spans[k] = [w.start, w.end]
}

// The name a token spells, so a span is only kept when rewriting the token keeps the package
// (not for `npm init vite` → create-vite, or `alias@npm:real`).
const tokenName = (ecosystem: Ecosystem, text: string): string => {
  if (ecosystem === 'pypi') return normalise('pypi', /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(text)?.[1] ?? '')
  const at = text.indexOf('@', text.startsWith('@') ? 1 : 0)
  return normalise('npm', at < 0 ? text : text.slice(0, at))
}

// A value split out of `--flag=value` or `-pvalue`; offsets only when the word had no quoting.
const part = (w: Word, from: number): Word => {
  const plain = w.start >= 0 && w.end - w.start === w.text.length
  return { text: w.text.slice(from), dynamic: w.dynamic, start: plain ? w.start + from : -1, end: plain ? w.end : -1 }
}

/** Splits arguments into options and positionals; with `stopAtPositional` it stops after the first positional. */
export const scanArgs = (words: Word[], start: number, t: Table, stopAtPositional = false): Scan => {
  const opts: Opt[] = []
  const positionals: Word[] = []
  let endOfOpts = false
  let i = start
  while (i < words.length) {
    const w = words[i]!
    i++
    const s = w.text
    if (endOfOpts || s.length < 2 || !s.startsWith('-')) {
      positionals.push(w)
      if (stopAtPositional) break
      continue
    }
    if (s === '--') {
      endOfOpts = true
      continue
    }
    const eq = s.indexOf('=')
    if (s.startsWith('--') && eq > 0) {
      opts.push({ flag: s.slice(0, eq), value: part(w, eq + 1) })
    } else if (t.values.has(s)) {
      const value = words[i]
      if (value) i++
      opts.push(value ? { flag: s, value } : { flag: s })
    } else if (s[1] !== '-' && s.length > 2 && t.values.has(s.slice(0, 2))) {
      opts.push({ flag: s.slice(0, 2), value: part(w, 2) })
    } else {
      opts.push({ flag: s })
    }
  }
  return { opts, positionals, rest: i }
}

/** Applies option roles to a fragment; returns true when a `from` option names the package. */
export const applyOpts = (f: Fragment, opts: Opt[], t: Table, spec: Spec): boolean => {
  let from = false
  for (const o of opts) {
    const role = t.roles[o.flag]
    const v = o.value
    if (!role || !v) continue
    if (role === 'shell' || role === 'editable' || v.dynamic) {
      f.unchecked.push(`${o.flag} ${v.text}`)
      if (role === 'from') from = true
      continue
    }
    if (role === 'index') f.indexUrls.push(v.text)
    else if (role === 'dir') f.dir = v.text
    else if (role === 'file') f.files.push(v.text)
    else if (role === 'package') addSpec(f, spec(v.text), v)
    else if (role === 'from') {
      from = true
      addSpec(f, spec(v.text), v)
    } else {
      for (const m of v.text.matchAll(/(?:--index-url|--extra-index-url|-i)(?:=|\s+)(\S+)/g)) f.indexUrls.push(m[1]!)
    }
  }
  return from
}

const has = (f: Fragment) => f.packages.length > 0 || f.unchecked.length > 0 || f.files.length > 0

const isGlobal = (opts: Opt[]) =>
  opts.some((o) => o.flag === '-g' || o.flag === '--global' || (o.flag === '--location' && o.value?.text === 'global'))

/** Every positional is a package spec (`npm install a b`, `pip install a b`). */
export const install = (
  tool: InstallTool,
  words: Word[],
  start: number,
  t: Table,
  spec: Spec,
  bareIsLockfileDiff: boolean,
): Fragment | undefined => {
  const f = fragment(tool)
  const s = scanArgs(words, start, t)
  applyOpts(f, s.opts, t, spec)
  for (const w of s.positionals) addSpec(f, w.dynamic ? { unchecked: w.text } : spec(w.text), w)
  if (f.files.length > 0) f.source = 'requirements-file'
  if (has(f)) return f
  if (!bareIsLockfileDiff || isGlobal(s.opts)) return undefined
  f.source = 'lockfile-diff'
  return f
}

/** The first positional is the package to run, unless a `from` option named it (`npx`, `uvx`, `pipx run`). */
export const execute = (
  tool: InstallTool,
  words: Word[],
  start: number,
  t: Table,
  spec: Spec,
  pinFirst = true,
): Fragment | undefined => {
  const f = fragment(tool)
  const s = scanArgs(words, start, t, true)
  const from = applyOpts(f, s.opts, t, spec)
  const shellMode = s.opts.some((o) => o.flag === '--shell-mode' || (o.flag === '-c' && !t.values.has('-c')))
  const first = s.positionals[0]
  if (first && (shellMode || !from)) {
    addSpec(f, first.dynamic || shellMode ? { unchecked: first.text } : spec(first.text), pinFirst ? first : undefined)
  }
  if (f.files.length > 0) f.source = 'requirements-file'
  return has(f) ? f : undefined
}

/** A bare "install everything" fragment. */
export const lockfileFragment = (tool: InstallTool, words: Word[], start: number, t: Table): Fragment => {
  const f = fragment(tool)
  applyOpts(f, scanArgs(words, start, t).opts, t, (text) => ({ unchecked: text }))
  f.source = 'lockfile-diff'
  return f
}

/** Drops repeated packages, keeping the first. */
export const uniqueRefs = (refs: PackageRef[]): PackageRef[] => {
  const seen = new Set<string>()
  return refs.filter((r) => {
    const k = `${key(r)}[${(r.extras ?? []).join(',')}]`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** 32-bit FNV-1a of a string, as 8 hex digits. */
export const fnv1a = (s: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** True for `/x`, `\x`, `C:\x` and `~/x`. */
export const isAbsolute = (p: string): boolean => /^(?:[/\\]|[A-Za-z]:[/\\]|~)/.test(p)

const normalisePath = (p: string): string => {
  const root = (/^(?:[A-Za-z]:)?[/\\]/.exec(p)?.[0] ?? '').replace(/\\/g, '/')
  const out: string[] = []
  for (const part of p.slice(root.length).split(/[/\\]+/)) {
    if (part === '' || part === '.') continue
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
    else if (part !== '..' || !root) out.push(part)
  }
  return root + out.join('/')
}

/** Joins a relative path onto a base directory ('' = the working directory), using `/`. */
export const joinPath = (base: string, rel: string): string =>
  normalisePath(!base || isAbsolute(rel) ? rel : rel ? `${base}/${rel}` : base)

/** The directory part of a `/`-separated path ('' for a bare file name). */
export const dirname = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : i === 0 ? '/' : p.slice(0, i)
}
