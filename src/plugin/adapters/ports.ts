// Ports: the plain functions adapters take in place of `$`.
//
// The host scans each hooks module and refuses one that passes `$` across an import
// ("$ is followed only into a function declared in this same file"), so adapters never
// see `$`. A hook file builds the ports itself, with closures that spell each call out:
//
//   const http: HttpIo = {
//     fetch: (url, init) => $.http.fetch(url, init),
//     after: (ms, fn) => $.clock.after(ms, fn),
//   }
//   const cache: CacheIo = {
//     store: {
//       get: key => $.store.get(key),
//       set: (key, value) => $.store.set(key, value),
//       delete: key => $.store.delete(key),
//     },
//     now: () => $.clock.now(),
//   }
//
// The calls must be spelled in the plugin's own hooks modules (the scan follows imports
// from register.ts): the host refuses a `$` call its scan did not list. A test-tier hook
// can make no `$` calls at all, so engine tests drive a port through a plugin hook and
// answer it with the test's `on('http.fetch', () => ({ value: response }))`.
//
// Types are written out here rather than imported from 'claude-code', so adapters also
// typecheck and run under Node for vitest. They mirror HttpInit, HttpResponse, Timer and
// `$.store` in the engine's declarations.

export type HttpRequest = {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export type HttpReply = {
  status: number
  ok: boolean
  headers: Record<string, string>
  text: string
}

// `$.http.fetch(url, init)`: takes no signal or timeout, resolves once the body is read
export type HttpPort = (url: string, init?: HttpRequest) => Promise<HttpReply>

// `$.clock.after(ms, fn)`: unlike `$.clock.sleep`, its wait is not charged to the hook's budget
export type TimerPort = (ms: number, fn: () => void) => { cancel: () => void }

export type StorePort = {
  get: (key: string) => Promise<unknown>
  // `value` must be JSON data; it reads back as JSON.parse(JSON.stringify(value))
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}

export type NowPort = () => Promise<number>

export type HttpIo = { fetch: HttpPort, after: TimerPort }

export type CacheIo = { store: StorePort, now: NowPort }

// Both halves an adapter that fetches and caches needs; the keys do not overlap
export type SourceIo = HttpIo & CacheIo

// Resolves the file's text, or undefined when it does not exist or cannot be read
export type ReadFilePort = (path: string) => Promise<string | undefined>

// `$.env`-style lookup; undefined when the variable is unset
export type EnvPort = (name: string) => Promise<string | undefined> | string | undefined
