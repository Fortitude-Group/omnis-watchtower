// The one session.start hook (the engine allows a single unmatched registration per event):
// registers the /watchtower command and the hidden Sentinel agent type.
import type { On } from 'claude-code'

import { SENTINEL_SYSTEM_PROMPT } from '../core/sentinel/prompt'
import type { Ctx } from './context'
import { PANE_ID } from './pane'
import { SENTINEL_NAME } from './sentinel'

export const install = (on: On, ctx: Ctx): void => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'watchtower', description: 'Omnis Watchtower: mission control and supply-chain tripwire' })
    // Registering an agent rejects until the session binds, which it has once next(e) returns
    await $.agent.register({
      name: SENTINEL_NAME,
      description: 'Omnis Watchtower supply-chain investigator. Dispatched only by Watchtower.',
      prompt: SENTINEL_SYSTEM_PROMPT,
      tools: ['WebFetch'],
      model: ctx.options.sentinelModel,
      omitClaudeMd: true,
    })
    // Unasked, the engine places a pane only from 144 columns, which is exactly our floor. A pane it
    // would leave waiting is closed, so it never pops up later when the terminal widens.
    if (ctx.options.autoOpen && e.isInteractive && e.surface === 'terminal') {
      const opened = await $.ui.open({ id: PANE_ID, title: 'Omnis Watchtower', closeOnEscape: true })
      if (!opened.isPlaced) await $.ui.close({ id: PANE_ID })
    }
    return started
  })
}
