// Feeds a timed event script through reduce/step at a fixed frame step. Used by the demo pane,
// the determinism test and the renderer golden tests. Pure: no clock, the caller owns timing.

import { emptyScene, type Scene, type SceneEvent, type SceneEventInput } from './events'
import { reduce } from './reduce'
import { step } from './step'

export type ScriptEntry = { atMs: number; event: SceneEventInput }
export type Script = readonly ScriptEntry[]

export type ReplayState = { scene: Scene; cursor: number; frame: number }

export type ReplayOptions = {
  /** Extra time after the last event so units can finish flying home. Default 3000 ms. */
  tailMs?: number
  /** Marks the scene as a demo (scene.demo). Default true. */
  demo?: boolean
}

export const DEFAULT_TAIL_MS = 3000

export const stamp = (entry: ScriptEntry, seq: number): SceneEvent => ({ ...entry.event, at: entry.atMs, seq }) as SceneEvent

export const scriptDuration = (script: Script, tailMs = DEFAULT_TAIL_MS): number =>
  script.reduce((m, e) => Math.max(m, e.atMs), 0) + tailMs

export const startReplay = (seed: number, demo = true): ReplayState => ({
  scene: demo ? { ...emptyScene(seed), demo: true } : emptyScene(seed),
  cursor: 0,
  frame: 0,
})

/** Applies every event due by the current scene time, then steps one frame. Script must be sorted by atMs. */
export const advanceReplay = (state: ReplayState, script: Script, stepMs: number): ReplayState => {
  let scene = state.scene
  let cursor = state.cursor
  for (let entry = script[cursor]; entry && entry.atMs <= scene.t; entry = script[cursor]) {
    scene = reduce(scene, stamp(entry, cursor))
    cursor++
  }
  return { scene: step(scene, stepMs), cursor, frame: state.frame + 1 }
}

export const replayDone = (state: ReplayState, script: Script, tailMs = DEFAULT_TAIL_MS): boolean =>
  state.cursor >= script.length && state.scene.t >= scriptDuration(script, tailMs)

/** Runs the whole script, calling onFrame after each step; returns the final scene. */
export const replay = (
  script: Script,
  seed: number,
  stepMs: number,
  onFrame?: (scene: Scene, frame: number) => void,
  options: ReplayOptions = {},
): Scene => {
  if (!(stepMs > 0)) throw new Error('stepMs must be positive')
  const sorted = [...script].sort((a, b) => a.atMs - b.atMs)
  const tailMs = options.tailMs ?? DEFAULT_TAIL_MS
  let state = startReplay(seed, options.demo ?? true)
  while (!replayDone(state, sorted, tailMs)) {
    state = advanceReplay(state, sorted, stepMs)
    onFrame?.(state.scene, state.frame)
  }
  return state.scene
}
