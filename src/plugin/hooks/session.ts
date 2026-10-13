// The one session.start hook (the engine allows a single unmatched registration per event):
// registers the /watchtower command and the hidden Sentinel agent type.
import type { On } from 'claude-code'

import { SENTINEL_SYSTEM_PROMPT } from '../core/sentinel/prompt'
import type { Ctx } from './context'
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
    return started
  })
}
