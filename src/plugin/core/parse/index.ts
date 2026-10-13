// Install-command parser entry point. Pure: the gate reads any files and passes their contents back in.

import type { InstallRequest, InstallTool } from '../model'
import { fnv1a, isAbsolute, joinPath, uniqueRefs } from './fragment'
import type { Fragment } from './fragment'
import { expandLockfileDiff, lockfilePaths } from './lockfile-diff'
import { parseNpm } from './npm'
import { parsePypi } from './pypi'
import { expandRequirements, requirementPaths } from './requirements'
import type { FileContents } from './requirements'
import { tokenize, unwrap } from './tokenize'
import type { Invocation, Word } from './tokenize'

export { tokenize, unwrap, program } from './tokenize'
export type { Command, Invocation, Segment, Word } from './tokenize'
export { npmSpec, createSpec } from './npm'
export { pypiSpec } from './pypi'
export { parseRequirements, requirementPaths, expandRequirements } from './requirements'
export type { FileContents, Requirements } from './requirements'
export { manifestDeps, lockedNames, lockfileDiff, lockfilePaths, expandLockfileDiff } from './lockfile-diff'
export type { DeclaredDep, DiffResult, TextFile } from './lockfile-diff'
export { fnv1a } from './fragment'

const SHELLS = /^(?:sh|bash|zsh|dash|ksh|ash|fish|pwsh|powershell|cmd|node|deno|perl|ruby|python[\d.]*|py)$/
const STRING_FLAGS = /^(?:-c|-e|\/c|-command|-encodedcommand)$/i
const TOOL_WORD = /(?:^|[\s;&|(`'"$/=.])(npx|npm|pnpm|yarn|bunx|bun|pip\d*(?:\.\d+)*|uvx|uv|poetry|pipx)(?=$|[\s;&|)`'".])/

const TOOL_OF: Record<string, InstallTool> = {
  npx: 'npx',
  npm: 'npm',
  pnpm: 'pnpm',
  yarn: 'yarn',
  bun: 'bun',
  bunx: 'bun',
  uv: 'uv',
  uvx: 'uv',
  poetry: 'poetry',
  pipx: 'pipx',
}

const NPM_ENV = /^npm_config_registry$/i
const PYPI_ENV = /^(?:PIP_INDEX_URL|PIP_EXTRA_INDEX_URL|UV_INDEX_URL|UV_EXTRA_INDEX_URL|UV_DEFAULT_INDEX|UV_INDEX)$/

/** The install tool a piece of text mentions, if any (for segments too unsafe to parse). */
export const detectTool = (text: string): InstallTool | undefined => {
  const m = TOOL_WORD.exec(text)
  if (!m) return undefined
  return TOOL_OF[m[1]!] ?? 'pip'
}

const semanticUnsafe = (invocations: Invocation[]): string | undefined => {
  for (const [k, inv] of invocations.entries()) {
    const head = inv.words[0]?.text ?? ''
    if (head === 'eval') return 'eval'
    if (head === 'xargs' || head === 'parallel') return 'xargs'
    if (!SHELLS.test(head)) continue
    const args = inv.words.slice(1)
    if (k > 0 && (args.every((w) => w.text.startsWith('-')) || args.some((w) => w.text === '-s'))) return 'pipe to shell'
    for (const w of args) {
      if (STRING_FLAGS.test(w.text)) return 'shell string'
      if (!w.text.startsWith('-') || w.text === '-m') break
    }
  }
  return undefined
}

type Cwd = string | undefined

const changeDir = (cwd: Cwd, target: Word | undefined): Cwd => {
  if (!target || target.dynamic || target.text === '-' || target.text.startsWith('~')) return undefined
  if (isAbsolute(target.text)) return joinPath('', target.text)
  return cwd === undefined ? undefined : joinPath(cwd, target.text)
}

const envIndexUrls = (f: Fragment, env: Record<string, string>) => {
  const pattern = f.tool === 'npm' || f.tool === 'npx' || f.tool === 'pnpm' || f.tool === 'yarn' || f.tool === 'bun' ? NPM_ENV : PYPI_ENV
  for (const [name, value] of Object.entries(env)) {
    if (pattern.test(name)) f.indexUrls.push(...value.split(/\s+/).filter(Boolean))
  }
}

const resolveFiles = (f: Fragment, cwd: Cwd, raw: string): Fragment => {
  if (f.source === 'explicit') return f
  const dir: Cwd = isAbsolute(f.dir) ? joinPath('', f.dir) : cwd === undefined ? undefined : joinPath(cwd, f.dir)
  if (f.source === 'lockfile-diff') {
    return dir === undefined
      ? { ...f, source: 'explicit', files: [], unchecked: [...f.unchecked, `${raw} (working directory unknown)`] }
      : { ...f, files: [dir] }
  }
  const files: string[] = []
  const unchecked = [...f.unchecked]
  for (const p of f.files) {
    if (isAbsolute(p)) files.push(joinPath('', p))
    else if (dir !== undefined) files.push(joinPath(dir, p))
    else unchecked.push(`-r ${p} (working directory unknown)`)
  }
  return { ...f, files, unchecked, source: files.length > 0 ? 'requirements-file' : 'explicit' }
}

/** Every package install or run-once request in a Bash command, in order. Never throws. */
export const parseCommand = (command: string, agentId: string, at: number): InstallRequest[] => {
  const requests: InstallRequest[] = []
  const push = (f: Fragment) => {
    if (f.packages.length === 0 && f.unchecked.length === 0 && f.source === 'explicit') return
    const request: InstallRequest = {
      id: `ir-${fnv1a(`${command}\u0000${agentId}\u0000${requests.length}`)}`,
      agentId,
      command,
      tool: f.tool,
      packages: uniqueRefs(f.packages),
      source: f.source,
      unchecked: f.unchecked,
      at,
    }
    if (f.source !== 'explicit') request.files = f.files
    const indexUrls = [...new Set(f.indexUrls)]
    if (indexUrls.length > 0) request.indexUrls = indexUrls
    requests.push(request)
  }
  let cwd: Cwd = ''
  for (const segment of tokenize(command)) {
    const invocations = segment.commands.map((c) => unwrap(c.words))
    const unsafe = segment.unsafe ?? semanticUnsafe(invocations)
    if (unsafe) {
      const tool = detectTool(segment.raw)
      if (tool) push({ tool, packages: [], unchecked: [segment.raw], source: 'explicit', files: [], indexUrls: [], dir: '' })
      continue
    }
    for (const [k, inv] of invocations.entries()) {
      const head = inv.words[0]?.text
      if (head === 'cd' || head === 'pushd') {
        cwd = changeDir(cwd, inv.words[1])
        continue
      }
      const f = parseNpm(inv.words) ?? parsePypi(inv.words)
      if (!f) continue
      envIndexUrls(f, inv.env)
      push(resolveFiles(f, cwd, segment.commands[k]!.raw))
    }
  }
  return requests
}

/** Paths the gate must read (and pass to `expandRequest`) before the request's packages are complete. */
export const filesNeeded = (request: InstallRequest, files: FileContents = {}): string[] =>
  request.source === 'requirements-file'
    ? requirementPaths(request, files)
    : lockfilePaths(request).filter((p) => !(p in files))

/** Completes a `requirements-file` or `lockfile-diff` request from file contents; `explicit` is returned as is. */
export const expandRequest = (request: InstallRequest, files: FileContents): InstallRequest =>
  request.source === 'requirements-file'
    ? expandRequirements(request, files)
    : request.source === 'lockfile-diff'
      ? expandLockfileDiff(request, files)
      : request
