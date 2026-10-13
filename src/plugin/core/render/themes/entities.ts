// The shared entity pass (mockup drawEntities): command ship, agents with trails, packages,
// Sentinels and one-shot effects. Every theme runs it last so units read the same in both looks.

import { next } from '../../scene/prng'
import { HOLD_PULSE_MS, RING_RADIUS, SCAN_RING_MS, SHIP } from '../../scene/layout'
import type { Effect, Scene } from '../../scene/events'
import { disc, dot, line, mapOf, px, ring, wx, wy, type MapRect } from '../framebuffer'
import { agentColor, packageLook } from '../overlay'
import type { Framebuffer, Rgb, ThemeTokens } from '../renderer'

const WHITE: Rgb = [255, 255, 255]

/** Pixels per world unit relative to the mockup, where the ring was 22 px. */
export const pixelScale = (m: MapRect): number => (RING_RADIUS * m.size) / 22

const effectColor = (e: Effect, t: ThemeTokens): Rgb =>
  e.tone === 'pass' ? t.pass : e.tone === 'hold' ? t.hold : e.tone === 'refuse' ? t.refuse : WHITE

const drawEffect = (fb: Framebuffer, m: MapRect, e: Effect, t: ThemeTokens): void => {
  const age = Math.max(0, e.totalMs - e.lifeMs) / 1000
  const life = e.totalMs > 0 ? Math.max(0, Math.min(1, e.lifeMs / e.totalMs)) : 0
  const x = wx(m, e.pos.x)
  const y = wy(m, e.pos.y)
  const c = effectColor(e, t)
  if (e.kind === 'glint') {
    dot(fb, x, y, WHITE, life)
    dot(fb, x - 1, y, WHITE, life * 0.6)
    dot(fb, x + 1, y, WHITE, life * 0.6)
    dot(fb, x, y - 1, WHITE, life * 0.6)
    dot(fb, x, y + 1, WHITE, life * 0.6)
    return
  }
  const n = e.kind === 'burst' ? 18 : 6
  const k = pixelScale(m)
  let s = e.seed >>> 0
  for (let i = 0; i < n; i++) {
    const a = next(s)
    const v = next(a.state)
    s = v.state
    const th = a.value * Math.PI * 2
    const speed = (6 + v.value * 14) * k
    px(fb, x + Math.cos(th) * speed * age, y + Math.sin(th) * speed * age, c[0], c[1], c[2], life)
  }
}

export const entitiesPass = (fb: Framebuffer, scene: Scene, _tMs: number, t: ThemeTokens): void => {
  const m = mapOf(fb)
  const k = pixelScale(m)
  const sx = wx(m, SHIP.x)
  const sy = wy(m, SHIP.y)
  disc(fb, sx, sy, Math.max(1, Math.round(2 * k)), t.ship)
  dot(fb, sx, sy, WHITE)

  const agents = scene.agents
  for (const id in agents) {
    const a = agents[id]!
    if (a.state === 'gone') continue
    const c = agentColor(a.type)
    const n = a.trail.length
    for (let i = 0; i < n; i++) {
      const q = a.trail[i]!
      px(fb, wx(m, q.x), wy(m, q.y), c[0], c[1], c[2], (i / n) * 0.55)
    }
    const ax = wx(m, a.pos.x)
    const ay = wy(m, a.pos.y)
    disc(fb, ax, ay, 1, c)
    if (a.glint > 0) dot(fb, ax, ay, WHITE)
  }

  const pkgs = scene.packages
  for (const id in pkgs) {
    const p = pkgs[id]!
    if (p.phase === 'gone') continue
    const look = packageLook(p, t)
    const x = wx(m, p.pos.x)
    const y = wy(m, p.pos.y)
    if (p.phase === 'inbound') {
      const ag = agents[p.agentId]
      if (ag && ag.state !== 'gone') line(fb, wx(m, ag.pos.x), wy(m, ag.pos.y), x, y, look.color, 0.18)
    }
    disc(fb, x, y, 1, look.color)
    if (p.phase === 'held') ring(fb, x, y, (3 + Math.sin((p.phaseMs / HOLD_PULSE_MS) * Math.PI * 2) * 0.8) * k, t.hold, 0.8)
  }

  const sents = scene.sentinels
  for (const id in sents) {
    const se = sents[id]!
    if (se.phase === 'gone') continue
    const x = wx(m, se.pos.x)
    const y = wy(m, se.pos.y)
    disc(fb, x, y, 1, t.sentinel)
    if (se.phase === 'scanning') ring(fb, x, y, (1 + ((se.phaseMs % SCAN_RING_MS) / SCAN_RING_MS) * 4) * k, t.sentinel, 0.7)
  }

  for (const e of scene.effects) drawEffect(fb, m, e, t)
}
