// Browser preview of /watchtower demo, drawn by the plugin's real renderer. It replays DEMO_SCRIPT
// through TerminalRasterRenderer and paints each RasterFrame cell the way a truecolour terminal
// does (half-block pixels, glyph cells), so what you see is exactly what the pane draws.
//
// Build: node scripts/build-demo-preview.mjs, then open dist/demo-preview.html with
//   ?theme=radar|cracktro      which look
//   &loop=0                    stop after one replay
//   &record=1                  render the replay offline and download it as demo-<theme>.gif
//   &save=1                    with record: PUT the GIF to /save/demo-<theme>.gif instead
// @ts-expect-error gifenc ships no types
import { GIFEncoder, applyPalette, quantize } from 'gifenc'

import { DEMO_SCRIPT, DEMO_SEED } from '../../src/plugin/core/data/demo-script'
import { THEMES, TerminalRasterRenderer } from '../../src/plugin/core/render/terminal-raster'
import { advanceReplay, replayDone, startReplay } from '../../src/plugin/core/scene/replay'

const params = new URLSearchParams(location.search)
const recording = params.get('record') === '1'
const COLUMNS = 120
const ROWS = 36
const CELL_W = recording ? 7 : 9
const CELL_H = recording ? 14 : 18
const STEP_MS = 33
const GIF_FRAME_MS = 100 // 10 fps keeps the file small while motion still reads

const themeId = params.get('theme') === 'cracktro' ? 'cracktro' : 'radar'
const canvas = document.getElementById('term') as HTMLCanvasElement
canvas.width = COLUMNS * CELL_W
canvas.height = ROWS * CELL_H
const ctx = canvas.getContext('2d', { willReadFrequently: recording })!
ctx.font = `${CELL_H - 3}px Consolas, "Cascadia Mono", Menlo, monospace`
ctx.textBaseline = 'middle'

const renderer = new TerminalRasterRenderer()
renderer.mount({ columns: COLUMNS, rows: ROWS }, THEMES[themeId])

const DEFAULT_FG = 0xd0d0d0
const DEFAULT_BG = 0x000000
const css = (c: number, fallback: number) => {
  const v = c & 0x01000000 ? fallback : c & 0xffffff
  return `#${v.toString(16).padStart(6, '0')}`
}

const paint = (cells: string) => {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const words = new Uint32Array(bytes.buffer)
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLUMNS; c++) {
      const i = (r * COLUMNS + c) * 3
      const cp = words[i]!, fg = words[i + 1]!, bg = words[i + 2]!
      const x = c * CELL_W, y = r * CELL_H
      if (cp === 0x2580) {
        // upper half block: foreground is the top pixel, background the bottom one
        ctx.fillStyle = css(fg, DEFAULT_FG); ctx.fillRect(x, y, CELL_W, CELL_H / 2)
        ctx.fillStyle = css(bg, DEFAULT_BG); ctx.fillRect(x, y + CELL_H / 2, CELL_W, CELL_H / 2)
      } else {
        ctx.fillStyle = css(bg, DEFAULT_BG); ctx.fillRect(x, y, CELL_W, CELL_H)
        if (cp !== 0x20) { ctx.fillStyle = css(fg, DEFAULT_FG); ctx.fillText(String.fromCodePoint(cp), x, y + CELL_H / 2 + 1) }
      }
    }
  }
}

const status = (text: string) => { document.title = text; (window as unknown as { demoStatus: string }).demoStatus = text }

// Offline: step the replay at the pane's own 33 ms, keep every third frame, encode, download
const record = async () => {
  const gif = GIFEncoder()
  let state = startReplay(DEMO_SEED)
  let anim = 0
  let sinceFrame = GIF_FRAME_MS
  let frames = 0
  while (!replayDone(state, DEMO_SCRIPT)) {
    state = advanceReplay(state, DEMO_SCRIPT, STEP_MS)
    anim += STEP_MS
    const f = renderer.frame(state.scene, anim)
    sinceFrame += STEP_MS
    if (sinceFrame < GIF_FRAME_MS) continue
    sinceFrame = 0
    paint(f.cells)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const palette = quantize(data, 128)
    gif.writeFrame(applyPalette(data, palette), canvas.width, canvas.height, { palette, delay: GIF_FRAME_MS })
    if (++frames % 20 === 0) { status(`encoding frame ${frames}`); await new Promise(r => setTimeout(r, 0)) }
  }
  gif.finish()
  const blob = new Blob([gif.bytes()], { type: 'image/gif' })
  if (params.get('save') === '1') {
    // Served by a local helper that writes PUT /save/demo-<theme>.gif into docs/assets
    const r = await fetch(`/save/demo-${themeId}.gif`, { method: 'PUT', body: blob })
    status(`${r.ok ? 'saved' : 'save failed'}: ${frames} frames, ${Math.round(blob.size / 1024)} KB`)
    return
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `demo-${themeId}.gif`
  a.click()
  status(`done: ${frames} frames, ${Math.round(blob.size / 1024)} KB`)
}

const play = () => {
  let state = startReplay(DEMO_SEED)
  let anim = 0
  const tick = () => {
    state = advanceReplay(state, DEMO_SCRIPT, STEP_MS)
    anim += STEP_MS
    paint(renderer.frame(state.scene, anim).cells)
    if (replayDone(state, DEMO_SCRIPT)) {
      if (params.get('loop') === '0') { status('done'); return }
      state = startReplay(DEMO_SEED)
      renderer.reset()
    }
    setTimeout(tick, STEP_MS)
  }
  tick()
}

if (recording) void record()
else play()
