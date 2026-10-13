// /watchtower legend (T064): what every figure on screen is, why it matters, what to do about it,
// and what each count leaves out (Principle XII, FR-023). Pure handler.
import { legendText } from '../../core/text/legend'
import { addSubcommand } from './registry'

addSubcommand('legend', () => ({ text: `Omnis Watchtower legend\n\n${legendText()}` }))
