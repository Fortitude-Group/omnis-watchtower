// World geometry and motion tuning for the scene. Coordinates are normalised and SQUARE: (0,0) is
// top-left, (1,1) bottom-right, one unit is the same length on both axes. A terminal cell is about
// twice as tall as it is wide, so the pane is wider than tall in pixels; renderers fit this square
// world into their viewport and correct the aspect themselves. Nothing here knows about pixels.
// Distances can exceed the unit square (packages enter from beyond it); renderers clip.

import type { Vec } from './events'

export const SHIP: Vec = { x: 0.5, y: 0.5 }
/** Inside this distance a returning unit or passing package has docked with the ship. */
export const SHIP_RADIUS = 0.03
export const RING_RADIUS = 0.36
/** Packages stop just outside the ring while they wait, burst or are held. */
export const RING_STOP = RING_RADIUS + 0.025
/** Packages appear this far from the ship and fly inwards. */
export const ENTRY_DISTANCE = 0.62

export const LAUNCH_RADIUS = 0.02
export const ORBIT_MIN = 0.13
export const ORBIT_MAX = 0.25
/** Angular speed in rad/s before the radius damping below; direction is random. */
export const ORBIT_SPEED_MIN = 0.6
export const ORBIT_SPEED_MAX = 1.1
/** Agents ease towards their orbit (or the ship) at this rate per second. */
export const ORBIT_EASE = 1.6
/** A launching agent counts as working once it is within this fraction of its orbit radius. */
export const WORKING_AT = 0.9

/** World units per second. */
export const INBOUND_SPEED = 0.15
export const PASS_SPEED = 0.23
/** Sentinel eases towards its target at this rate per second; ARRIVE is the docking distance. */
export const SENTINEL_EASE = 3
export const ARRIVE = 0.02
/** Period of one expanding scan ring, for renderers. */
export const SCAN_RING_MS = 800

export const BURST_MS = 1400
export const BURST_EFFECT_MS = 1000
export const PASS_FLASH_MS = 500
export const GLINT_MS = 600
/** Period of the amber pulse on a held package, for renderers. */
export const HOLD_PULSE_MS = 785

export const TRAIL_LENGTH = 16
export const MAX_AGENTS = 24
export const MAX_PACKAGES = 48
export const MAX_SENTINELS = 16
export const MAX_EFFECTS = 64

export const polar = (angle: number, distance: number): Vec => ({
  x: SHIP.x + Math.cos(angle) * distance,
  y: SHIP.y + Math.sin(angle) * distance,
})

export const distance = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y)
