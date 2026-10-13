// SC-008: the demo replays identically. Hashes the Scene itself after every frame; the Scene is
// theme-independent (themes only change how renderers draw it), so one hash chain covers both
// themes here. Rendered-frame hashes per theme belong to the renderer golden tests.

import { describe, expect, test } from 'vitest'
import { DEMO_SCRIPT, DEMO_SEED } from '../../../src/plugin/core/data/demo-script'
import { replay, scriptDuration } from '../../../src/plugin/core/scene/replay'
import type { Scene } from '../../../src/plugin/core/scene/events'
import { fnv } from './helpers'

const STEP = 33

const hashRun = (): string[] => {
  const frames: string[] = []
  replay(DEMO_SCRIPT, DEMO_SEED, STEP, (scene) => frames.push(fnv(JSON.stringify(scene))))
  return frames
}

describe('demo script', () => {
  test('lasts about 45 seconds and is sorted', () => {
    const d = scriptDuration(DEMO_SCRIPT)
    expect(d).toBeGreaterThanOrEqual(40_000)
    expect(d).toBeLessThanOrEqual(50_000)
    const times = DEMO_SCRIPT.map((e) => e.atMs)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  test('10 consecutive replays give identical frame hashes', () => {
    const first = hashRun()
    expect(first.length).toBeGreaterThan(1000)
    for (let i = 1; i < 10; i++) expect(hashRun()).toEqual(first)
  })

  test('it tells the whole story', () => {
    const seen = { agents: new Set<string>(), bursting: new Set<string>(), held: new Set<string>(), passing: new Set<string>(), scanning: 0 }
    const end = replay(DEMO_SCRIPT, DEMO_SEED, STEP, (s: Scene) => {
      for (const a of Object.values(s.agents)) if (a.state === 'working') seen.agents.add(a.type)
      for (const p of Object.values(s.packages)) {
        if (p.phase === 'bursting') seen.bursting.add(p.ref.name)
        if (p.phase === 'held') seen.held.add(p.ref.name)
        if (p.phase === 'passing') seen.passing.add(p.ref.name)
      }
      for (const x of Object.values(s.sentinels)) if (x.phase === 'scanning') seen.scanning++
    })
    expect([...seen.agents].sort()).toEqual(['coder', 'researcher', 'tester'])
    expect([...seen.passing].sort()).toEqual(['chalk', 'express', 'left-padx', 'numpy'])
    expect([...seen.bursting].sort()).toEqual(['fastapi-auth-kit', 'react-dom-utilz', 'reqeusts'])
    expect([...seen.held].sort()).toEqual(['fastapi-auth-kit', 'left-padx'])
    expect(seen.scanning).toBeGreaterThan(0)
    expect(end.demo).toBe(true)
    expect(end.totals).toMatchObject({ intercepts: 7, passed: 4, refused: 3, held: 2 })
    expect(end.log.map((l) => l.text)).toContain('fastapi-auth-kit refused · obfuscated postinstall')
    // Everything has flown home by the end.
    expect(end.agents).toEqual({})
    expect(end.packages).toEqual({})
    expect(end.sentinels).toEqual({})
  })
})
