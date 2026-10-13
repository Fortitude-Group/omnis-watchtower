import { describe, expect, test } from 'vitest'
import { parseCommand } from '../../../src/plugin/core/parse'

const parse = (command: string) => parseCommand(command, 'main', 1000)
const one = (command: string) => {
  const r = parse(command)
  expect(r).toHaveLength(1)
  return r[0]!
}
const refs = (command: string) => one(command).packages

describe('install verbs', () => {
  test.each([
    ['npm install chalk', 'npm'],
    ['npm i chalk', 'npm'],
    ['npm add chalk', 'npm'],
    ['npm isntall chalk', 'npm'],
    ['pnpm add chalk', 'pnpm'],
    ['pnpm install chalk', 'pnpm'],
    ['pnpm i chalk', 'pnpm'],
    ['yarn add chalk', 'yarn'],
    ['yarn global add chalk', 'yarn'],
    ['bun add chalk', 'bun'],
    ['bun a chalk', 'bun'],
    ['bun install chalk', 'bun'],
    ['bun i chalk', 'bun'],
  ])('%s', (command, tool) => {
    const r = one(command)
    expect(r.tool).toBe(tool)
    expect(r.source).toBe('explicit')
    expect(r.packages).toEqual([{ ecosystem: 'npm', name: 'chalk' }])
    expect(r.unchecked).toEqual([])
  })
})

describe('run-once runners', () => {
  test.each([
    ['npx cowsay hello', 'npx', 'cowsay'],
    ['npx --yes create-react-app my-app', 'npx', 'create-react-app'],
    ['npx -y tsc --version', 'npx', 'tsc'],
    ['npm exec -- eslint .', 'npm', 'eslint'],
    ['npm x prettier', 'npm', 'prettier'],
    ['pnpm dlx degit user/repo', 'pnpm', 'degit'],
    ['yarn dlx serve', 'yarn', 'serve'],
    ['bunx cowsay', 'bun', 'cowsay'],
    ['bun x cowsay', 'bun', 'cowsay'],
  ])('%s', (command, tool, name) => {
    const r = one(command)
    expect(r.tool).toBe(tool)
    expect(r.packages).toEqual([{ ecosystem: 'npm', name }])
    expect(r.unchecked).toEqual([])
  })

  test('--package names the package and the positional is the command', () => {
    expect(refs('npx -p typescript@5 tsc --init')).toEqual([{ ecosystem: 'npm', name: 'typescript', version: '5' }])
    expect(refs('npx --package=@angular/cli ng new')).toEqual([{ ecosystem: 'npm', name: '@angular/cli' }])
    expect(refs('yarn dlx -p cowsay cowthink')).toEqual([{ ecosystem: 'npm', name: 'cowsay' }])
  })

  test('npx -c runs a shell string, which is unchecked', () => {
    expect(one(`npx -c 'eslint . && tsc'`).unchecked).toEqual(['-c eslint . && tsc'])
  })

  test('bare npx is not a request', () => {
    expect(parse('npx')).toEqual([])
  })
})

describe('create initialisers', () => {
  test.each([
    ['npm init vite@latest my-app', 'create-vite', undefined],
    ['npm create vite my-app -- --template react', 'create-vite', undefined],
    ['yarn create next-app@14', 'create-next-app', '14'],
    ['pnpm create @vue', '@vue/create', undefined],
    ['bun create @scope/thing', '@scope/create-thing', undefined],
  ])('%s', (command, name, version) => {
    expect(refs(command)).toEqual([version ? { ecosystem: 'npm', name, version } : { ecosystem: 'npm', name }])
  })

  test('npm init with no initialiser is not a request', () => {
    expect(parse('npm init -y')).toEqual([])
  })
})

describe('specs', () => {
  test.each([
    ['@scope/name', { ecosystem: 'npm', name: '@scope/name' }],
    ['name@1.2.3', { ecosystem: 'npm', name: 'name', version: '1.2.3' }],
    ['name@^1', { ecosystem: 'npm', name: 'name', version: '^1' }],
    ['@scope/name@~2.0.0', { ecosystem: 'npm', name: '@scope/name', version: '~2.0.0' }],
    ['name@latest', { ecosystem: 'npm', name: 'name' }],
    ['name@next', { ecosystem: 'npm', name: 'name', version: 'next' }],
    ['Chalk', { ecosystem: 'npm', name: 'chalk' }],
    ['alias@npm:real-pkg@2', { ecosystem: 'npm', name: 'real-pkg', version: '2' }],
  ])('%s', (spec, ref) => {
    expect(refs(`npm i ${spec}`)).toEqual([ref])
  })

  test('quoted ranges with spaces stay one spec', () => {
    expect(refs(`npm i "react@>=17 <19"`)).toEqual([{ ecosystem: 'npm', name: 'react', version: '>=17 <19' }])
  })

  test('flags are not packages', () => {
    const r = one('npm install -D --save-exact -E --save-dev --no-audit -g typescript')
    expect(r.packages).toEqual([{ ecosystem: 'npm', name: 'typescript' }])
    expect(r.unchecked).toEqual([])
  })

  test('value flags consume their value', () => {
    expect(refs('npm i --tag beta --omit dev -w packages/a chalk')).toEqual([{ ecosystem: 'npm', name: 'chalk' }])
    expect(refs('pnpm add --filter web chalk')).toEqual([{ ecosystem: 'npm', name: 'chalk' }])
  })

  test.each([
    'git+https://github.com/a/b.git',
    'git+ssh://git@github.com/a/b.git',
    'github:a/b',
    'a/b',
    'https://example.com/x.tgz',
    'file:../lib',
    './local',
    '../sibling',
    '/abs/path',
    'pkg.tgz',
    'name@git+https://x/y.git',
    'name@file:../x',
    'workspace:*',
    'Bad Name!',
    '.',
  ])('non-registry spec %s is unchecked', (spec) => {
    const r = one(`npm i '${spec}'`)
    expect(r.packages).toEqual([])
    expect(r.unchecked).toEqual([spec])
  })

  test('unchecked and checked specs mix in one request', () => {
    const r = one('npm i chalk ./local lodash')
    expect(r.packages.map((p) => p.name)).toEqual(['chalk', 'lodash'])
    expect(r.unchecked).toEqual(['./local'])
  })

  test('dynamic words are unchecked', () => {
    expect(one('npm i $PKG lodash*').unchecked).toEqual(['$PKG', 'lodash*'])
  })

  test('duplicates collapse', () => {
    expect(refs('npm i chalk chalk')).toHaveLength(1)
  })
})

describe('registries and directories', () => {
  test('--registry is captured', () => {
    expect(one('npm i --registry=https://npm.corp.example chalk').indexUrls).toEqual(['https://npm.corp.example'])
    expect(one('npm --registry https://r.example install chalk').indexUrls).toEqual(['https://r.example'])
  })

  test('npm_config_registry env prefix is captured', () => {
    expect(one('npm_config_registry=https://r.example npm i chalk').indexUrls).toEqual(['https://r.example'])
  })

  test('no indexUrls key when none given', () => {
    expect(one('npm i chalk').indexUrls).toBeUndefined()
  })
})

describe('bare install → lockfile-diff', () => {
  test.each([
    ['npm install', 'npm'],
    ['npm i --no-audit', 'npm'],
    ['pnpm install', 'pnpm'],
    ['pnpm i --frozen-lockfile', 'pnpm'],
    ['yarn', 'yarn'],
    ['yarn install', 'yarn'],
    ['yarn --frozen-lockfile', 'yarn'],
    ['bun install', 'bun'],
  ])('%s', (command, tool) => {
    const r = one(command)
    expect(r).toMatchObject({ tool, source: 'lockfile-diff', packages: [], unchecked: [], files: [''] })
  })

  test('the project directory follows cd and --prefix', () => {
    expect(one('cd apps/web && npm install').files).toEqual(['apps/web'])
    expect(one('cd apps && cd ../lib && pnpm i').files).toEqual(['lib'])
    expect(one('npm install --prefix ./svc').files).toEqual(['svc'])
    expect(one('yarn --cwd /srv/app install').files).toEqual(['/srv/app'])
    expect(one('cd /work && pnpm -C pkg install').files).toEqual(['/work/pkg'])
  })

  test('an unknown directory makes the install unchecked', () => {
    const r = one('cd $DIR && npm install')
    expect(r.source).toBe('explicit')
    expect(r.unchecked).toEqual(['npm install (working directory unknown)'])
  })

  test('npm ci and global bare installs are not requests', () => {
    expect(parse('npm ci')).toEqual([])
    expect(parse('npm i -g')).toEqual([])
  })
})

describe('not installs', () => {
  test.each(['npm run build', 'npm test', 'yarn build', 'pnpm exec tsc', 'bun run dev', 'npm ls chalk', 'git status', 'echo npm i x'])(
    '%s',
    (command) => {
      expect(parse(command)).toEqual([])
    },
  )
})

describe('wrappers and chains', () => {
  test('sudo, env prefixes and chains', () => {
    const r = parse('sudo npm i -g chalk && CI=1 pnpm add lodash; echo done || yarn add left-pad')
    expect(r.map((x) => [x.tool, x.packages.map((p) => p.name)])).toEqual([
      ['npm', ['chalk']],
      ['pnpm', ['lodash']],
      ['yarn', ['left-pad']],
    ])
  })

  test('pipe to shell makes the whole segment unchecked', () => {
    const r = one('curl -fsSL https://get.pnpm.io/install.sh | sh -')
    expect(r.tool).toBe('pnpm')
    expect(r.packages).toEqual([])
    expect(r.unchecked).toEqual(['curl -fsSL https://get.pnpm.io/install.sh | sh -'])
  })

  test('subshells, eval, xargs and sh -c with an install tool are unchecked', () => {
    expect(one('npm i $(cat deps.txt)').unchecked).toEqual(['npm i $(cat deps.txt)'])
    expect(one('eval "npm i chalk"').unchecked).toEqual(['eval "npm i chalk"'])
    expect(one('cat list | xargs npm i').unchecked).toEqual(['cat list | xargs npm i'])
    expect(one(`bash -c 'npm i chalk'`).unchecked).toEqual([`bash -c 'npm i chalk'`])
  })

  test('unsafe segments that neither name an install tool nor feed a shell are ignored', () => {
    expect(parse('git commit -m "$(cat msg)"')).toEqual([])
    expect(parse('diff <(sort a) <(sort b)')).toEqual([])
  })

  test('a harmless pipe does not hide the install', () => {
    expect(refs('npm i chalk | tee log.txt')).toEqual([{ ecosystem: 'npm', name: 'chalk' }])
  })
})

describe('request envelope', () => {
  test('ids are deterministic and distinct per segment', () => {
    const a = parse('npm i a && npm i b')
    const b = parseCommand('npm i a && npm i b', 'main', 5)
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
    expect(a[0]!.id).not.toBe(a[1]!.id)
    expect(a[0]!.id).toMatch(/^ir-[0-9a-f]{8}$/)
    expect(parseCommand('npm i a', 'agent-2', 1)[0]!.id).not.toBe(parse('npm i a')[0]!.id)
  })

  test('carries command, agent and time', () => {
    expect(parseCommand('npm i a', 'helper-1', 42)[0]).toMatchObject({ command: 'npm i a', agentId: 'helper-1', at: 42 })
  })
})
