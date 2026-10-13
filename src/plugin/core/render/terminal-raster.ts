// The v1 terminal renderer: Scene → framebuffer (theme passes) → text overlay → Raster cells.
//
// Determinism: frame(scene, tMs) is a pure function of (scene, tMs, theme, viewport) and, for a
// theme with persistence > 0 (radar), of the frames this renderer drew before it. That afterglow
// is the only state. mount, resize, setTheme and reset() clear it, so a fresh or reset renderer fed
// the same sequence of frames produces the same output. Goldens always start from a new renderer.

import type { Scene } from '../scene/events'
import { CellEncoder, TextLayer } from './encoder'
import { PixelBuffer, decay, fill } from './framebuffer'
import { computeLayout, drawOverlay, type Layout } from './overlay'
import type { RasterFrame, Renderer, Theme, Viewport } from './renderer'
import { cracktroTheme } from './themes/cracktro'
import { radarTheme } from './themes/radar'

export const MAX_COLUMNS = 512
export const MAX_ROWS = 256

export const THEMES: Readonly<Record<Theme['id'], Theme>> = { radar: radarTheme, cracktro: cracktroTheme }

const clampViewport = (v: Viewport): Viewport => ({
  columns: Math.max(1, Math.min(MAX_COLUMNS, Math.floor(v.columns) || 1)),
  rows: Math.max(1, Math.min(MAX_ROWS, Math.floor(v.rows) || 1)),
})

type Surfaces = { viewport: Viewport; layout: Layout; fb: PixelBuffer; text: TextLayer; encoder: CellEncoder }

export class TerminalRasterRenderer implements Renderer<RasterFrame> {
  readonly surface = 'terminal' as const
  private theme: Theme = radarTheme
  private s: Surfaces | null = null

  mount(viewport: Viewport, theme: Theme): void {
    this.theme = theme
    this.resize(viewport)
  }

  resize(viewport: Viewport): void {
    const v = clampViewport(viewport)
    if (this.s && this.s.viewport.columns === v.columns && this.s.viewport.rows === v.rows) {
      this.reset()
      return
    }
    const layout = computeLayout(v)
    const fb = new PixelBuffer(v.columns, v.rows * 2)
    fb.map = layout.map
    this.s = { viewport: v, layout, fb, text: new TextLayer(v.columns, v.rows), encoder: new CellEncoder(v.columns, v.rows) }
    this.reset()
  }

  setTheme(theme: Theme): void {
    this.theme = theme
    this.reset()
  }

  /** Drops the afterglow so the next frame starts from the theme background. */
  reset(): void {
    if (this.s) fill(this.s.fb, this.theme.tokens.background)
  }

  get viewport(): Viewport | undefined {
    return this.s?.viewport
  }

  get layout(): Layout | undefined {
    return this.s?.layout
  }

  frame(scene: Scene, tMs: number): RasterFrame {
    const s = this.s
    if (!s) throw new Error('TerminalRasterRenderer.frame called before mount')
    const theme = this.theme
    if (theme.persistence > 0) decay(s.fb, theme.persistence, theme.tokens.background)
    else fill(s.fb, theme.tokens.background)
    for (const pass of theme.terminalPasses) pass(s.fb, scene, tMs, theme.tokens)
    s.text.clear()
    drawOverlay(s.text, scene, tMs, theme, s.layout)
    return { columns: s.viewport.columns, rows: s.viewport.rows, cells: s.encoder.encode(s.fb, s.text) }
  }
}
