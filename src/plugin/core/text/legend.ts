// Every figure Watchtower puts on screen, with what it is, why it matters and what to do about it
// (constitution Principle XII, FR-023). Counts that leave things out say what they leave out.
// `/watchtower legend` prints legendText(); a focused figure shows legendLine(id).

import { PRICES, PRICES_AS_OF } from '../data/prices'

export type FigureId =
  | 'intercepts'
  | 'passed'
  | 'held'
  | 'refused'
  | 'unverified'
  | 'unchecked'
  | 'overridden'
  | 'tokens'
  | 'estCost'

export type LegendEntry = {
  id: FigureId
  /** The label as it appears on screen. */
  label: string
  what: string
  why: string
  whatFollows: string
  /** Present for every count that leaves something out. */
  excludes?: string
}

const pricedModels = Object.keys(PRICES).join(', ')

export const LEGEND: readonly LegendEntry[] = [
  {
    id: 'intercepts',
    label: 'INTERCEPTS',
    what: 'Packages the tripwire caught in an install or run command this session, one per package per command.',
    why: 'It shows how much installing your agents are doing, so a sudden burst stands out.',
    whatFollows: 'Nothing, on its own. Read the passed, held and refused counts to see how each was decided.',
    excludes:
      'Only npm and PyPI commands that agents ran through the Bash tool. Installs you type in your own terminal, other ecosystems (cargo, gem, go and so on) and the demo replay are not counted.',
  },
  {
    id: 'passed',
    label: '✔ PASSED',
    what: 'Packages allowed to install because nothing in the public data looked dangerous, or because a Sentinel cleared them.',
    why: 'This is normal work going through untouched.',
    whatFollows: 'Nothing to do.',
    excludes:
      'It includes packages that resolve to a private registry or match your allowlist. Those are passed without being scored against public data. A held package the Sentinel later cleared is counted here as well as under Held.',
  },
  {
    id: 'held',
    label: '◆ HELD',
    what: 'Packages that looked suspicious but not clearly dangerous, so a read-only Sentinel agent was sent to investigate them.',
    why: 'An agent may be about to install something new, unpopular or with install scripts.',
    whatFollows:
      'Wait for the verdict; the agent retries and the verdict is applied. If it times out, run /watchtower recheck <package>, or override with /watchtower allow <package> if you trust it.',
    excludes:
      'A package is counted here once when it is held and again under Passed or Refused when the verdict lands, so Passed + Held + Refused can be more than Intercepts.',
  },
  {
    id: 'refused',
    label: '✖ REFUSED',
    what: 'Packages Watchtower would not let install: invented names, typosquats, known malware, Sentinel refusals and your own blocks.',
    why: 'Each one is an install that could have run someone else\'s code on your machine.',
    whatFollows:
      'Read the reason on the map or in the events log. Usually the agent should use the real package it was imitating. If Watchtower is wrong, a human can run /watchtower allow <package>.',
    excludes: 'A held package the Sentinel later refused is counted here as well as under Held.',
  },
  {
    id: 'unverified',
    label: 'UNVERIFIED',
    what: 'Packages allowed without checks because the registry could not be reached in time.',
    why: 'These installs went ahead without the usual safety checks.',
    whatFollows: 'Check your network. If the count keeps rising, run /watchtower recheck on the packages named in the events log.',
  },
  {
    id: 'unchecked',
    label: 'UNCHECKED',
    what: 'Parts of a command Watchtower could not read with confidence, such as git or URL specs, local paths and requirements files it could not follow.',
    why: 'Watchtower never guesses, so these were allowed and flagged rather than scored.',
    whatFollows: 'Look at the command in the events log and decide whether you are happy with what it installed.',
  },
  {
    id: 'overridden',
    label: 'OVERRIDDEN',
    what: 'Decisions a human changed with /watchtower allow or /watchtower block.',
    why: 'Overrides bypass scoring, so it is worth knowing how many are in force.',
    whatFollows: 'Review them with /watchtower overrides, and remove any you no longer need with /watchtower overrides clear <package>.',
    excludes: 'Counts overrides applied this session, including permanent ones you added now. Permanent overrides from earlier sessions are not counted.',
  },
  {
    id: 'tokens',
    label: 'TOKENS',
    what: 'Tokens used this session by the fleet: input, output, cache reads and cache writes added together. The fleet list shows each helper agent\'s share.',
    why: 'A runaway or looping agent shows up here first.',
    whatFollows: 'If one agent\'s count climbs fast while it achieves little, stop or redirect it.',
    excludes: 'Only turns Claude Code reported usage for while Watchtower was running. Figures of 1,000 or more are rounded (12.3k).',
  },
  {
    id: 'estCost',
    label: '≈ $ est.',
    what: `An estimate of what this session's tokens would cost at Anthropic's first-party list prices (as of ${PRICES_AS_OF}).`,
    why: 'It turns token counts into a figure you can compare with your budget.',
    whatFollows: 'Treat it as a rough guide, not a bill. Check your actual usage in the Claude Console or your plan.',
    excludes: `Tokens from models without a bundled price (only ${pricedModels} are priced) are left out and shown as "unpriced". It also ignores subscription plans, Batch and other discounts, fast mode, partner pricing (Bedrock, Vertex), one-hour cache writes (priced at the five-minute rate) and tax.`,
  },
]

export const legendFor = (id: FigureId): LegendEntry => LEGEND.find((e) => e.id === id)!

/** One line for a focused figure. */
export const legendLine = (id: FigureId): string => {
  const e = legendFor(id)
  return `${e.label}: ${e.what} ${e.whatFollows}`
}

/** The full text of /watchtower legend. */
export const legendText = (): string =>
  LEGEND.map((e) =>
    [
      e.label,
      `  What: ${e.what}`,
      `  Why it matters: ${e.why}`,
      `  What to do: ${e.whatFollows}`,
      ...(e.excludes ? [`  What it counts and leaves out: ${e.excludes}`] : []),
    ].join('\n'),
  ).join('\n\n')
