import type { Register } from 'claude-code'

import { install as installCommands } from './commands/index'
import { readOptions } from './context'
import { install as installFleet } from './fleet'
import { install as installGate } from './gate'
import { install as installPane } from './pane'
import { install as installPress } from './press'
import { install as installSentinel } from './sentinel'
import { install as installSession } from './session'
import { install as installStatus } from './status'

export const register: Register = (on, options) => {
  const ctx = { options: readOptions(options) }
  installSession(on, ctx)
  // Registrations nest in order, first outermost: the Sentinel wraps the gate so it can spawn
  // investigations for whatever the gate just queued
  installSentinel(on, ctx)
  installGate(on, ctx)
  installFleet(on, ctx)
  installPane(on, ctx)
  installStatus(on, ctx)
  installCommands(on, ctx)
  installPress(on, ctx)
}
