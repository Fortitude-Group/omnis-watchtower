// /watchtower (T064): bare command opens or focuses mission control.
import { addSubcommand } from './registry'

addSubcommand('', () => ({
  text: 'Omnis Watchtower mission control is open. /watchtower legend explains what you see.',
  actions: [{ type: 'openPane' }],
}))
