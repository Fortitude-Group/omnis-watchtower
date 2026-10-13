// A hand-built Scene with one of everything the renderer draws, independent of reduce/step.

import { emptyScene, type AgentSprite, type PackageSprite, type Scene } from '../../../src/plugin/core/scene/events'

const polar = (angle: number, d: number) => ({ x: 0.5 + Math.cos(angle) * d, y: 0.5 + Math.sin(angle) * d })

const agent = (id: string, type: string, angle: number, radius: number, tokens: number): AgentSprite => {
  const trail = Array.from({ length: 12 }, (_, i) => polar(angle - (12 - i) * 0.06, radius))
  return {
    id,
    type,
    state: 'working',
    tokens: { input: tokens, output: Math.round(tokens / 4), cacheRead: 0, cacheWrite: 0 },
    pos: polar(angle, radius),
    orbit: { radius, angle, speed: 0.8 },
    trail,
    glint: id === 'a2' ? 300 : 0,
  }
}

const pkg = (id: string, name: string, phase: PackageSprite['phase'], angle: number, d: number, extra: Partial<PackageSprite> = {}): PackageSprite => ({
  id,
  ref: { ecosystem: 'npm', name },
  key: `npm:${name}`,
  agentId: 'a1',
  phase,
  angle,
  distance: d,
  pos: polar(angle, d),
  evidence: [],
  phaseMs: 200,
  ...extra,
})

export const fixtureScene = (opts: { fault?: boolean; demo?: boolean } = {}): Scene => {
  const s = emptyScene(42)
  s.t = 12_000
  s.agents = {
    a1: agent('a1', 'Explore', 0.4, 0.2, 8_200),
    a2: agent('a2', 'coder', 2.5, 0.16, 41_700),
    a3: agent('a3', 'reviewer', 4.4, 0.23, 950),
  }
  s.packages = {
    p1: pkg('p1', 'lodash', 'inbound', 5.5, 0.55),
    p2: pkg('p2', 'chalk', 'passing', 1.2, 0.25, { tier: 'pass' }),
    p3: pkg('p3', 'left-padx', 'held', 3.3, 0.385, { tier: 'hold', evidence: ['published 2 days ago'] }),
    p4: pkg('p4', 'reqeusts', 'bursting', 0.1, 0.385, { tier: 'refuse', evidence: ['typosquat of requests'] }),
  }
  s.sentinels = { s1: { id: 's1', targetKey: 'npm:left-padx', phase: 'scanning', pos: polar(3.3, 0.385), phaseMs: 350 } }
  s.effects = [
    { kind: 'burst', pos: polar(0.1, 0.385), tone: 'refuse', lifeMs: 600, totalMs: 1000, seed: 1234 },
    { kind: 'pass-flash', pos: { x: 0.5, y: 0.5 }, tone: 'pass', lifeMs: 300, totalMs: 500, seed: 99 },
  ]
  s.log = [
    { at: 1000, glyph: '▲', tone: 'agent', text: 'Explore launched' },
    { at: 2000, glyph: '▲', tone: 'agent', text: 'coder launched' },
    { at: 3000, glyph: '✔', tone: 'pass', text: 'chalk passed' },
    { at: 4000, glyph: '◆', tone: 'hold', text: 'left-padx held · published 2 days ago' },
    { at: 5000, glyph: '✖', tone: 'refuse', text: 'reqeusts refused · typosquat of requests' },
  ]
  s.totals = { intercepts: 6, passed: 3, held: 1, refused: 1, unverified: 0, unchecked: 1, overridden: 0 }
  s.tokens = { input: 40_000, output: 10_850, cacheRead: 12_000, cacheWrite: 3_000 }
  s.estCostUsd = 0.42
  s.unpricedTokens = 0
  if (opts.fault) s.fault = { where: 'gate', message: 'registry timeout', at: 11_000 }
  if (opts.demo) s.demo = true
  return s
}

/** Decodes a RasterFrame's cells into rows of text (half-blocks shown as spaces). */
export const decodeCells = (cells: string): Uint32Array => {
  const buf = Buffer.from(cells, 'base64')
  const out = new Uint32Array(buf.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = buf.readUInt32LE(i * 4)
  return out
}

export const textRows = (frame: { columns: number; rows: number; cells: string }): string[] => {
  const w = decodeCells(frame.cells)
  const rows: string[] = []
  for (let r = 0; r < frame.rows; r++) {
    let line = ''
    for (let c = 0; c < frame.columns; c++) {
      const cp = w[(r * frame.columns + c) * 3]!
      line += cp === 0x2580 ? ' ' : String.fromCodePoint(cp)
    }
    rows.push(line)
  }
  return rows
}

/** FNV-1a 32-bit over the base64 string: a stable golden fingerprint. */
export const fnv1a = (s: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}
