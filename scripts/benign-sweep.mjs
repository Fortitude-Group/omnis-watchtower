// REQUIRES core/score and adapters/facts (Lane B and Lane E); not runnable until they land.
// SC-002 full check: scores the top 500 packages of each ecosystem live and prints any refusals.
// Usage: node --experimental-strip-types scripts/benign-sweep.mjs [--count 500]
//
// Intended APIs:
//   buildSignals(facts, now, typosquatIndex)          src/plugin/core/score
//   decide(signals, ...)                               src/plugin/core/score
//   gatherFacts(io, refs, privateConfig)               src/plugin/adapters/facts.ts
//   io = { fetch: ({ url, method, headers, body }) => { status, text }, after: (ms, fn) => timer }
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (p) => import(pathToFileURL(join(root, 'src', 'plugin', p)).href)

const { buildSignals, decide } = await load('core/score/index.ts')
const { gatherFacts } = await load('adapters/facts.ts')
const { popularNpm } = await load('core/data/popular-npm.ts')
const { popularPypi } = await load('core/data/popular-pypi.ts')

const countArg = process.argv.indexOf('--count')
const COUNT = countArg > 0 ? Number(process.argv[countArg + 1]) : 500
const CHUNK = 10
const PYPI_URL = 'https://hugovk.github.io/top-pypi-packages/top-pypi-packages.min.json'

const io = {
  fetch: async ({ url, method = 'GET', headers = {}, body }) => {
    const res = await fetch(url, { method, headers, body })
    return { status: res.status, text: await res.text() }
  },
  after: (ms, fn) => setTimeout(fn, ms)
}

// PyPI: the bundled list is a 100-name placeholder, so the sweep reads the live top-N instead.
const livePypi = (await (await fetch(PYPI_URL)).json()).rows.slice(0, COUNT).map((r) => r.project)
const targets = [
  ...popularNpm.slice(0, COUNT).map((name) => ({ ecosystem: 'npm', name })),
  ...livePypi.map((name) => ({ ecosystem: 'pypi', name }))
]
const typosquatIndex = { npm: popularNpm, pypi: popularPypi }
const privateConfig = { allowlist: [], registries: [] }

const refusals = []
let done = 0
for (let i = 0; i < targets.length; i += CHUNK) {
  const refs = targets.slice(i, i + CHUNK)
  const facts = await gatherFacts(io, refs, privateConfig)
  for (const ref of refs) {
    const signals = buildSignals(facts[`${ref.ecosystem}:${ref.name}`] ?? facts, Date.now(), typosquatIndex)
    const decision = decide(signals)
    if (decision.tier === 'refuse') refusals.push({ ref, evidence: decision.evidence })
  }
  done += refs.length
  if (done % 100 === 0) console.log(`scored ${done}/${targets.length}`)
}

console.log(`\n${targets.length} packages scored, ${refusals.length} refused`)
for (const r of refusals) console.log(`REFUSED ${r.ref.ecosystem}:${r.ref.name}\n  ${(r.evidence ?? []).join('\n  ')}`)
process.exit(refusals.length === 0 ? 0 : 1)
