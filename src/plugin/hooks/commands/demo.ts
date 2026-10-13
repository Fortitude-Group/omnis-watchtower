// /watchtower demo (T067): a scripted replay in its own scene. No installs, no network, no Sentinel.
import { addSubcommand } from './registry'

addSubcommand('demo', () => ({
  text: 'Replaying the scripted slopsquatting attack, about 45 seconds. Nothing is installed and nothing goes over the network.',
  actions: [{ type: 'startDemo' }],
}))
