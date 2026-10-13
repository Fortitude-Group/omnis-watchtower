import { describe, expect, it } from 'vitest'
import { cacheGet, cacheSet, TTL } from '../../src/plugin/adapters/cache'
import type { CacheIo } from '../../src/plugin/adapters/ports'

// An in-memory store that round-trips through JSON, as $.store does, and a manual clock
const setup = (entries: Record<string, unknown> = {}) => {
  const data = new Map(Object.entries(entries))
  let now = 1_000
  const io: CacheIo = {
    store: {
      get: async key => data.get(key),
      set: async (key, value) => { data.set(key, JSON.parse(JSON.stringify(value))) },
      delete: async key => { data.delete(key) },
    },
    now: async () => now,
  }
  return { io, data, advance: (ms: number) => { now += ms } }
}

describe('cache', () => {
  it('has the TTLs of the persistence map', () => {
    const hour = 3_600_000
    expect(TTL).toEqual({ metadata: 6 * hour, osv: hour, notFound: 6 * hour, verdict: 24 * hour })
  })

  it('reads back a value set, under a wt: namespaced key', async () => {
    const { io, data } = setup()

    await cacheSet(io, 'npm', 'chalk@5.3.0', { exists: true }, TTL.metadata)
    expect(await cacheGet(io, 'npm', 'chalk@5.3.0')).toEqual({ exists: true })
    expect([...data.keys()]).toEqual(['wt:npm:chalk@5.3.0'])
    expect(data.get('wt:npm:chalk@5.3.0')).toEqual({ value: { exists: true }, expiresAt: 1_000 + TTL.metadata })
  })

  it('misses once the TTL has passed, and deletes the entry', async () => {
    const { io, data, advance } = setup()
    await cacheSet(io, 'osv', 'npm/left-pad', ['GHSA-1'], TTL.osv)

    advance(TTL.osv - 1)
    expect(await cacheGet(io, 'osv', 'npm/left-pad')).toEqual(['GHSA-1'])
    advance(1)
    expect(await cacheGet(io, 'osv', 'npm/left-pad')).toBeUndefined()
    expect(data.size).toBe(0)
  })

  it('keeps namespaces apart', async () => {
    const { io } = setup()
    await cacheSet(io, 'npm', 'requests', 'npm value', TTL.metadata)
    await cacheSet(io, 'pypi', 'requests', 'pypi value', TTL.metadata)

    expect(await cacheGet(io, 'npm', 'requests')).toBe('npm value')
    expect(await cacheGet(io, 'pypi', 'requests')).toBe('pypi value')
    expect(await cacheGet(io, 'verdict', 'requests')).toBeUndefined()
  })

  it('treats a stored value that is not a cache entry as a miss', async () => {
    const { io } = setup({ 'wt:npm:odd': 'raw string' })

    expect(await cacheGet(io, 'npm', 'odd')).toBeUndefined()
  })
})
