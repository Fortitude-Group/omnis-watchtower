// requirements.txt over contents the caller has already read. Core does no I/O.

import type { InstallRequest, PackageRef } from '../model'
import { dirname, joinPath, uniqueRefs } from './fragment'
import { pypiSpec } from './pypi'

export type Requirements = {
  packages: PackageRef[]
  /** Nested `-r` files, as written (relative to the including file). */
  includes: string[]
  unchecked: string[]
  indexUrls: string[]
}

/** File contents keyed by path; `null` means the caller tried and could not read it. */
export type FileContents = Readonly<Record<string, string | null | undefined>>

const OPTION = /^(-[A-Za-z]|--[A-Za-z][\w-]*)(?:=|\s+|(?<=^-[A-Za-z]))(.*)$/

/** Parses one requirements file: comments, continuations, `-r`, `-e`, index options, markers and hashes. */
export const parseRequirements = (text: string): Requirements => {
  const out: Requirements = { packages: [], includes: [], unchecked: [], indexUrls: [] }
  const lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.replace(/(?:^|\s)#.*$/, '').trim()
    if (!line) continue
    if (line.startsWith('-')) {
      const m = OPTION.exec(line)
      const flag = m?.[1] ?? line
      const value = (m?.[2] ?? '').trim()
      if (flag === '-r' || flag === '--requirement') {
        if (value) out.includes.push(value)
      } else if (flag === '-e' || flag === '--editable') out.unchecked.push(line)
      else if (flag === '-i' || flag === '--index-url' || flag === '--extra-index-url') {
        if (value) out.indexUrls.push(value)
      }
      continue
    }
    const spec = line.split(/\s+--?[A-Za-z]/)[0]!.trim()
    const r = pypiSpec(spec)
    if ('ref' in r) out.packages.push(r.ref)
    else out.unchecked.push(line)
  }
  return out
}

type Walk = { packages: PackageRef[]; unchecked: string[]; indexUrls: string[]; missing: string[] }

const walk = (roots: string[], files: FileContents): Walk => {
  const w: Walk = { packages: [], unchecked: [], indexUrls: [], missing: [] }
  const seen = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const path = queue.shift()!
    if (seen.has(path)) continue
    seen.add(path)
    if (!(path in files) || files[path] === undefined) {
      w.missing.push(path)
      continue
    }
    const text = files[path]
    if (text === null || text === undefined) {
      w.unchecked.push(`${path} (unreadable)`)
      continue
    }
    const r = parseRequirements(text)
    w.packages.push(...r.packages)
    w.unchecked.push(...r.unchecked)
    w.indexUrls.push(...r.indexUrls)
    for (const inc of r.includes) queue.push(joinPath(dirname(path), inc))
  }
  return w
}

/** Requirement files (including nested `-r`) the gate still has to read before `expandRequirements`. */
export const requirementPaths = (request: InstallRequest, files: FileContents = {}): string[] =>
  request.source === 'requirements-file' ? walk(request.files ?? [], files).missing : []

/** Fills a `requirements-file` request from file contents; a file never read is reported unchecked. */
export const expandRequirements = (request: InstallRequest, files: FileContents): InstallRequest => {
  if (request.source !== 'requirements-file') return request
  const w = walk(request.files ?? [], files)
  const indexUrls = [...new Set([...(request.indexUrls ?? []), ...w.indexUrls])]
  const out: InstallRequest = {
    ...request,
    packages: uniqueRefs([...request.packages, ...w.packages]),
    unchecked: [...request.unchecked, ...w.unchecked, ...w.missing.map((p) => `${p} (unreadable)`)],
  }
  if (indexUrls.length > 0) out.indexUrls = indexUrls
  return out
}
