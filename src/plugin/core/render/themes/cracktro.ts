// Cracktro: copper bars, 3D starfield, rainbow-cycling tripwire ring and a rainbow scrolltext
// footer (drawn by the overlay). Persistence 0, so every pixel is a pure function of (scene, tMs).

import { next } from '../../scene/prng'
import { RING_RADIUS, SHIP } from '../../scene/layout'
import type { Scene } from '../../scene/events'
import { hsv, mapOf, px, rainbowRing, ring, wx, wy } from '../framebuffer'
import type { Framebuffer, Theme, ThemeTokens } from '../renderer'
import { entitiesPass } from './entities'

const STAR_COUNT = 140
const STAR_SPEED = 0.25 // depth units per second
const COPPER_TOP = 2

// Star positions are fixed by a seed; depth is derived from time, so no state is kept.
const stars = (() => {
  const out = new Float32Array(STAR_COUNT * 3)
  let s = 99
  for (let i = 0; i < STAR_COUNT * 3; i++) {
    const r = next(s)
    s = r.state
    out[i] = i % 3 === 2 ? r.value : (r.value - 0.5) * 2
  }
  return out
})()

export const starfieldPass = (fb: Framebuffer, _scene: Scene, tMs: number, _t: ThemeTokens): void => {
  const m = mapOf(fb)
  const cx = wx(m, SHIP.x)
  const cy = wy(m, SHIP.y)
  const sxk = fb.width * 0.3
  const syk = fb.height * 0.33
  const travel = (tMs / 1000) * STAR_SPEED
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = stars[i * 3]!
    const y = stars[i * 3 + 1]!
    let z = (stars[i * 3 + 2]! - travel) % 1
    if (z < 0) z += 1
    z = 0.02 + z * 0.98
    const b = (1 - z) * 255
    px(fb, cx + (x / z) * sxk, cy + (y / z) * syk, b, b, b)
  }
}

export const copperPass = (fb: Framebuffer, _scene: Scene, tMs: number, _t: ThemeTokens): void => {
  const t = tMs / 1000
  // Four pixel rows, starting under the header row so they show (the mockup's bars sat at 0-3).
  const end = Math.min(COPPER_TOP + 4, fb.height)
  for (let y = COPPER_TOP; y < end; y++) {
    const v = 0.5 + 0.3 * Math.sin(y + t * 3)
    for (let x = 0; x < fb.width; x++) {
      const h = (((y * 0.06 + t * 0.15 + Math.sin(x * 0.05 + t) * 0.05) % 1) + 1) % 1
      const c = hsv(h, 0.8, v)
      px(fb, x, y, c[0], c[1], c[2])
    }
  }
}

export const tripwirePass = (fb: Framebuffer, _scene: Scene, tMs: number, t: ThemeTokens): void => {
  const m = mapOf(fb)
  const cx = wx(m, SHIP.x)
  const cy = wy(m, SHIP.y)
  const r = RING_RADIUS * m.size
  if (t.ring === 'rainbow') rainbowRing(fb, cx, cy, r, (tMs / 1000) * 0.25)
  else ring(fb, cx, cy, r, t.ring)
}

export const cracktroTheme: Theme = {
  id: 'cracktro',
  tokens: {
    background: [0, 0, 0],
    ring: 'rainbow',
    ship: [200, 200, 255],
    pkgInbound: [170, 170, 190],
    pass: [90, 255, 140],
    hold: [255, 190, 40],
    refuse: [255, 60, 60],
    sentinel: [255, 255, 255],
    text: [220, 220, 255],
    textDim: [200, 180, 255],
    heading: [255, 220, 120],
    titleBg: [30, 0, 60],
  },
  terminalPasses: [starfieldPass, copperPass, tripwirePass, entitiesPass],
  footer: 'scrolltext',
  persistence: 0,
}
