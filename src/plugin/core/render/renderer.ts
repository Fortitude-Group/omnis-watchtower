// The renderer extension contract (contracts/renderer.md). A desktop renderer implements Renderer
// against the same Scene and Theme tokens; nothing in scene, tripwire, adapters or hooks changes.

import type { Scene } from '../scene/events'

export type Viewport = { columns: number; rows: number }

export type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

export interface Renderer<Out> {
  readonly surface: Surface
  mount(viewport: Viewport, theme: Theme): void
  resize(viewport: Viewport): void
  setTheme(theme: Theme): void
  /** Pure with respect to (scene, tMs, theme, viewport): same inputs, same output. */
  frame(scene: Scene, tMs: number): Out
}

/** Exactly what the terminal's Raster element takes. */
export type RasterFrame = { columns: number; rows: number; cells: string }

export type Rgb = readonly [number, number, number]

export type ThemeTokens = {
  background: Rgb
  ring: Rgb | 'rainbow'
  ship: Rgb
  pkgInbound: Rgb
  pass: Rgb
  hold: Rgb
  refuse: Rgb
  sentinel: Rgb
  text: Rgb
  textDim: Rgb
  heading: Rgb
  titleBg: Rgb
}

/** Float RGB pixel buffer the terminal passes draw into; implemented in framebuffer.ts. */
export interface Framebuffer {
  readonly width: number
  readonly height: number
  readonly data: Float32Array
}

export type FramebufferPass = (fb: Framebuffer, scene: Scene, tMs: number, tokens: ThemeTokens) => void

export type Theme = {
  id: 'radar' | 'cracktro'
  tokens: ThemeTokens
  /** Terminal passes run in order into the framebuffer. A desktop theme supplies its own passes. */
  terminalPasses: FramebufferPass[]
  footer: 'status' | 'scrolltext'
  /** 0 clears each frame; 0.86 gives the radar's phosphor afterglow. */
  persistence: number
}
