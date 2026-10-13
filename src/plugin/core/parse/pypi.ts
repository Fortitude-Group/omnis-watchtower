// pip (any spelling), uv, uvx, poetry and pipx.

import { isValidName, normalise } from '../model'
import type { InstallTool, PackageRef } from '../model'
import { applyOpts, execute, fragment, install, lockfileFragment, merge, scanArgs, table } from './fragment'
import type { Fragment, SpecResult, Table } from './fragment'
import type { Word } from './tokenize'

const OP = '(?:===|==|>=|<=|~=|!=|<|>)'
const CLAUSE = `${OP}\\s*[A-Za-z0-9_.*+!-]+`
const SPECIFIER = new RegExp(`^\\(?\\s*${CLAUSE}(?:\\s*,\\s*${CLAUSE})*\\s*\\)?$`)
const EXACT = /^\(?\s*===?\s*([A-Za-z0-9_.+!-]+)\s*\)?$/
const REQ = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[([^\]]*)\])?\s*([\s\S]*)$/
const PATH_LIKE = /^(?:\.|\/|~|\\|[A-Za-z]:[\\/])/
const ARCHIVE = /\.(?:whl|zip|tar\.gz|tgz|tar\.bz2|tar)$/i

/** Reads one PyPI requirement (PEP 508 subset); `atVersion` reads `name@1.2` as a version (poetry, uvx). */
export const pypiSpec = (spec: string, atVersion = false): SpecResult => {
  const bad = { unchecked: spec }
  const body = (spec.split(';')[0] ?? '').trim()
  if (!body || body.includes('://') || /^(?:git|hg|svn|bzr)\+/i.test(body) || /^file:/i.test(body)) return bad
  if (PATH_LIKE.test(body) || /[/\\]/.test(body) || ARCHIVE.test(body)) return bad
  const m = REQ.exec(body)
  if (!m) return bad
  const raw = m[1]!
  const extrasText = m[2]
  const rest = (m[3] ?? '').trim()
  let version: string | undefined
  if (rest.startsWith('@')) {
    const v = rest.slice(1).trim()
    if (!atVersion || !v) return bad
    if (v !== 'latest') {
      if (/^[\^~]?[A-Za-z0-9_.*+!-]+$/.test(v)) version = v
      else if (SPECIFIER.test(v)) version = v.replace(/\s+/g, '')
      else return bad
    }
  } else if (rest) {
    if (!SPECIFIER.test(rest)) return bad
    version = EXACT.exec(rest)?.[1] ?? rest.replace(/[\s()]/g, '')
  }
  if (!isValidName('pypi', raw)) return bad
  const extras = extrasText?.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean) ?? []
  if (extras.some((e) => !isValidName('pypi', e))) return bad
  const ref: PackageRef = { ecosystem: 'pypi', name: normalise('pypi', raw) }
  if (version) ref.version = version
  if (extras.length > 0) ref.extras = extras
  return { ref }
}

const pep508 = (text: string) => pypiSpec(text)
const atSpec = (text: string) => pypiSpec(text, true)

const PIP = table(
  '-c --constraint -f --find-links -t --target --prefix --root --src --upgrade-strategy --platform --python-version --implementation --abi --only-binary --no-binary --progress-bar --log --proxy --retries --timeout --cert --client-cert --cache-dir --trusted-host --report --config-settings -C --global-option --build-option --python --exists-action --keyring-provider --use-feature --use-deprecated --root-user-action -d --dest -w --wheel-dir',
  {
    '-r': 'file',
    '--requirement': 'file',
    '-e': 'editable',
    '--editable': 'editable',
    '-i': 'index',
    '--index-url': 'index',
    '--extra-index-url': 'index',
  },
)
const UV = table(
  '-p --python -f --find-links --index-strategy --keyring-provider --resolution --prerelease --exclude-newer --link-mode --cache-dir --config-file --color -C --config-setting --python-platform --python-version --target --prefix -P --upgrade-package --reinstall-package --no-binary-package --no-build-package --extra --group --only-group --no-group --torch-backend --allow-insecure-host --refresh-package -c --constraint --constraints -o --override --overrides --build-constraint --build-constraints --package',
  {
    '--directory': 'dir',
    '--project': 'dir',
    '-i': 'index',
    '--index': 'index',
    '--default-index': 'index',
    '--index-url': 'index',
    '--extra-index-url': 'index',
    '-r': 'file',
    '--requirement': 'file',
    '--requirements': 'file',
  },
)
const UV_PIP = merge(UV, table('', { '-e': 'editable', '--editable': 'editable' }))
const UV_ADD = merge(UV, table('--optional --rev --tag --branch --script --marker -m --bounds'))
const UV_TOOL = merge(
  UV,
  table('', { '--from': 'from', '--with': 'package', '--with-editable': 'editable', '--with-requirements': 'file' }),
)
const POETRY = table('-G --group -E --extras --source --python --platform --markers', {
  '-C': 'dir',
  '--directory': 'dir',
  '-P': 'dir',
  '--project': 'dir',
})
const PIPX = table('--python --suffix --path', {
  '--index-url': 'index',
  '-i': 'index',
  '--pip-args': 'pipArgs',
  '--spec': 'from',
})

const PIP_NAME = /^pip\d*(?:\.\d+)*$/
const PYTHON = /^(?:python|py)\d*(?:\.\d+)*$/
const PIP_VERBS = new Set(['install', 'download', 'wheel'])

const pip = (tool: InstallTool, words: Word[], start: number, t: Table): Fragment | undefined => {
  const pre = scanArgs(words, start, t, true)
  if (!PIP_VERBS.has(pre.positionals[0]?.text ?? '')) return undefined
  return withPre(install(tool, words, pre.rest, t, pep508, false), pre.opts, t)
}

const withPre = (f: Fragment | undefined, opts: ReturnType<typeof scanArgs>['opts'], t: Table) => {
  if (!f) return f
  const head = fragment(f.tool)
  applyOpts(head, opts, t, pep508)
  if (!f.dir) f.dir = head.dir
  f.indexUrls.unshift(...head.indexUrls)
  f.unchecked.unshift(...head.unchecked)
  return f
}

const requirementsOnly = (tool: InstallTool, words: Word[], start: number, t: Table): Fragment | undefined => {
  const f = fragment(tool)
  const s = scanArgs(words, start, t)
  applyOpts(f, s.opts, t, pep508)
  for (const w of s.positionals) {
    if (w.dynamic) f.unchecked.push(w.text)
    else f.files.push(w.text)
  }
  if (f.files.length > 0) f.source = 'requirements-file'
  return f.files.length > 0 || f.unchecked.length > 0 ? f : undefined
}

const uv = (words: Word[], start: number): Fragment | undefined => {
  const pre = scanArgs(words, start, UV, true)
  const verb = pre.positionals[0]?.text
  let f: Fragment | undefined
  if (verb === 'pip') {
    const sub = scanArgs(words, pre.rest, UV, true)
    const v = sub.positionals[0]?.text
    if (v === 'install') f = withPre(install('uv', words, sub.rest, UV_PIP, pep508, false), sub.opts, UV)
    else if (v === 'sync') f = withPre(requirementsOnly('uv', words, sub.rest, UV_PIP), sub.opts, UV)
  } else if (verb === 'add') f = install('uv', words, pre.rest, UV_ADD, pep508, false)
  else if (verb === 'sync') f = lockfileFragment('uv', words, pre.rest, UV)
  else if (verb === 'run') {
    const run = fragment('uv')
    applyOpts(run, scanArgs(words, pre.rest, UV_TOOL, true).opts, UV_TOOL, atSpec)
    if (run.files.length > 0) run.source = 'requirements-file'
    f = run.packages.length > 0 || run.unchecked.length > 0 || run.files.length > 0 ? run : undefined
  } else if (verb === 'tool') {
    const sub = scanArgs(words, pre.rest, UV, true)
    const v = sub.positionals[0]?.text
    if (v === 'install') f = withPre(install('uv', words, sub.rest, UV_TOOL, atSpec, false), sub.opts, UV)
    else if (v === 'run') f = withPre(execute('uv', words, sub.rest, UV_TOOL, atSpec, false), sub.opts, UV)
  }
  return withPre(f, pre.opts, UV)
}

const poetry = (words: Word[], start: number): Fragment | undefined => {
  const pre = scanArgs(words, start, POETRY, true)
  const verb = pre.positionals[0]?.text
  if (verb === 'add') return withPre(install('poetry', words, pre.rest, POETRY, atSpec, false), pre.opts, POETRY)
  if (verb === 'install' || verb === 'sync') return withPre(lockfileFragment('poetry', words, pre.rest, POETRY), pre.opts, POETRY)
  return undefined
}

const pipx = (words: Word[], start: number): Fragment | undefined => {
  const pre = scanArgs(words, start, PIPX, true)
  const verb = pre.positionals[0]?.text
  if (verb === 'install') return install('pipx', words, pre.rest, PIPX, pep508, false)
  if (verb === 'run') return execute('pipx', words, pre.rest, PIPX, pep508, false)
  if (verb === 'inject') {
    const s = scanArgs(words, pre.rest, PIPX, true)
    return s.positionals[0] ? install('pipx', words, s.rest, PIPX, pep508, false) : undefined
  }
  return undefined
}

const pythonModule = (words: Word[]): Fragment | undefined => {
  let i = 1
  while (i < words.length) {
    const s = words[i]!.text
    if (s === '-m' || (s.startsWith('-m') && s.length > 2)) {
      const module = s === '-m' ? words[i + 1]?.text : s.slice(2)
      const start = s === '-m' ? i + 2 : i + 1
      if (module === 'pip') return pip('pip', words, start, PIP)
      if (module === 'uv') return uv(words, start)
      if (module === 'pipx') return pipx(words, start)
      if (module === 'poetry') return poetry(words, start)
      return undefined
    }
    if (!s.startsWith('-') || s === '-' || s === '-c') return undefined
    i += s === '-W' || s === '-X' ? 2 : 1
  }
  return undefined
}

/** Recognises a PyPI-ecosystem install or run-once command; undefined when it is neither. */
export const parsePypi = (words: Word[]): Fragment | undefined => {
  const head = words[0]?.text ?? ''
  if (PIP_NAME.test(head)) return pip('pip', words, 1, PIP)
  if (PYTHON.test(head)) return pythonModule(words)
  if (head === 'uv') return uv(words, 1)
  if (head === 'uvx') return execute('uv', words, 1, UV_TOOL, atSpec, false)
  if (head === 'poetry') return poetry(words, 1)
  if (head === 'pipx') return pipx(words, 1)
  return undefined
}
