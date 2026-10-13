// Float RGB pixel buffer (0..255 per channel) plus the drawing primitives every theme pass uses.
// Ported from the approved mockup: px blends towards a colour by alpha, rings and discs are built
// from px. Nothing here allocates per pixel.

import type { Framebuffer, Rgb } from './renderer'

/** Where the square world (0..1) sits inside the framebuffer, in pixels. */
export type MapRect = { x0: number; y0: number; size: number }

export class PixelBuffer implements Framebuffer {
  readonly width: number
  readonly height: number
  readonly data: Float32Array
  map: MapRect

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Float32Array(width * height * 3)
    const size = Math.min(width, height)
    this.map = { x0: (width - size) / 2, y0: (height - size) / 2, size }
  }
}

/** The map rectangle of a framebuffer; a foreign Framebuffer gets a centred square. */
export const mapOf = (fb: Framebuffer): MapRect => {
  if (fb instanceof PixelBuffer) return fb.map
  const size = Math.min(fb.width, fb.height)
  return { x0: (fb.width - size) / 2, y0: (fb.height - size) / 2, size }
}

export const wx = (m: MapRect, x: number): number => m.x0 + x * m.size
export const wy = (m: MapRect, y: number): number => m.y0 + y * m.size

export const fill = (fb: Framebuffer, c: Rgb): void => {
  const d = fb.data
  const r = c[0]
  const g = c[1]
  const b = c[2]
  for (let i = 0; i < d.length; i += 3) {
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
  }
}

/** Phosphor afterglow: every channel decays towards the floor colour by `keep` per frame. */
export const decay = (fb: Framebuffer, keep: number, floor: Rgb): void => {
  const d = fb.data
  const k = 1 - keep
  const r = floor[0] * k
  const g = floor[1] * k
  const b = floor[2] * k
  for (let i = 0; i < d.length; i += 3) {
    d[i] = d[i]! * keep + r
    d[i + 1] = d[i + 1]! * keep + g
    d[i + 2] = d[i + 2]! * keep + b
  }
}

export const px = (fb: Framebuffer, x: number, y: number, r: number, g: number, b: number, a = 1): void => {
  const ix = Math.round(x)
  const iy = Math.round(y)
  if (ix < 0 || iy < 0 || ix >= fb.width || iy >= fb.height) return
  const d = fb.data
  const i = (iy * fb.width + ix) * 3
  d[i] = d[i]! + (r - d[i]!) * a
  d[i + 1] = d[i + 1]! + (g - d[i + 1]!) * a
  d[i + 2] = d[i + 2]! + (b - d[i + 2]!) * a
}

export const dot = (fb: Framebuffer, x: number, y: number, c: Rgb, a = 1): void => px(fb, x, y, c[0], c[1], c[2], a)

export const line = (fb: Framebuffer, x0: number, y0: number, x1: number, y1: number, c: Rgb, a = 1): void => {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0 || 1
  for (let i = 0; i <= n; i++) {
    const t = i / n
    px(fb, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c[0], c[1], c[2], a)
  }
}

export const ring = (fb: Framebuffer, cx: number, cy: number, r: number, c: Rgb, a = 1): void => {
  const n = Math.ceil(2 * Math.PI * Math.max(r, 0.5) * 1.6)
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2
    px(fb, cx + Math.cos(th) * r, cy + Math.sin(th) * r, c[0], c[1], c[2], a)
  }
}

const scratch: [number, number, number] = [0, 0, 0]

/** Writes an HSV colour (h in 0..1) as 0..255 RGB into `out`. */
export const hsv = (h: number, s: number, v: number, out: [number, number, number] = scratch): [number, number, number] => {
  const f = (n: number): number => {
    const k = (n + h * 6) % 6
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255
  }
  out[0] = f(5)
  out[1] = f(3)
  out[2] = f(1)
  return out
}

/** A ring whose hue cycles around its circumference, offset by `hue0`. */
export const rainbowRing = (fb: Framebuffer, cx: number, cy: number, r: number, hue0: number, a = 1): void => {
  const n = Math.ceil(2 * Math.PI * Math.max(r, 0.5) * 1.6)
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2
    const c = hsv((((th / (Math.PI * 2) + hue0) % 1) + 1) % 1, 1, 1)
    px(fb, cx + Math.cos(th) * r, cy + Math.sin(th) * r, c[0], c[1], c[2], a)
  }
}

export const disc = (fb: Framebuffer, cx: number, cy: number, r: number, c: Rgb, a = 1): void => {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r + r * 0.8) px(fb, cx + x, cy + y, c[0], c[1], c[2], a)
    }
  }
}
