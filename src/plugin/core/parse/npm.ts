// npm, pnpm, yarn and bun: install verbs, run-once runners (npx, dlx, bunx) and `create`.

import { isValidName, normalise } from '../model'
import type { InstallTool } from '../model'
import { applyOpts, execute, fragment, install, lockfileFragment, merge, scanArgs, table } from './fragment'
import type { Fragment, SpecResult, Table } from './fragment'
import type { Word } from './tokenize'

const NON_REGISTRY = /^(?:git\+|git:|github:|gitlab:|bitbucket:|gist:|https?:|file:|link:|workspace:|portal:|patch:|exec:)/i
const PATH_LIKE = /^(?:\.|\/|~|\\|[A-Za-z]:[\\/])/
const TARBALL = /\.(?:tgz|tar|tar\.gz)$/i

const splitNpm = (spec: string): [string, string | undefined] => {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0)
  return at < 0 ? [spec, undefined] : [spec.slice(0, at), spec.slice(at + 1)]
}

/** Reads one npm package spec (`name`, `@scope/name@^1`, `alias@npm:real`); anything else is unchecked. */
export const npmSpec = (spec: string): SpecResult => {
  const bad = { unchecked: spec }
  if (!spec || NON_REGISTRY.test(spec) || PATH_LIKE.test(spec) || TARBALL.test(spec)) return bad
  const [rawName, version] = splitNpm(spec)
  if (version !== undefined) {
    if (version.startsWith('npm:')) {
      const inner = npmSpec(version.slice(4))
      return 'ref' in inner ? inner : bad
    }
    if (version.trim() === '' || /[:/#\\]/.test(version)) return bad
  }
  if (rawName.includes('/') && !rawName.startsWith('@')) return bad
  const name = normalise('npm', rawName)
  if (!isValidName('npm', name)) return bad
  return { ref: version && version !== 'latest' ? { ecosystem: 'npm', name, version } : { ecosystem: 'npm', name } }
}

/** Maps a `create`/`init` initialiser to its package (`vite` → `create-vite`, `@s/x` → `@s/create-x`). */
export const createSpec = (spec: string): SpecResult => {
  if (NON_REGISTRY.test(spec) || PATH_LIKE.test(spec)) return { unchecked: spec }
  const [name, version] = splitNpm(spec)
  const slash = name.indexOf('/')
  const pkg = name.startsWith('@')
    ? slash < 0 ? `${name}/create` : `${name.slice(0, slash)}/create-${name.slice(slash + 1)}`
    : `create-${name}`
  const r = npmSpec(version === undefined ? pkg : `${pkg}@${version}`)
  return 'ref' in r ? r : { unchecked: spec }
}

const COMMON = table('--cache --userconfig --globalconfig --loglevel', {
  '--registry': 'index',
  '--prefix': 'dir',
})
const NPM = merge(
  COMMON,
  table('-w --workspace --tag --omit --include --before --install-strategy --save-prefix --scope --otp --cpu --os --libc --script-shell --lockfile-version --location --node-options --shell'),
)
const NPM_EXEC = merge(NPM, table('', { '-p': 'from', '--package': 'from', '-c': 'shell', '--call': 'shell' }))
const PNPM = merge(
  COMMON,
  table('--filter -F --reporter --store-dir --virtual-store-dir --config --lockfile-dir --modules-dir --network-concurrency --child-concurrency --resolution-mode --workspace-concurrency --allow-build', {
    '-C': 'dir',
    '--dir': 'dir',
  }),
)
const PNPM_DLX = merge(PNPM, table('', { '--package': 'from' }))
const YARN = merge(
  COMMON,
  table('--network-timeout --modules-folder --cache-folder --mutex --use-yarnrc --network-concurrency', { '--cwd': 'dir' }),
)
const YARN_DLX = merge(YARN, table('', { '-p': 'from', '--package': 'from' }))
const BUN = merge(
  COMMON,
  table('--cache-dir --backend --omit --filter --config --concurrent-scripts --network-concurrency', { '--cwd': 'dir' }),
)
const BUN_X = merge(BUN, table('', { '-p': 'from', '--package': 'from' }))

type Verbs = {
  tool: InstallTool
  table: Table
  execTable: Table
  install: ReadonlySet<string>
  exec: ReadonlySet<string>
  create: ReadonlySet<string>
  lockfile: ReadonlySet<string>
  bareIsInstall?: boolean
}

const verbs = (v: Omit<Verbs, 'install' | 'exec' | 'create' | 'lockfile'> & Record<'install' | 'exec' | 'create' | 'lockfile', string>): Verbs => ({
  ...v,
  install: new Set(v.install.split(' ').filter(Boolean)),
  exec: new Set(v.exec.split(' ').filter(Boolean)),
  create: new Set(v.create.split(' ').filter(Boolean)),
  lockfile: new Set(v.lockfile.split(' ').filter(Boolean)),
})

const MANAGERS: Record<string, Verbs> = {
  npm: verbs({
    tool: 'npm',
    table: NPM,
    execTable: NPM_EXEC,
    install: 'install i in ins inst insta instal isnt isnta isntal isntall add it install-test',
    exec: 'exec x',
    create: 'create init innit',
    lockfile: '',
  }),
  pnpm: verbs({
    tool: 'pnpm',
    table: PNPM,
    execTable: PNPM_DLX,
    install: 'add install i it install-test',
    exec: 'dlx',
    create: 'create',
    lockfile: '',
  }),
  yarn: verbs({
    tool: 'yarn',
    table: YARN,
    execTable: YARN_DLX,
    install: 'add',
    exec: 'dlx',
    create: 'create',
    lockfile: 'install',
    bareIsInstall: true,
  }),
  bun: verbs({
    tool: 'bun',
    table: BUN,
    execTable: BUN_X,
    install: 'add a install i',
    exec: 'x',
    create: 'create c',
    lockfile: '',
  }),
}

const manager = (m: Verbs, words: Word[]): Fragment | undefined => {
  const pre = scanArgs(words, 1, m.table, true)
  const verb = pre.positionals[0]
  let f: Fragment | undefined
  if (!verb) f = m.bareIsInstall ? lockfileFragment(m.tool, words, 1, m.table) : undefined
  else if (verb.dynamic) f = { ...fragment(m.tool), unchecked: [words.map((w) => w.text).join(' ')] }
  else if (m.install.has(verb.text)) f = install(m.tool, words, pre.rest, m.table, npmSpec, true)
  else if (m.lockfile.has(verb.text)) f = install(m.tool, words, pre.rest, m.table, npmSpec, true)
  else if (m.exec.has(verb.text)) f = execute(m.tool, words, pre.rest, m.execTable, npmSpec)
  else if (m.create.has(verb.text)) f = execute(m.tool, words, pre.rest, m.table, createSpec)
  else if (m.tool === 'yarn' && verb.text === 'global') {
    const sub = scanArgs(words, pre.rest, m.table, true)
    if (sub.positionals[0]?.text === 'add') f = install(m.tool, words, sub.rest, m.table, npmSpec, false)
  }
  if (!f || !verb) return f
  // Options given before the verb (`npm --prefix x install`) still apply.
  const head = fragment(m.tool)
  applyOpts(head, pre.opts, m.table, npmSpec)
  if (!f.dir) f.dir = head.dir
  f.indexUrls.unshift(...head.indexUrls)
  f.unchecked.unshift(...head.unchecked)
  return f
}

/** Recognises an npm-ecosystem install or run-once command; undefined when it is neither. */
export const parseNpm = (words: Word[]): Fragment | undefined => {
  const head = words[0]?.text
  if (head === 'npx') return execute('npx', words, 1, NPM_EXEC, npmSpec)
  if (head === 'bunx') return execute('bun', words, 1, BUN_X, npmSpec)
  const m = head === undefined ? undefined : MANAGERS[head]
  return m ? manager(m, words) : undefined
}
