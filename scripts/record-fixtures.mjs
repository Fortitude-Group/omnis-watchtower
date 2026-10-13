// Records live registry/advisory responses as TypeScript fixture modules.
// Usage: node scripts/record-fixtures.mjs [--only npm:chalk,pypi:requests]
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'tests', 'fixtures', 'http')
const CONCURRENCY = 4
const HOST_GAP_MS = 150
const SLOW_HOSTS = { 'api.npmjs.org': 1000 }
const ATTEMPTS = 4
const TIMEOUT_MS = 15000
const BENIGN_COUNT = 50

const NAMED = {
  npm: ['chalk', 'lodash', 'express', 'react', 'zod', 'react-dom-utilz', 'crossenv'],
  pypi: ['requests', 'numpy', 'pyyaml', 'reqeusts', 'ctx']
}

const TRIM_NOTES = {
  npm: [
    'versions lists are sampled: earliest + 30 most recent (+ default / info.version)',
    'registry latest: name, version, scripts, repository, maintainers, dist.tarball only',
    'deps.dev: versions[].{versionKey.version, publishedAt, isDefault} only',
    'downloads: whole body',
    'OSV: vulns[].{id, summary, aliases, database_specific, affected[].versions (first 20)}',
    '404 bodies are recorded as null'
  ],
  pypi: [
    'versions lists are sampled: earliest + 30 most recent (+ default / info.version); one file entry per packagetype per release (earliest upload)',
    'pypi json: info.{name, version, project_urls, home_page}; releases reduced to { "<ver>": [{ packagetype, upload_time_iso_8601 }] }',
    'pypistats: whole body',
    'OSV: vulns[].{id, summary, aliases, database_specific, affected[].versions (first 20)}',
    '404 bodies are recorded as null'
  ]
}

const safeName = (name) => name.toLowerCase().replace(/@/g, 'at-').replace(/\//g, '__')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const nextSlot = new Map()
async function politeWait(host) {
  const now = Date.now()
  const at = Math.max(now, nextSlot.get(host) ?? 0)
  nextSlot.set(host, at + (SLOW_HOSTS[host] ?? HOST_GAP_MS))
  if (at > now) await sleep(at - now)
}

async function request(method, url, body) {
  const host = new URL(url).host
  let lastErr
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    await politeWait(host)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : { accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if ((res.status === 429 || res.status >= 500) && attempt < ATTEMPTS - 1) {
        lastErr = new Error(`HTTP ${res.status}`)
        await sleep(2000 * (attempt + 1))
        continue
      }
      return { status: res.status, text: await res.text() }
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

const pick = (obj, keys) => {
  const out = {}
  for (const k of keys) if (obj && k in obj) out[k] = obj[k]
  return out
}

const trimNpmLatest = (b) => ({
  ...pick(b, ['name', 'version', 'scripts', 'repository', 'maintainers']),
  ...(b?.dist ? { dist: pick(b.dist, ['tarball']) } : {})
})

// earliest by time, the 30 most recent, and the always-kept ones
const KEEP_RECENT = 30
function sample(items, timeOf, always) {
  const sorted = [...items].sort((a, b) => (timeOf(a) ?? '').localeCompare(timeOf(b) ?? ''))
  const keep = new Set(sorted.slice(0, 1))
  for (const x of sorted.slice(-KEEP_RECENT)) keep.add(x)
  for (const x of items) if (always(x)) keep.add(x)
  return items.filter((x) => keep.has(x))
}

const trimDepsDev = (b) => ({
  versions: sample(b?.versions ?? [], (v) => v.publishedAt, (v) => v.isDefault).map((v) => ({
    versionKey: { version: v.versionKey?.version },
    publishedAt: v.publishedAt,
    isDefault: v.isDefault
  }))
})

const trimPypi = (b) => {
  const releases = {}
  const timeOf = ([, files]) => files.map((f) => f.upload_time_iso_8601).sort()[0]
  const entries = sample(Object.entries(b?.releases ?? {}), timeOf, ([ver]) => ver === b?.info?.version)
  for (const [ver, files] of entries) {
    // one entry per packagetype (earliest upload) keeps sdist-only and age checks intact
    const byType = new Map()
    for (const f of files) {
      const cur = byType.get(f.packagetype)
      if (!cur || (f.upload_time_iso_8601 ?? '') < (cur.upload_time_iso_8601 ?? '')) byType.set(f.packagetype, f)
    }
    releases[ver] = [...byType.values()].map((f) => pick(f, ['packagetype', 'upload_time_iso_8601']))
  }
  return { info: pick(b?.info, ['name', 'version', 'project_urls', 'home_page']), releases }
}

const trimOsv = (b) => {
  if (!b || !Array.isArray(b.vulns)) return b
  return {
    vulns: b.vulns.map((v) => ({
      ...pick(v, ['id', 'summary', 'aliases', 'database_specific']),
      affected: (v.affected ?? []).map((a) => ({ versions: (a.versions ?? []).slice(0, 20) }))
    }))
  }
}

function endpoints(eco, name) {
  const osvBody = JSON.stringify({ package: { name, ecosystem: eco === 'npm' ? 'npm' : 'PyPI' } })
  const osv = { method: 'POST', url: 'https://api.osv.dev/v1/query', body: osvBody, trim: trimOsv }
  if (eco === 'npm') {
    const enc = encodeURIComponent(name)
    return [
      { method: 'GET', url: `https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`, trim: trimNpmLatest },
      { method: 'GET', url: `https://api.deps.dev/v3/systems/npm/packages/${enc}`, trim: trimDepsDev },
      { method: 'GET', url: `https://api.npmjs.org/downloads/point/last-week/${name}` },
      osv
    ]
  }
  return [
    { method: 'GET', url: `https://pypi.org/pypi/${name}/json`, trim: trimPypi },
    { method: 'GET', url: `https://pypistats.org/api/packages/${name}/recent` },
    osv
  ]
}

const keyOf = (e) => (e.method === 'POST' ? `POST ${e.url} ${e.body}` : `GET ${e.url}`)

async function recordPackage(eco, name, failures) {
  const fixtures = {}
  for (const e of endpoints(eco, name)) {
    const key = keyOf(e)
    try {
      const { status, text } = await request(e.method, e.url, e.body)
      if (status >= 500 || status === 429) {
        failures.push(`${key}: HTTP ${status}`)
        continue
      }
      let body = null
      if (status !== 404) {
        try {
          const parsed = JSON.parse(text)
          body = e.trim && status === 200 ? e.trim(parsed) : parsed
        } catch {
          body = text
        }
      }
      fixtures[key] = { status, body }
    } catch (err) {
      failures.push(`${key}: ${err?.cause?.code ?? err?.message ?? err}`)
    }
  }
  return fixtures
}

async function writeFixtureFile(eco, name, fixtures, stamp) {
  const dir = join(outDir, eco)
  await mkdir(dir, { recursive: true })
  const header = [
    '// Recorded live HTTP responses. Do not edit by hand.',
    `// Captured ${stamp} (UTC). Generated by scripts/record-fixtures.mjs`,
    `// Package: ${eco}:${name}`,
    '// Trimming applied to keep files small:',
    ...TRIM_NOTES[eco].map((n) => `//   - ${n}`)
  ].join('\n')
  const src = `${header}\n\nexport const fixtures: Record<string, { status: number; body: unknown }> = {\n${Object.entries(fixtures).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`
  await writeFile(join(dir, `${safeName(name)}.ts`), src)
}

async function writeIndex() {
  const entries = []
  for (const eco of ['npm', 'pypi']) {
    let files = []
    try {
      files = (await readdir(join(outDir, eco))).filter((f) => f.endsWith('.ts')).sort()
    } catch {}
    for (const f of files) entries.push({ eco, base: f.slice(0, -3) })
  }
  const lines = [
    '// Generated by scripts/record-fixtures.mjs. Do not edit by hand.',
    ...entries.map((e, i) => `import { fixtures as f${i} } from './${e.eco}/${e.base}'`),
    '',
    'type Fixture = { status: number; body: unknown }',
    '',
    'const byPackage: Record<string, Record<string, Fixture>> = {',
    ...entries.map((e, i) => `  ${JSON.stringify(`${e.eco}:${e.base}`)}: f${i},`),
    '}',
    '',
    'export const allFixtures: Record<string, Fixture> = Object.assign({}, ...Object.values(byPackage))',
    '',
    'const safeName = (name: string): string => name.toLowerCase().replace(/@/g, \'at-\').replace(/\\//g, \'__\')',
    '',
    'export function fixturesFor(ecosystem: \'npm\' | \'pypi\', name: string): Record<string, Fixture> | undefined {',
    '  return byPackage[`${ecosystem}:${safeName(name)}`]',
    '}',
    ''
  ]
  await writeFile(join(outDir, 'index.ts'), lines.join('\n'))
}

async function benignLists() {
  const jr = await request('GET', 'https://cdn.jsdelivr.net/npm/npm-high-impact/lib/top.js')
  if (jr.status !== 200) throw new Error(`npm-high-impact top.js: HTTP ${jr.status}`)
  const npmAll = [...jr.text.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2])
  const py = await request('GET', 'https://hugovk.github.io/top-pypi-packages/top-pypi-packages.min.json')
  if (py.status !== 200) throw new Error(`top-pypi-packages: HTTP ${py.status}`)
  const pyAll = JSON.parse(py.text).rows.map((r) => r.project)
  const take = (all, named) => {
    const skip = new Set(named)
    return all.filter((n) => !skip.has(n.toLowerCase())).slice(0, BENIGN_COUNT)
  }
  return { npm: take(npmAll, NAMED.npm), pypi: take(pyAll, NAMED.pypi) }
}

async function main() {
  const args = process.argv.slice(2)
  const onlyIdx = args.indexOf('--only')
  let jobs = []
  let benign = null
  if (onlyIdx >= 0) {
    const spec = args[onlyIdx + 1]
    if (!spec) throw new Error('--only needs a value like npm:chalk,pypi:requests')
    for (const item of spec.split(',')) {
      const i = item.indexOf(':')
      const eco = item.slice(0, i)
      const name = item.slice(i + 1)
      if (!['npm', 'pypi'].includes(eco) || !name) throw new Error(`bad --only entry: ${item}`)
      jobs.push({ eco, name })
    }
  } else {
    benign = await benignLists()
    for (const eco of ['npm', 'pypi']) {
      for (const name of [...NAMED[eco], ...benign[eco]]) jobs.push({ eco, name })
    }
  }

  const stamp = new Date().toISOString()
  const failures = []
  const counts = { npm: 0, pypi: 0 }
  let cursor = 0
  const worker = async () => {
    while (cursor < jobs.length) {
      const { eco, name } = jobs[cursor++]
      const fixtures = await recordPackage(eco, name, failures)
      if (Object.keys(fixtures).length > 0) {
        await writeFixtureFile(eco, name, fixtures, stamp)
        counts[eco]++
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  if (benign) {
    const src = [
      '// Benign package names for the corpus tests. Generated by scripts/record-fixtures.mjs',
      `// Captured ${stamp} (UTC).`,
      '// npm: first 50 of npm-high-impact (https://cdn.jsdelivr.net/npm/npm-high-impact/lib/top.js)',
      '// pypi: first 50 of https://hugovk.github.io/top-pypi-packages/top-pypi-packages.min.json',
      '// Names also in the named recording set are excluded.',
      '',
      `export const benignNpm: string[] = ${JSON.stringify(benign.npm, null, 2)}`,
      '',
      `export const benignPypi: string[] = ${JSON.stringify(benign.pypi, null, 2)}`,
      ''
    ].join('\n')
    await mkdir(outDir, { recursive: true })
    await writeFile(join(outDir, 'benign-names.ts'), src)
  }
  await writeIndex()

  console.log(`recorded npm=${counts.npm} pypi=${counts.pypi} packages`)
  if (failures.length > 0) {
    console.error(`${failures.length} request(s) failed:`)
    for (const f of failures) console.error(`  ${f}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(`record-fixtures: ${err?.message ?? err}`)
  process.exit(1)
})
