import type { CacheIo } from './ports'

const HOUR = 60 * 60 * 1000

export const TTL = {
  metadata: 6 * HOUR,
  osv: 1 * HOUR,
  notFound: 6 * HOUR,
  verdict: 24 * HOUR,
} as const

type Entry = { value: unknown, expiresAt: number }

export const cacheKey = (namespace: string, key: string) => `wt:${namespace}:${key}`

const isEntry = (raw: unknown): raw is Entry =>
  typeof raw === 'object' && raw !== null && 'expiresAt' in raw && typeof raw.expiresAt === 'number'

// Resolves undefined on a miss or an expired entry; an expired entry is deleted
export const cacheGet = async <T>(io: CacheIo, namespace: string, key: string): Promise<T | undefined> => {
  const storeKey = cacheKey(namespace, key)
  const raw = await io.store.get(storeKey)
  if (!isEntry(raw)) return undefined
  if (raw.expiresAt <= await io.now()) {
    await io.store.delete(storeKey)
    return undefined
  }
  return raw.value as T
}

// `value` must be JSON data, as $.store.set requires
export const cacheSet = async (io: CacheIo, namespace: string, key: string, value: unknown, ttlMs: number): Promise<void> => {
  const entry: Entry = { value, expiresAt: await io.now() + ttlMs }
  await io.store.set(cacheKey(namespace, key), entry)
}
