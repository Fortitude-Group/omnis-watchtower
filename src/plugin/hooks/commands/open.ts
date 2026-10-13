// /watchtower (T064): opens mission control, or closes it if it's already showing.
// /watchtower close closes it outright. Both matter where the terminal keeps the mouse (the main
// screen, tmux, some attach views): the pane's close mark is then plain text, and these and Esc
// are the only ways to close it.
import { addSubcommand } from './registry'

const HOW_TO_CLOSE = 'Press Esc at an empty prompt, or run /watchtower again, to close it.'

addSubcommand('', (_args, snap) =>
  snap.paneShown
    ? { text: 'Closed Omnis Watchtower mission control.', actions: [{ type: 'closePane' }] }
    : { text: `Omnis Watchtower mission control is open. ${HOW_TO_CLOSE} /watchtower legend explains what you see.`, actions: [{ type: 'openPane' }] },
)

addSubcommand('close', () => ({ text: 'Closed Omnis Watchtower mission control.', actions: [{ type: 'closePane' }] }))
