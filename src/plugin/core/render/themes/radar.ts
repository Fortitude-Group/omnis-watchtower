// Phosphor radar (default theme): green CRT afterglow, range rings, crosshair, rotating sweep.
// The afterglow is the renderer's persistence (0.86) decaying towards `background`, so the sweep
// leaves a fading wake.

import { RING_RADIUS, SHIP } from '../../scene/layout'
import type { Scene } from '../../scene/events'
import { line, mapOf, ring, wx, wy } from '../framebuffer'
import type { Framebuffer, Rgb, Theme, ThemeTokens } from '../renderer'
import { entitiesPass } from './entities'

export const SWEEP_RAD_PER_S = 1.6

const RANGE: Rgb = [0, 90, 40]
const CROSS: Rgb = [0, 70, 30]
const SWEEP: Rgb = [150, 255, 170]

export const radarPass = (fb: Framebuffer, _scene: Scene, tMs: number, t: ThemeTokens): void => {
  const m = mapOf(fb)
  const cx = wx(m, SHIP.x)
  const cy = wy(m, SHIP.y)
  const r = RING_RADIUS * m.size
  ring(fb, cx, cy, r * 0.36, RANGE, 0.5)
  ring(fb, cx, cy, r * 0.68, RANGE, 0.5)
  ring(fb, cx, cy, r, t.ring === 'rainbow' ? SWEEP : t.ring, 0.9)
  line(fb, cx - r, cy, cx + r, cy, CROSS, 0.4)
  line(fb, cx, cy - r, cx, cy + r, CROSS, 0.4)
  const a = (tMs / 1000) * SWEEP_RAD_PER_S
  line(fb, cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, SWEEP, 1)
}

export const radarTheme: Theme = {
  id: 'radar',
  tokens: {
    background: [0, 14, 6],
    ring: [60, 255, 120],
    ship: [150, 255, 170],
    pkgInbound: [90, 200, 120],
    pass: [90, 255, 140],
    hold: [255, 190, 40],
    refuse: [255, 60, 60],
    sentinel: [255, 255, 255],
    text: [110, 230, 140],
    textDim: [60, 160, 90],
    heading: [150, 255, 170],
    titleBg: [0, 25, 10],
  },
  terminalPasses: [radarPass, entitiesPass],
  footer: 'status',
  persistence: 0.86,
}
