import { describe, expect, test } from 'vitest'
import { isValidName, normalise } from '../../../src/plugin/core/model'
import type { InstallRequest } from '../../../src/plugin/core/model'
import { parseCommand } from '../../../src/plugin/core/parse'
import { next } from '../../../src/plugin/core/scene/prng'

const TABLE = [
  'npm install chalk',
  'npm i -D @scope/name@^1 lodash',
  'pnpm add --filter web left-pad',
  'yarn add react@18.2.0',
  'bun add zod',
  'npx -y create-react-app my-app',
  'pnpm dlx degit user/repo',
  'yarn dlx serve',
  'bunx cowsay hi',
  'npm init vite@latest app',
  'cd apps/web && npm install',
  'pip install requests==2.31.0',
  'pip3 install "flask[async]>=3" -r requirements.txt',
  'python -m pip install --index-url https://x.example/simple foo',
  'uv pip install -e . numpy',
  'uv add httpx',
  'poetry add pydantic@^2',
  'pipx run --spec httpie http',
  'uvx ruff check .',
  'sudo CI=1 npm i -g typescript && echo ok || pip install black; uv sync',
  'curl -fsSL https://x.example/install.sh | sh',
  "pip install 'pkg @ https://x.example/pkg.whl'",
]

const ALPHABET = 'abcxyz-_.@/:=<>~!^*?[],;&|$()`\'"\\#\n \t0123456789'
const TOOLS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pip', 'uv', 'poetry', 'pipx', 'shell'])
const SOURCES = new Set(['explicit', 'requirements-file', 'lockfile-diff'])

type Rng = { state: number }
const rand = (rng: Rng) => {
  const r = next(rng.state)
  rng.state = r.state
  return r.value
}
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rand(rng) * xs.length)]!

const mutate = (rng: Rng, input: string): string => {
  let s = input
  const edits = 1 + Math.floor(rand(rng) * 4)
  for (let e = 0; e < edits; e++) {
    const at = Math.floor(rand(rng) * (s.length + 1))
    const op = rand(rng)
    if (op < 0.4) s = s.slice(0, at) + pick(rng, [...ALPHABET]) + s.slice(at)
    else if (op < 0.7) s = s.slice(0, at) + s.slice(at + 1)
    else if (op < 0.9) s = s.slice(0, at) + pick(rng, [...ALPHABET]) + s.slice(at + 1)
    else s = s.slice(0, at) + pick(rng, TABLE) + s.slice(at)
  }
  return s
}

const wellFormed = (r: InstallRequest, command: string) => {
  expect(r.id).toMatch(/^ir-[0-9a-f]{8}$/)
  expect(r.command).toBe(command)
  expect(r.agentId).toBe('fuzz')
  expect(r.at).toBe(7)
  expect(TOOLS.has(r.tool)).toBe(true)
  expect(SOURCES.has(r.source)).toBe(true)
  for (const p of r.packages) {
    expect(isValidName(p.ecosystem, p.name)).toBe(true)
    expect(normalise(p.ecosystem, p.name)).toBe(p.name)
  }
  for (const u of r.unchecked) expect(typeof u).toBe('string')
  expect(r.packages.length + r.unchecked.length > 0 || r.source !== 'explicit').toBe(true)
  if (r.source !== 'explicit') expect(Array.isArray(r.files)).toBe(true)
}

describe('parser fuzz (seeded)', () => {
  test('5,000 random mutations never throw and always produce well-formed, deterministic requests', () => {
    const rng = { state: 0xc0ffee }
    for (let n = 0; n < 5000; n++) {
      const command = mutate(rng, pick(rng, TABLE))
      let out: InstallRequest[] = []
      expect(() => {
        out = parseCommand(command, 'fuzz', 7)
      }).not.toThrow()
      for (const r of out) wellFormed(r, command)
      expect(parseCommand(command, 'fuzz', 7)).toEqual(out)
    }
  })

  test('5,000 random spec tokens are each accounted for: a package or unchecked, never dropped', () => {
    const rng = { state: 0x5eed }
    const SPEC_CHARS = 'abcxyzABC-_.@/:=<>~!^*[],0123456789 '
    const HEADS = ['npm install', 'pnpm add', 'yarn add', 'bun add', 'pip install', 'uv add', 'poetry add', 'pipx install', 'npx', 'uvx']
    for (let n = 0; n < 5000; n++) {
      const len = 1 + Math.floor(rand(rng) * 14)
      let spec = ''
      for (let i = 0; i < len; i++) spec += pick(rng, [...SPEC_CHARS])
      spec = spec.trim()
      if (!spec || spec.startsWith('-')) continue
      const command = `${pick(rng, HEADS)} '${spec}'`
      const out = parseCommand(command, 'fuzz', 7)
      expect(out, command).toHaveLength(1)
      const r = out[0]!
      wellFormed(r, command)
      expect(r.packages.length + r.unchecked.length, command).toBe(1)
      if (r.unchecked.length === 1) expect(r.unchecked[0]).toBe(spec)
    }
  })
})
