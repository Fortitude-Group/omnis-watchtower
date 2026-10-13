// The mission-control pane (T062): one Raster, repainted by blit on an adaptive clock.
//
// The authoritative data is the `events` state atom. The Scene, the demo replay and the renderer
// are a module-level cache, rebuilt from events after a hot reload. The render hook reads only the
// theme, so new events never redraw the tree: the tick folds them in and blits.
import { read, update, atom } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import { DEMO_SCRIPT, DEMO_SEED } from '../core/data/demo-script'
import { MAX_COLUMNS, MAX_ROWS, THEMES, TerminalRasterRenderer } from '../core/render/terminal-raster'
import { emptyScene, type Scene } from '../core/scene/events'
import { reduce } from '../core/scene/reduce'
import { advanceReplay, replayDone, startReplay, type ReplayState } from '../core/scene/replay'
import { step } from '../core/scene/step'
import type { Override, SceneEvent, WatchtowerTheme } from '../types'
import { CONFIRM_PREFIX, DISMISS_PREFIX, confirmLabel } from './commands/overrides'
import type { Ctx, Options } from './context'

const events = atom({ plugin: 'omnis-watchtower', key: 'events' } as const, [] as SceneEvent[])
const demo = atom({ plugin: 'omnis-watchtower', key: 'demo' } as const, false)
// Overrides an agent or a relayed command asked for, waiting on the person's press (hooks/press.ts)
const pendingOverrides = atom({ plugin: 'omnis-watchtower', key: 'pendingOverrides' } as const, {} as Record<string, Override>)
// A plain reference, so an unset theme reads undefined and falls back to the stored or configured one
const themeRef = { plugin: 'omnis-watchtower', key: 'theme' } as const

export const PANE_ID = 'watchtower'
export const RASTER_KEY = 'map'
export const ACTIVE_MS = 33
export const IDLE_MS = 250
export const PROBE_MS = 1000
export const THEME_STORE_KEY = 'wt:theme'
export const DESKTOP_FALLBACK = 'Mission control needs a terminal for now'

const LIVE_SEED = 0x5eed
// More new events than this at once (a reopen, a reload) are settled rather than animated
const CATCH_UP = 20

type Engine = Pick<EngineInterface, 'clock' | 'ui' | 'state' | 'store'>

const SCRIPT = [...DEMO_SCRIPT].sort((a, b) => a.atMs - b.atMs)
const renderer = new TerminalRasterRenderer()

let options: Options | undefined
let live: { scene: Scene; lastSeq: number } | undefined
let replay: ReplayState | undefined
let size: { columns: number; rows: number } | undefined
let shownTheme: WatchtowerTheme | undefined
let fallbackTheme: WatchtowerTheme = 'radar'
let loop: { timer: Timer; ms: number } | undefined
let busy = false
let hidden = false
let sinceProbe = 0
let animMs = 0

// hooks/press.ts answers these presses in the ui.press chain, before a Button's own onPress
const noop = (): void => {}


const isTheme = (v: unknown): v is WatchtowerTheme => v === 'radar' || v === 'cracktro'

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(n) || lo))

/** Rows the body shows: the pane's own window, else a share of the terminal. */
export const paneRows = (bodyRows: number | undefined, viewportRows: number | undefined, placement: 'dock' | 'inline'): number => {
  if (bodyRows && bodyRows > 0) return clamp(bodyRows, 1, MAX_ROWS)
  const total = viewportRows ?? 24
  return clamp(placement === 'dock' ? total - 3 : total * 0.45, 8, MAX_ROWS)
}

export const isMoving = (s: Scene): boolean =>
  s.effects.length > 0 || Object.keys(s.agents).length > 0 || Object.keys(s.packages).length > 0 || Object.keys(s.sentinels).length > 0

/** Folds every event newer than the cache into the live scene; rebuilds when the log restarted. */
const syncLive = (list: readonly SceneEvent[]): Scene => {
  const lastSeq = list.at(-1)?.seq ?? 0
  let cache = live && lastSeq >= live.lastSeq ? live : { scene: emptyScene(LIVE_SEED), lastSeq: 0 }
  const fresh = list.filter(e => e.seq > cache.lastSeq)
  let scene = cache.scene
  for (const e of fresh) scene = reduce(scene, e)
  if (fresh.length > CATCH_UP) for (let i = 0; i < 40; i++) scene = step(scene, IDLE_MS)
  cache = { scene, lastSeq: Math.max(lastSeq, cache.lastSeq) }
  live = cache
  return scene
}

const shown = (): Scene => replay?.scene ?? live?.scene ?? emptyScene(LIVE_SEED)

const applyTheme = (id: WatchtowerTheme): void => {
  if (shownTheme === id) return
  renderer.setTheme(THEMES[id])
  shownTheme = id
}

const stop = (): void => {
  loop?.timer.cancel()
  loop = undefined
}

function schedule($: Engine, ms: number): void {
  if (loop?.ms === ms) return
  loop?.timer.cancel()
  loop = { ms, timer: $.clock.every(ms, () => void tick($)) }
}

async function tick($: Engine): Promise<void> {
  if (busy || !size || !loop) return
  busy = true
  try {
    const ms = loop.ms
    sinceProbe += ms
    if (sinceProbe >= PROBE_MS) {
      sinceProbe = 0
      // Not listed (a test's mount, or a pane we did not open) means mounted and shown
      const pane = (await $.ui.panes().catch(() => [])).find(p => p.id === PANE_ID)
      hidden = pane !== undefined && (!pane.isShown || !pane.isPlaced)
    }
    if (hidden) {
      schedule($, PROBE_MS)
      return
    }

    const [list, themeNow, demoOn] = await Promise.all([read($, events), $.state.get(themeRef), read($, demo)])
    let scene = step(syncLive(list), ms)
    live = { scene, lastSeq: live?.lastSeq ?? 0 }
    if (demoOn) {
      replay = advanceReplay(replay ?? startReplay(DEMO_SEED), SCRIPT, ms)
      scene = replay.scene
      if (replayDone(replay, SCRIPT)) {
        replay = undefined
        await update($, demo, () => false)
      }
    } else {
      replay = undefined
    }

    applyTheme(isTheme(themeNow.value) ? themeNow.value : fallbackTheme)
    animMs += ms
    const f = renderer.frame(scene, animMs)
    const r = await $.ui.blit({ requestId: PANE_ID, key: RASTER_KEY, cells: f.cells, columns: f.columns, rows: f.rows })
    if (r.deny) {
      // Not mounted any more (closed, hidden by the surface, resized): the next render restarts us
      stop()
      return
    }
    schedule($, options?.reducedMotion || !isMoving(scene) ? IDLE_MS : ACTIVE_MS)
  } catch (err) {
    stop()
    $.ui.log(`watchtower pane: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  } finally {
    busy = false
  }
}

export const install = (on: On, ctx: Ctx): void => {
  options = ctx.options
  fallbackTheme = ctx.options.theme

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    // Read while drawing, so a new request redraws the pane with its buttons
    const pending = Object.values(await read($, pendingOverrides))
    if (e.surface !== 'terminal') {
      const { Box, Text, Button } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text>{DESKTOP_FALLBACK}</Text>
          {pending.map(o => (
            <Box flexDirection="row" gap={1}>
              <Text>Agent request:</Text>
              <Button key={CONFIRM_PREFIX + o.key} label={confirmLabel(o)} onPress={noop} />
              <Button key={DISMISS_PREFIX + o.key} label="Dismiss" onPress={noop} />
            </Box>
          ))}
        </Box>
      )
    }
    const { Box, Text, Button, Raster } = $.ui.resolve(e)

    const stored = await $.store.get(THEME_STORE_KEY)
    if (isTheme(stored)) fallbackTheme = stored
    const themeNow = (await $.state.get(themeRef)).value
    const id = isTheme(themeNow) ? themeNow : fallbackTheme

    const columns = clamp(e.props.bodyColumns, 1, MAX_COLUMNS)
    const rows = Math.max(8, paneRows(e.props.scroll?.bodyRows, e.viewport?.rows, e.props.placement) - pending.length)
    const v = renderer.viewport
    if (!v) renderer.mount({ columns, rows }, THEMES[id])
    else if (v.columns !== columns || v.rows !== rows) renderer.resize({ columns, rows })
    applyTheme(id)

    const f = renderer.frame(shown(), animMs)
    size = { columns: f.columns, rows: f.rows }
    hidden = false
    sinceProbe = 0
    // A new drawing may come with a new `$`: restart the clock on it
    stop()
    schedule($, ACTIVE_MS)
    const map = <Raster key={RASTER_KEY} columns={f.columns} rows={f.rows} cells={f.cells} />
    if (pending.length === 0) return map
    return (
      <Box flexDirection="column">
        {pending.map(o => (
          <Box flexDirection="row" gap={1}>
            <Text>Agent request:</Text>
            <Button key={CONFIRM_PREFIX + o.key} label={confirmLabel(o)} onPress={noop} />
            <Button key={DISMISS_PREFIX + o.key} label="Dismiss" onPress={noop} />
          </Box>
        ))}
        {map}
      </Box>
    )
  })

  on('ui.close', { id: PANE_ID }, (_$, e, next) => {
    stop()
    return next(e)
  })
}
