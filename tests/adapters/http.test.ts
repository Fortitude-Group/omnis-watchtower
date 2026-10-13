import { beforeEach, describe, expect, it } from 'vitest'
import { fetchJson, MAX_IN_FLIGHT, resetLimiter, RETRY_BACKOFF_MS, TIMEOUT_MS } from '../../src/plugin/adapters/http'
import type { HttpIo, HttpReply, HttpRequest } from '../../src/plugin/adapters/ports'

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

// A clock that moves only when the test advances it, firing due timers in order
const fakeClock = () => {
  let now = 0
  let timers: Array<{ at: number, fn: () => void }> = []
  return {
    now: () => now,
    after: (ms: number, fn: () => void) => {
      const timer = { at: now + ms, fn }
      timers.push(timer)
      return { cancel: () => { timers = timers.filter(t => t !== timer) } }
    },
    advance: async (ms: number) => {
      const end = now + ms
      await flush()
      for (;;) {
        const due = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers = timers.filter(t => t !== due)
        now = due.at
        due.fn()
        await flush()
      }
      now = end
      await flush()
    },
    pending: () => timers.length,
  }
}

const reply = (status: number, body: unknown): HttpReply => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {},
  text: typeof body === 'string' ? body : JSON.stringify(body),
})

const setup = (answer: (url: string, init: HttpRequest | undefined, now: number) => Promise<HttpReply> | HttpReply) => {
  const clock = fakeClock()
  const calls: Array<{ url: string, init?: HttpRequest, at: number }> = []
  const io: HttpIo = {
    fetch: async (url, init) => {
      calls.push({ url, init, at: clock.now() })
      return answer(url, init, clock.now())
    },
    after: clock.after,
  }
  return { clock, calls, io }
}

beforeEach(() => resetLimiter())

describe('fetchJson', () => {
  it('resolves a 200 with its parsed JSON and leaves no timer behind', async () => {
    const { io, calls, clock } = setup(() => reply(200, { name: 'chalk' }))

    expect(await fetchJson(io, 'https://registry.example/chalk')).toEqual({ ok: true, status: 200, json: { name: 'chalk' } })
    expect(calls[0]?.init).toEqual({ method: 'GET', headers: { accept: 'application/json' } })
    expect(clock.pending()).toBe(0)
  })

  it('POSTs a JSON body with a JSON content type', async () => {
    const { io, calls } = setup(() => reply(200, { vulns: [] }))

    await fetchJson(io, 'https://osv.example/v1/query', { json: { package: { name: 'x', ecosystem: 'npm' } } })
    expect(calls[0]?.init).toEqual({
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"package":{"name":"x","ecosystem":"npm"}}',
    })
  })

  it('keeps a 404 status and does not retry it', async () => {
    const { io, calls } = setup(() => reply(404, { error: 'Not found' }))

    expect(await fetchJson(io, 'https://registry.example/react-dom-utilz')).toEqual({ ok: false, status: 404, reason: 'http' })
    expect(calls).toHaveLength(1)
  })

  it('treats a 2xx that is not JSON as an http failure', async () => {
    const { io } = setup(() => reply(200, '<html>'))

    expect(await fetchJson(io, 'https://x.example/')).toEqual({ ok: false, status: 200, reason: 'http' })
  })

  it('times out at 4 s and ignores the late answer', async () => {
    const { io, clock } = setup(() => new Promise(() => {}))
    let result: unknown
    fetchJson(io, 'https://slow.example/').then(r => { result = r })

    await clock.advance(TIMEOUT_MS - 1)
    expect(result).toBeUndefined()
    await clock.advance(1)
    expect(result).toEqual({ ok: false, reason: 'timeout' })
  })

  it('reports a rejected fetch as a network failure', async () => {
    const { io } = setup(() => { throw new Error('ECONNREFUSED') })

    expect(await fetchJson(io, 'https://down.example/')).toEqual({ ok: false, reason: 'network' })
  })

  it('backs off after a 429 and returns the retry', async () => {
    const { io, calls, clock } = setup((_, __, now) => now === 0 ? reply(429, '') : reply(200, { ok: 1 }))
    let result: unknown
    fetchJson(io, 'https://busy.example/').then(r => { result = r })

    await clock.advance(RETRY_BACKOFF_MS)
    expect(result).toEqual({ ok: true, status: 200, json: { ok: 1 } })
    expect(calls.map(c => c.at)).toEqual([0, RETRY_BACKOFF_MS])
  })

  it('gives up after one retry: rate-limited for 429, http for 5xx', async () => {
    for (const [status, reason] of [[429, 'rate-limited'], [503, 'http']] as const) {
      const { io, calls, clock } = setup(() => reply(status, ''))
      let result: unknown
      fetchJson(io, 'https://broken.example/').then(r => { result = r })

      await clock.advance(RETRY_BACKOFF_MS)
      expect(result).toEqual({ ok: false, status, reason })
      expect(calls).toHaveLength(2)
    }
  })

  it('never has more than 8 fetches in flight', async () => {
    let active = 0
    let peak = 0
    const clock = fakeClock()
    const io: HttpIo = {
      fetch: url => {
        active++
        peak = Math.max(peak, active)
        return new Promise(resolve => clock.after(100, () => {
          active--
          resolve(reply(200, { url }))
        }))
      },
      after: clock.after,
    }
    const urls = Array.from({ length: 20 }, (_, i) => `https://many.example/${i}`)
    const all = Promise.all(urls.map(url => fetchJson(io, url)))

    await clock.advance(0)
    expect(active).toBe(MAX_IN_FLIGHT)
    await clock.advance(300)

    const results = await all
    expect(peak).toBe(MAX_IN_FLIGHT)
    expect(results.map(r => r.ok && (r.json as { url: string }).url)).toEqual(urls)
  })
})
