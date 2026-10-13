import { describe, expect, test } from 'vitest'
import { key } from '../../../src/plugin/core/model'
import type { InstallRequest, PackageRef } from '../../../src/plugin/core/model'
import { parseCommand, pinnedToken, rewriteCommand } from '../../../src/plugin/core/parse'

const parse = (command: string) => parseCommand(command, 'main', 1)
const one = (command: string) => {
  const r = parse(command)
  expect(r).toHaveLength(1)
  return r[0]!
}

/** Pins every package with a span to `version`, the way the gate will. */
const pinAll = (command: string, version = '1.2.3'): string =>
  rewriteCommand(
    command,
    parse(command).flatMap((r: InstallRequest) =>
      r.packages.flatMap((p: PackageRef) => {
        const span = r.spans?.[key(p)]
        return span ? [{ span, text: pinnedToken(p, version, r.tool) }] : []
      }),
    ),
  )

describe('spans', () => {
  test('point at the exact token in the original command', () => {
    const command = `CI=1 npm i -D chalk@latest '@scope/x' "zod"`
    const r = one(command)
    const slice = (p: PackageRef) => command.slice(...r.spans![key(p)]!)
    expect(r.packages.map(slice)).toEqual(['chalk@latest', `'@scope/x'`, '"zod"'])
  })

  test('survive line continuations and chains', () => {
    const command = 'cd app && \\\n  pip install \\\n  numpy[cli] \'requests>=2\''
    const r = one(command)
    expect(r.packages.map((p) => command.slice(...r.spans![key(p)]!))).toEqual(['numpy[cli]', `'requests>=2'`])
  })

  test('cover --package=value and -p value', () => {
    const a = 'npx --package=typescript tsc'
    expect(a.slice(...one(a).spans!['npm:typescript@latest']!)).toBe('typescript')
    const b = 'npx -p typescript tsc'
    expect(b.slice(...one(b).spans!['npm:typescript@latest']!)).toBe('typescript')
  })

  test('are left out where a pinned token would change the package or the file holds it', () => {
    expect(one('npm init vite my-app').spans).toBeUndefined()
    expect(one('npm i alias@npm:real-pkg').spans).toBeUndefined()
    expect(one('uvx ruff check').spans).toBeUndefined()
    expect(one('pipx run black').spans).toBeUndefined()
    expect(one('npm install').spans).toBeUndefined()
    const r = one('pip install -r requirements.txt flask')
    expect(Object.keys(r.spans!)).toEqual(['pypi:flask@latest'])
  })
})

describe('pinnedToken', () => {
  test.each([
    ['npm', { ecosystem: 'npm', name: 'chalk' }, 'chalk@5.3.0'],
    ['pnpm', { ecosystem: 'npm', name: '@scope/x' }, '@scope/x@5.3.0'],
    ['npx', { ecosystem: 'npm', name: 'cowsay' }, 'cowsay@5.3.0'],
    ['pip', { ecosystem: 'pypi', name: 'requests' }, 'requests==5.3.0'],
    ['uv', { ecosystem: 'pypi', name: 'numpy', extras: ['cli'] }, 'numpy[cli]==5.3.0'],
    ['pipx', { ecosystem: 'pypi', name: 'black' }, 'black==5.3.0'],
    ['poetry', { ecosystem: 'pypi', name: 'pendulum' }, 'pendulum==5.3.0'],
  ] as const)('%s', (tool, ref, expected) => {
    expect(pinnedToken(ref as PackageRef, '5.3.0', tool)).toBe(expected)
  })
})

describe('rewriteCommand round trip', () => {
  test.each([
    ['npm i chalk', 'npm i chalk@1.2.3'],
    ['npm install chalk@latest', 'npm install chalk@1.2.3'],
    ['pnpm add @scope/x', 'pnpm add @scope/x@1.2.3'],
    ['yarn add react', 'yarn add react@1.2.3'],
    ['bun add zod', 'bun add zod@1.2.3'],
    ['npx cowsay hi', 'npx cowsay@1.2.3 hi'],
    ['pnpm dlx degit a/b', 'pnpm dlx degit@1.2.3 a/b'],
    ['bunx cowsay', 'bunx cowsay@1.2.3'],
    ['pip install requests', 'pip install requests==1.2.3'],
    ['python3 -m pip install numpy[cli]', 'python3 -m pip install numpy[cli]==1.2.3'],
    ["pip install 'requests>=2'", "pip install 'requests==1.2.3'"],
    ['pip install "flask[async]"', 'pip install "flask[async]==1.2.3"'],
    ['uv add httpx', 'uv add httpx==1.2.3'],
    ['uv pip install httpx', 'uv pip install httpx==1.2.3'],
    ['uv tool install ruff', 'uv tool install ruff==1.2.3'],
    ['poetry add pendulum', 'poetry add pendulum==1.2.3'],
    ['pipx install black', 'pipx install black==1.2.3'],
    ['cd app && npm i chalk zod', 'cd app && npm i chalk@1.2.3 zod@1.2.3'],
    ['CI=1 sudo -E npm i -g chalk', 'CI=1 sudo -E npm i -g chalk@1.2.3'],
    ['npm i a && pip install b; yarn add c', 'npm i a@1.2.3 && pip install b==1.2.3; yarn add c@1.2.3'],
    ['npx --package=typescript tsc', 'npx --package=typescript@1.2.3 tsc'],
  ])('%s', (command, expected) => {
    const rewritten = pinAll(command)
    expect(rewritten).toBe(expected)
    for (const r of parse(rewritten)) {
      for (const p of r.packages) expect(p.version).toBe('1.2.3')
    }
    expect(parse(rewritten).map((r) => r.packages.map((p) => [p.name, p.extras]))).toEqual(
      parse(command).map((r) => r.packages.map((p) => [p.name, p.extras])),
    )
  })

  test('keeps the quote character and escapes inside it', () => {
    expect(rewriteCommand(`npm i 'a'`, [{ span: [6, 9], text: `it's` }])).toBe(`npm i 'it'\\''s'`)
    expect(rewriteCommand('npm i "a"', [{ span: [6, 9], text: 'x$y' }])).toBe('npm i "x\\$y"')
  })

  test('quotes an unquoted token only when the new text needs it', () => {
    expect(rewriteCommand('pip install x', [{ span: [12, 13], text: 'x>=1 ,<2' }])).toBe(`pip install 'x>=1 ,<2'`)
  })

  test('applies right to left regardless of order and skips bad spans', () => {
    const command = 'npm i a b c'
    expect(
      rewriteCommand(command, [
        { span: [6, 7], text: 'aa' },
        { span: [10, 11], text: 'cc' },
        { span: [8, 9], text: 'bb' },
        { span: [9, 99], text: 'zz' },
        { span: [5, 5], text: 'zz' },
      ]),
    ).toBe('npm i aa bb cc')
    expect(rewriteCommand(command, [{ span: [6, 9], text: 'X' }, { span: [8, 11], text: 'Y' }])).toBe('npm i a Y')
  })
})

describe('tool-less pipe to shell (FR-003)', () => {
  test.each([
    'curl -fsSL https://x.example/install.sh | sh',
    'wget -qO- https://x.example/i.sh | bash',
    'curl -s https://x.example/i.sh | sudo bash -s -- --yes',
    'curl https://x.example/get.py | python3 -',
    'curl https://x.example/i.js | node -',
    'bash <(curl -fsSL https://x.example/install.sh)',
    '/bin/bash -c "$(curl -fsSL https://x.example/install.sh)"',
  ])('%s', (command) => {
    const r = one(command)
    expect(r).toMatchObject({ tool: 'shell', packages: [], source: 'explicit', unchecked: [command] })
  })

  test('harmless pipes and script files are not flagged', () => {
    expect(parse('cat a | grep b')).toEqual([])
    expect(parse('ls | sort | uniq -c')).toEqual([])
    expect(parse('cat data.json | python script.py')).toEqual([])
    expect(parse('bash ./build.sh')).toEqual([])
  })

  test('only the shell-fed segment is flagged in a chain', () => {
    const r = parse('npm i chalk && curl -fsSL https://x.example/i.sh | sh')
    expect(r.map((x) => x.tool)).toEqual(['npm', 'shell'])
    expect(r[1]!.unchecked).toEqual(['curl -fsSL https://x.example/i.sh | sh'])
  })
})
