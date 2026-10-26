// SC-003 live check (T075): how long the tripwire takes to decide, first time and from cache.
//   WT_LIVE=1 node node_modules/vitest/vitest.mjs run tests/live/latency.test.ts
// Runs the real tripwire service (adapters/tripwire.ts) against the live registries, one command at
// a time as an agent would, and writes docs/validation/latency-<yyyy-mm>.md.
import { writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { resetLimiter } from '../../src/plugin/adapters/http'
import { evaluate } from '../../src/plugin/adapters/tripwire'
import type { TripwireIo } from '../../src/plugin/adapters/tripwire'
import { popularNpm } from '../../src/plugin/core/data/popular-npm'
import { popularPypi } from '../../src/plugin/core/data/popular-pypi'

const LIVE = process.env.WT_LIVE === '1'
const PER_ECOSYSTEM = 100

const nodeIo = (): TripwireIo => {
  const data = new Map<string, unknown>()
  return {
    fetch: async (url, init) => {
      const res = await fetch(url, { method: init?.method ?? 'GET', headers: init?.headers, body: init?.body })
      return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), text: await res.text() }
    },
    after: (ms, fn) => { const t = setTimeout(fn, ms); return { cancel: () => clearTimeout(t) } },
    store: { get: async k => data.get(k), set: async (k, v) => { data.set(k, v) }, delete: async k => { data.delete(k) } },
    now: async () => Date.now(),
    readFile: async () => undefined,
    env: () => undefined,
    cwd: '.',
    overrides: async () => ({ session: {}, permanent: {} }),
    investigations: async () => ({}),
  }
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!
}

test.skipIf(!LIVE)('decisions are fast enough for an agent not to notice (SC-003)', async () => {
  resetLimiter()
  const io = nodeIo()
  const commands = [
    ...popularNpm.slice(0, PER_ECOSYSTEM).map(n => `npm install ${n}`),
    ...popularPypi.slice(0, PER_ECOSYSTEM).map(n => `pip install ${n}`),
  ]
  const first: number[] = []
  const cached: number[] = []
  for (const c of commands) {
    let t = performance.now()
    await evaluate(io, c, 'main', { mode: 'enforce', allowlist: [] })
    first.push(performance.now() - t)
    t = performance.now()
    await evaluate(io, c, 'main', { mode: 'enforce', allowlist: [] })
    cached.push(performance.now() - t)
  }
  const row = (name: string, xs: number[]) =>
    `| ${name} | ${xs.length} | ${pct(xs, 50).toFixed(0)} ms | ${pct(xs, 95).toFixed(0)} ms | ${Math.max(...xs).toFixed(0)} ms |`
  const at = new Date().toISOString()
  writeFileSync(`docs/validation/latency-${at.slice(0, 7)}.md`, [
    `# Decision latency, ${at}`,
    '',
    `The tripwire service deciding \`npm install <name>\` / \`pip install <name>\` for the top ${PER_ECOSYSTEM} names per ecosystem, against the live registries from one machine on a home connection, one command at a time.`,
    'SC-003: first-seen p95 under 5 s, cached under 0.5 s.',
    '',
    '| Decision | Count | p50 | p95 | Max |',
    '|---|---|---|---|---|',
    row('First seen', first),
    row('Cached', cached),
    '',
    'The PyPI names are the top of popular-pypi.ts (hugovk top-pypi-packages, CC BY 4.0). Timings include the private-registry config lookup, which reads no files here.',
    '',
  ].join('\n'))
  expect(pct(first, 95)).toBeLessThan(5_000)
  expect(pct(cached, 95)).toBeLessThan(500)
}, 900_000)
