import type { HttpIo, HttpReply } from './ports'

export type FetchInit = {
  method?: string
  headers?: Record<string, string>
  // Serialised with JSON.stringify and sent with a JSON content type (POST by default)
  json?: unknown
}

export type FetchFailure = 'timeout' | 'network' | 'rate-limited' | 'http'

export type FetchResult =
  | { ok: true, status: number, json: unknown }
  | { ok: false, status?: number, reason: FetchFailure }

export const TIMEOUT_MS = 4_000
export const MAX_IN_FLIGHT = 8
export const RETRY_BACKOFF_MS = 500

// Shared by every call in the module's environment
const limiter = { active: 0, waiting: [] as Array<() => void> }

export const resetLimiter = () => {
  limiter.active = 0
  limiter.waiting = []
}

const acquire = (): Promise<void> => {
  if (limiter.active < MAX_IN_FLIGHT) {
    limiter.active++
    return Promise.resolve()
  }
  return new Promise(resolve => limiter.waiting.push(resolve))
}

const release = () => {
  const next = limiter.waiting.shift()
  // The slot passes straight to the next waiter, so `active` stays put
  if (next) next()
  else limiter.active--
}

type Attempt =
  | { kind: 'reply', reply: HttpReply }
  | { kind: 'timeout' }
  | { kind: 'network' }

// The fetch port takes no signal, so the timeout is a race against a timer.
// A timed-out request is abandoned (its slot is released) and its late answer ignored.
const attempt = (io: HttpIo, url: string, init: FetchInit): Promise<Attempt> => {
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers }
  const body = init.json === undefined ? undefined : JSON.stringify(init.json)
  if (body !== undefined) headers['content-type'] = 'application/json'
  const method = init.method ?? (body === undefined ? 'GET' : 'POST')

  return new Promise(resolve => {
    let isSettled = false
    let timer: { cancel: () => void } | undefined
    const settle = (result: Attempt) => {
      if (isSettled) return
      isSettled = true
      timer?.cancel()
      resolve(result)
    }
    // A refused timer must not make fetchJson throw; the fetch then runs untimed
    try {
      timer = io.after(TIMEOUT_MS, () => settle({ kind: 'timeout' }))
    } catch {}
    Promise.resolve()
      .then(() => io.fetch(url, body === undefined ? { method, headers } : { method, headers, body }))
      .then(reply => settle({ kind: 'reply', reply }), () => settle({ kind: 'network' }))
  })
}

const wait = (io: HttpIo, ms: number) =>
  new Promise<void>(resolve => {
    try {
      io.after(ms, resolve)
    } catch {
      resolve()
    }
  })

const isRetryable = (status: number) => status === 429 || status >= 500

const toResult = (outcome: Attempt): FetchResult => {
  if (outcome.kind !== 'reply') return { ok: false, reason: outcome.kind }
  const { status, ok, text } = outcome.reply
  if (status === 429) return { ok: false, status, reason: 'rate-limited' }
  if (!ok) return { ok: false, status, reason: 'http' }
  try {
    return { ok: true, status, json: JSON.parse(text) }
  } catch {
    // A 2xx whose body is not JSON is as useless to callers as an error status
    return { ok: false, status, reason: 'http' }
  }
}

export const fetchJson = async (io: HttpIo, url: string, init: FetchInit = {}): Promise<FetchResult> => {
  await acquire()
  try {
    let outcome = await attempt(io, url, init)
    if (outcome.kind === 'reply' && isRetryable(outcome.reply.status)) {
      await wait(io, RETRY_BACKOFF_MS)
      outcome = await attempt(io, url, init)
    }
    return toResult(outcome)
  } finally {
    release()
  }
}
