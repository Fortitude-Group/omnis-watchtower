// SC-002 live check (T042): score the 500 most popular packages per ecosystem against the real
// registries and expect zero refusals. Opt-in, because it hits the network for a few minutes:
//   WT_LIVE=1 node node_modules/vitest/vitest.mjs run tests/live
// Writes docs/validation/benign-sweep-<yyyy-mm>.md with every non-pass and why.
import { writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { gatherFacts } from '../../src/plugin/adapters/facts'
import { resetLimiter } from '../../src/plugin/adapters/http'
import type { SourceIo } from '../../src/plugin/adapters/ports'
import { emptyConfig } from '../../src/plugin/adapters/project-config'
import { popularNpm } from '../../src/plugin/core/data/popular-npm'
import { popularPypi } from '../../src/plugin/core/data/popular-pypi'
import type { PackageCheck, PackageRef } from '../../src/plugin/core/model'
import { scorePackage } from '../../src/plugin/core/score/tier'
import { buildTyposquatIndex } from '../../src/plugin/core/score/typosquat'

const LIVE = process.env.WT_LIVE === '1'
const TOP = 500

const nodeIo = (): SourceIo => {
  const data = new Map<string, unknown>()
  return {
    fetch: async (url, init) => {
      const res = await fetch(url, { method: init?.method ?? 'GET', headers: init?.headers, body: init?.body })
      return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), text: await res.text() }
    },
    after: (ms, fn) => { const t = setTimeout(fn, ms); return { cancel: () => clearTimeout(t) } },
    store: { get: async k => data.get(k), set: async (k, v) => { data.set(k, v) }, delete: async k => { data.delete(k) } },
    now: async () => Date.now(),
  }
}

const topPypi = async (): Promise<string[]> => {
  const res = await fetch('https://hugovk.dev/top-pypi-packages/top-pypi-packages.min.json')
  const json = (await res.json()) as { rows: { project: string }[] }
  return json.rows.slice(0, TOP).map(r => r.project.toLowerCase().replace(/[-_.]+/g, '-'))
}

test.skipIf(!LIVE)('no popular package is refused (SC-002)', async () => {
  resetLimiter()
  const io = nodeIo()
  const now = Date.now()
  const index = { npm: buildTyposquatIndex(popularNpm, 'npm'), pypi: buildTyposquatIndex(popularPypi, 'pypi') }
  const refs: PackageRef[] = [
    ...popularNpm.slice(0, TOP).map(name => ({ ecosystem: 'npm' as const, name })),
    ...(await topPypi()).map(name => ({ ecosystem: 'pypi' as const, name })),
  ]
  const checks: PackageCheck[] = []
  for (let i = 0; i < refs.length; i += 50) {
    const facts = await gatherFacts(io, refs.slice(i, i + 50), emptyConfig())
    for (const f of facts) checks.push(scorePackage(f, now, index[f.ref.ecosystem]))
  }
  const count = (t: string) => checks.filter(c => c.tier === t).length
  const notPass = checks.filter(c => c.tier !== 'pass' || c.pinnedTo)
  const month = new Date(now).toISOString().slice(0, 7)
  writeFileSync(`docs/validation/benign-sweep-${month}.md`, [
    `# Benign sweep, ${new Date(now).toISOString()}`,
    '',
    `Top ${TOP} npm (popular-npm.ts) and top ${TOP} PyPI (hugovk top-pypi-packages, live), scored against the live registries.`,
    `SC-002 requires zero refusals.`,
    '',
    `| Tier | Count |`, `|---|---|`,
    ...['pass', 'refuse', 'hold', 'unverified', 'unchecked'].map(t => `| ${t} | ${count(t)} |`),
    `| of which pinned (cooldown) | ${checks.filter(c => c.pinnedTo).length} |`,
    '',
    '## Every package that was not a plain pass',
    '',
    ...notPass.map(c => `- **${c.ref.ecosystem}:${c.ref.name}**: ${c.tier}${c.pinnedTo ? ` (pinned ${c.pinnedTo})` : ''}: ${c.signals.filter(s => s.state !== 'absent' && s.kind !== 'exists').map(s => s.evidence).join('; ') || 'no signal detail'}`),
    '',
  ].join('\n'))
  expect(checks.filter(c => c.tier === 'refuse').map(c => `${c.ref.ecosystem}:${c.ref.name}`)).toEqual([])
}, 900_000)
