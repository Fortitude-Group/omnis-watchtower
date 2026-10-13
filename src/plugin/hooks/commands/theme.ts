// /watchtower theme <radar|cracktro> (T064). The map keeps its state across a switch.
import type { WatchtowerTheme } from '../../types'
import { addSubcommand } from './registry'

const THEMES: readonly WatchtowerTheme[] = ['radar', 'cracktro']

const isTheme = (v: string): v is WatchtowerTheme => (THEMES as readonly string[]).includes(v)

addSubcommand('theme', (args, snap) => {
  const name = args[0]?.toLowerCase()
  if (!name) return { text: `The theme is ${snap.theme}. Switch with /watchtower theme <radar|cracktro>.` }
  if (args.length > 1 || !isTheme(name)) {
    return { text: `Unknown theme "${args.join(' ')}". Choose radar or cracktro: /watchtower theme <radar|cracktro>.` }
  }
  const text = name === snap.theme ? `The theme is already ${name}.` : `Theme switched to ${name}. Nothing on the map was lost.`
  return { text, actions: [{ type: 'setTheme', theme: name }] }
})
