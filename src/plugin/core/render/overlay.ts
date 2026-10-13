// Text overlay: header, banners, events log, fleet and totals, package labels, ticker and footer,
// laid out by viewport width. Verdicts always carry a glyph and a word (FR-024).

import { formatEstimate, totalTokens } from '../data/prices'
import type { AgentSprite, LogLine, PackageSprite, Scene } from '../scene/events'
import { AUTO_BG, TextLayer, packRgb } from './encoder'
import type { MapRect } from './framebuffer'
import type { Rgb, Theme, ThemeTokens, Viewport } from './renderer'

export type LayoutTier = 'wide' | 'medium' | 'narrow'

export type Layout = {
  tier: LayoutTier
  columns: number
  rows: number
  /** Side panels (wide only), as [startCol, endCol). */
  left?: readonly [number, number]
  right?: readonly [number, number]
  /** Map area in cells: columns [col0, col1), rows [row0, row1). */
  mapCells: { col0: number; col1: number; row0: number; row1: number }
  /** The square world inside the map area, in pixels (rows count twice). */
  map: MapRect
  tickerRow?: number
  footerRow?: number
}

export const WIDE_MIN = 100
export const MEDIUM_MIN = 60
export const PANEL_WIDTH = 24

export const computeLayout = (viewport: Viewport): Layout => {
  const { columns, rows } = viewport
  const tier: LayoutTier = columns >= WIDE_MIN ? 'wide' : columns >= MEDIUM_MIN ? 'medium' : 'narrow'
  const footerRow = tier === 'narrow' || rows < 4 ? undefined : rows - 1
  const tickerRow = tier === 'medium' && rows >= 6 ? rows - 2 : undefined
  const row0 = rows > 1 ? 1 : 0
  const row1 = tickerRow ?? footerRow ?? rows
  const left = tier === 'wide' ? ([0, PANEL_WIDTH] as const) : undefined
  const right = tier === 'wide' ? ([columns - PANEL_WIDTH, columns] as const) : undefined
  const col0 = left ? left[1] : 0
  const col1 = right ? right[0] : columns
  const w = col1 - col0
  const h = (row1 - row0) * 2
  const size = Math.max(1, Math.min(w, h))
  const map: MapRect = { x0: col0 + (w - size) / 2, y0: row0 * 2 + (h - size) / 2, size }
  const layout: Layout = { tier, columns, rows, mapCells: { col0, col1, row0, row1 }, map }
  if (left) layout.left = left
  if (right) layout.right = right
  if (tickerRow !== undefined) layout.tickerRow = tickerRow
  if (footerRow !== undefined) layout.footerRow = footerRow
  return layout
}

/** 999 → "999", 12_345 → "12.3k", 4_200_000 → "4.2M". */
export const formatTokens = (n: number): string => {
  if (n < 1000) return String(Math.max(0, Math.round(n)))
  if (n < 999_950) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export const AGENT_COLORS: readonly Rgb[] = [
  [80, 220, 255], [255, 90, 220], [255, 220, 90], [120, 255, 140], [255, 150, 80], [170, 140, 255],
]

const KNOWN_AGENTS: Record<string, number> = { Explore: 0, coder: 1, reviewer: 2, tester: 3 }

export const agentColor = (type: string): Rgb => {
  const known = KNOWN_AGENTS[type]
  if (known !== undefined) return AGENT_COLORS[known]!
  let h = 2166136261
  for (let i = 0; i < type.length; i++) h = Math.imul(h ^ type.charCodeAt(i), 16777619)
  return AGENT_COLORS[(h >>> 0) % AGENT_COLORS.length]!
}

/** The colour and glyph a package is drawn with in its current phase. */
export const packageLook = (p: PackageSprite, t: ThemeTokens): { color: Rgb; glyph: string; word: string } => {
  switch (p.phase) {
    case 'passing':
      return { color: t.pass, glyph: '✔', word: p.pinnedTo ? `pinned ${p.pinnedTo}` : p.tier && p.tier !== 'pass' ? p.tier : 'passed' }
    case 'bursting':
      return { color: t.refuse, glyph: '✖', word: 'refused' }
    case 'held':
      return { color: t.hold, glyph: '◆', word: 'held' }
    default:
      return { color: t.pkgInbound, glyph: '·', word: 'checking' }
  }
}

const toneColor = (tone: LogLine['tone'], t: ThemeTokens): Rgb => {
  switch (tone) {
    case 'pass':
      return t.pass
    case 'hold':
      return t.hold
    case 'refuse':
    case 'fault':
      return t.refuse
    case 'agent':
      return t.text
    default:
      return t.textDim
  }
}

const liveAgents = (scene: Scene): AgentSprite[] => Object.values(scene.agents).filter((a) => a.state !== 'gone')

const pad = (label: string, value: string, width: number): string =>
  label + ' '.repeat(Math.max(1, width - label.length - value.length)) + value

const FAULT_BG: Rgb = [150, 0, 0]
const FAULT_FG: Rgb = [255, 255, 255]
const LIVE_FG: Rgb = [255, 80, 80]

const SCROLLTEXT =
  '   *** OMNIS WATCHTOWER *** THE FLEET POLICES ITSELF ... TRIPWIRE ARMED ON NPM + PYPI ... GREETINGS TO EVERY AGENT THAT DIDN\'T INSTALL MALWARE TODAY ... FORTITUDE OMNIS GROUP 2026 ...   '
const STATUS_FOOTER = 'TRIPWIRE ARMED · npm · PyPI · tiered enforcement · ✔ pass ◆ hold ✖ refuse'

const hueRgb = (h: number): number => {
  const f = (n: number): number => {
    const k = (n + h * 6) % 6
    return (1 - Math.max(0, Math.min(k, 4 - k, 1))) * 255
  }
  return packRgb([f(5), f(3), f(1)])
}

const dimmed = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k]

/** Writes every text cell for this frame. Order matters: later writes win. */
export const drawOverlay = (text: TextLayer, scene: Scene, tMs: number, theme: Theme, layout: Layout): void => {
  const tk = theme.tokens
  const C = {
    text: packRgb(tk.text),
    dim: packRgb(tk.textDim),
    head: packRgb(tk.heading),
    titleBg: packRgb(tk.titleBg),
    pass: packRgb(tk.pass),
    hold: packRgb(tk.hold),
    refuse: packRgb(tk.refuse),
  }
  const { columns, rows } = layout
  const t = tMs / 1000

  drawLabels(text, scene, tk, layout)

  if (layout.left) drawEvents(text, scene, tk, layout.left, layout)
  if (layout.right) drawFleet(text, scene, tk, layout.right, layout)

  // Header.
  text.band(0, C.titleBg)
  let c = text.put(1, 0, 'OMNIS WATCHTOWER', C.head, C.titleBg)
  if (columns >= 40) text.put(c + 1, 0, '· mission control', C.dim, C.titleBg)
  const live = `${Math.floor(t * 2) % 2 ? '●' : '○'} ${scene.demo ? 'DEMO' : 'LIVE'}`
  if (columns >= 26) text.put(columns - live.length - 1, 0, live, packRgb(LIVE_FG), C.titleBg)

  // Banners sit under the header, over the map.
  let banner = 1
  if (scene.fault && rows > banner) {
    const bg = packRgb(FAULT_BG)
    text.band(banner, bg)
    text.put(1, banner, `⚠ WATCHTOWER FAULT · ${scene.fault.where}: ${scene.fault.message}`, packRgb(FAULT_FG), bg)
    banner++
  }
  if (scene.demo && rows > banner) {
    const bg = packRgb(dimmed(tk.hold, 0.35))
    const msg = 'DEMO — scripted replay'
    text.band(banner, bg)
    text.put(Math.max(0, Math.floor((columns - msg.length) / 2)), banner, msg, packRgb(tk.hold), bg)
  }

  if (layout.tickerRow !== undefined) drawTicker(text, scene, tk, layout.tickerRow, columns)

  if (layout.footerRow !== undefined) {
    const row = layout.footerRow
    if (theme.footer === 'scrolltext') {
      const black = packRgb([0, 0, 0])
      const off = Math.floor(t * 12) % SCROLLTEXT.length
      const str = (SCROLLTEXT + SCROLLTEXT + SCROLLTEXT).slice(off, off + columns)
      for (let i = 0; i < columns; i++) {
        const hue = (((i / 40 + t * 0.3) % 1) + 1) % 1
        text.put(i, row, str[i] ?? ' ', hueRgb(hue), black)
      }
    } else {
      const bg = packRgb(dimmed(tk.titleBg, 0.8))
      text.band(row, bg)
      text.put(1, row, STATUS_FOOTER, packRgb(dimmed(tk.text, 0.8)), bg)
    }
  }
}

const drawLabels = (text: TextLayer, scene: Scene, tk: ThemeTokens, layout: Layout): void => {
  const { map, mapCells } = layout
  for (const p of Object.values(scene.packages)) {
    if (p.phase === 'gone') continue
    const x = map.x0 + p.pos.x * map.size
    const y = map.y0 + p.pos.y * map.size
    const row = Math.round(y / 2)
    if (row < mapCells.row0 || row >= mapCells.row1) continue
    const look = packageLook(p, tk)
    const pending = p.phase === 'inbound' || p.phase === 'atRing'
    const short = pending ? p.ref.name : `${look.glyph} ${p.ref.name} ${look.word}`
    const reason = p.phase === 'bursting' && p.evidence[0] ? ` — ${p.evidence[0]}` : ''
    const fg = pending ? packRgb(tk.textDim) : packRgb(look.color)
    // Right of the sprite with the reason, then without it, then the short form on the left (a
    // long label on the left would run across the ship). The reason is also in the log/ticker.
    const right = Math.round(x) + 2
    const spots: [string, number][] = []
    if (reason) spots.push([short + reason, right])
    spots.push([short, right], [short, Math.round(x) - 1 - [...short].length])
    let placed = false
    for (const [label, col] of spots) {
      if (col >= mapCells.col0 && col + [...label].length <= mapCells.col1) {
        text.put(col, row, label, fg, AUTO_BG, mapCells.col0, mapCells.col1)
        placed = true
        break
      }
    }
    if (!placed) text.put(Math.max(mapCells.col0, Math.min(right, mapCells.col1 - [...short].length)), row, short, fg, AUTO_BG, mapCells.col0, mapCells.col1)
  }
}

const drawEvents = (text: TextLayer, scene: Scene, tk: ThemeTokens, span: readonly [number, number], layout: Layout): void => {
  const [c0, c1] = span
  const width = c1 - c0 - 2
  const top = 3
  const bottom = (layout.footerRow ?? layout.rows) - 1
  text.put(c0 + 1, top, 'EVENTS', packRgb(tk.heading))
  let row = top + 2
  for (let i = scene.log.length - 1; i >= 0 && row <= bottom; i--, row++) {
    const l = scene.log[i]!
    text.put(c0 + 1, row, `${l.glyph} ${l.text}`.slice(0, width), packRgb(toneColor(l.tone, tk)), AUTO_BG, c0, c1)
  }
}

const drawFleet = (text: TextLayer, scene: Scene, tk: ThemeTokens, span: readonly [number, number], layout: Layout): void => {
  const [c0, c1] = span
  const col = c0 + 1
  const width = c1 - c0 - 2
  const last = (layout.footerRow ?? layout.rows) - 1
  const tx = packRgb(tk.text)
  const totals = scene.totals
  const block: [string, string, number][] = [
    ['INTERCEPTS', String(totals.intercepts), tx],
    ['✔ PASSED', String(totals.passed), packRgb(tk.pass)],
    ['◆ HELD', String(totals.held), packRgb(tk.hold)],
    ['✖ REFUSED', String(totals.refused), packRgb(tk.refuse)],
    ['UNVERIFIED', String(totals.unverified), tx],
    ['UNCHECKED', String(totals.unchecked), tx],
    ['OVERRIDDEN', String(totals.overridden), tx],
  ]
  const spend: [string, number][] = [[pad('TOKENS', formatTokens(totalTokens(scene.tokens)), width), tx]]
  if (scene.estCostUsd > 0) spend.push([formatEstimate(scene.estCostUsd), tx])
  if (scene.unpricedTokens > 0) spend.push([`excl. ${formatTokens(scene.unpricedTokens)} unpriced`, packRgb(tk.textDim)])

  // Bottom-up: spend, totals, then the fleet list takes whatever rows remain above.
  const totalsRows = block.length + 1 + spend.length
  const totalsTop = Math.max(5, last - totalsRows + 1)
  let row = totalsTop
  for (const [label, value, fg] of block) text.put(col, row++, pad(label, value, width), fg, AUTO_BG, c0, c1)
  row++
  for (const [line, fg] of spend) text.put(col, row++, line.slice(0, width), fg, AUTO_BG, c0, c1)

  text.put(col, 3, 'FLEET', packRgb(tk.heading))
  const agents = liveAgents(scene)
  const room = totalsTop - 1 - 5
  if (agents.length === 0 && room > 0) text.put(col, 5, 'no helper agents', packRgb(tk.textDim))
  for (let i = 0; i < agents.length && i < room; i++) {
    const a = agents[i]!
    const shown = i === room - 1 && agents.length > room ? `+${agents.length - i} more` : null
    const line = shown ?? pad(`▲ ${a.type}`.slice(0, width - 7), formatTokens(totalTokens(a.tokens)), width)
    text.put(col, 5 + i, line, packRgb(shown ? tk.textDim : agentColor(a.type)), AUTO_BG, c0, c1)
  }
}

const drawTicker = (text: TextLayer, scene: Scene, tk: ThemeTokens, row: number, columns: number): void => {
  const bg = packRgb(dimmed(tk.titleBg, 0.6))
  text.band(row, bg)
  const t = scene.totals
  const counts = `✔ ${t.passed} passed  ◆ ${t.held} held  ✖ ${t.refused} refused`
  const countsCol = Math.max(1, columns - counts.length - 1)
  const latest = scene.log[scene.log.length - 1]
  if (latest) text.put(1, row, `${latest.glyph} ${latest.text}`, packRgb(toneColor(latest.tone, tk)), bg, 0, countsCol - 2)
  else text.put(1, row, 'watching…', packRgb(tk.textDim), bg, 0, countsCol - 2)
  let c = countsCol
  c = text.put(c, row, `✔ ${t.passed} passed`, packRgb(tk.pass), bg)
  c = text.put(c + 2, row, `◆ ${t.held} held`, packRgb(tk.hold), bg)
  text.put(c + 2, row, `✖ ${t.refused} refused`, packRgb(tk.refuse), bg)
}
