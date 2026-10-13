import type { Register } from 'claude-code'

import { install as installCommands } from './commands/index'
import { readOptions } from './context'
import { install as installFleet } from './fleet'
import { install as installGate } from './gate'
import { install as installPane } from './pane'
import { install as installSentinel } from './sentinel'
import { install as installStatus } from './status'

export const register: Register = (on, options) => {
  const ctx = { options: readOptions(options) }
  installGate(on, ctx)
  installSentinel(on, ctx)
  installFleet(on, ctx)
  installPane(on, ctx)
  installStatus(on, ctx)
  installCommands(on, ctx)
}
