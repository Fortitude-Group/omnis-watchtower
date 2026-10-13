# Contract: User-facing surface

Everything a developer or a coding agent can observe or invoke. This is the plugin's public
contract (Principle II).

## Slash commands

| Command | Effect | Origin rule |
|---|---|---|
| `/watchtower` | Open the mission-control pane, or close it if it's showing | any |
| `/watchtower close` | Close the pane (Esc at an empty prompt also closes it: opened with `closeOnEscape`) | any |
| `/watchtower theme <radar\|cracktro>` | Switch theme, state kept | any |
| `/watchtower legend` | Explain every figure on screen (Principle XII) | any |
| `/watchtower demo` | Replay the scripted attack; no network, no installs | any |
| `/watchtower status` | Text summary: totals, active investigations, overrides, faults | any |
| `/watchtower allow <pkg>[@ver] [--permanent]` | Override to allow | `origin.kind === 'composer'` or pane Button (research R1) |
| `/watchtower block <pkg> [--permanent]` | Override to block | same |
| `/watchtower overrides [clear <pkg>]` | List or remove overrides | clear: same rule |
| `/watchtower recheck <pkg>[@ver]` | Drop cached verdict and re-investigate | same as allow (it re-rolls the Sentinel; code review 2026-10-13) |

`<pkg>` is written `npm:name` or `pypi:name`. A bare name is accepted when unambiguous in the
current project (detected from the manifest), otherwise the command asks which ecosystem.

## userConfig (plugin.json)

| Field | Type | Default | Notes |
|---|---|---|---|
| `mode` | `"enforce" \| "warn-only"` | `enforce` | FR-030 |
| `strict` | boolean | `false` | Fail closed on internal fault (FR-030) |
| `theme` | `"radar" \| "cracktro"` | `radar` | FR-020 |
| `autoOpen` | boolean | `true` | Auto-open pane when ≥ 144 columns |
| `reducedMotion` | boolean | `false` | ≤ 4 fps, static effects (FR-025) |
| `sentinelModel` | `"haiku" \| "sonnet"` | `haiku` | FR-033 |
| `sentinelTimeoutSec` | number 60–900 | `180` | FR-033, research R5 |
| `privateAllowlist` | string (comma-separated globs) | `""` | e.g. `@acme/*, acme-*` (FR-012) |

## Text Claude receives (deny reasons)

Stable prefixes so agents (and tests) can rely on them:

```
WATCHTOWER REFUSED <ecosystem>:<name>[@ver]
- <evidence line>
- <evidence line>
Suggested alternative: <name>            (when known)
Override (human only): /watchtower allow <ecosystem>:<name>
```

```
WATCHTOWER HELD <ecosystem>:<name>[@ver] — the Sentinel is investigating.
Carry on with other work and retry this exact command later; the verdict will be applied.
- <evidence line that caused the hold>
```

```
WATCHTOWER REFUSED <ecosystem>:<name> — investigation <failed|timed out> (<reason>).
Re-investigate: /watchtower recheck <ecosystem>:<name>   Override (human only): /watchtower allow …
```

A command touching several packages lists one block per package, refused and held first.

## Cooldown pin (FR-035)

The command runs rewritten. The agent sees this in the tool result's context:

`WATCHTOWER PINNED <ecosystem>:<name> → <pinned version> (latest <fresh version> is under 72 hours old; cooldown against hijacked releases)`

## Next-turn context on verdict (FR-018)

`WATCHTOWER VERDICT <ecosystem>:<name> → <allowed|refused>: <top evidence line>`

## Status line

`🛡 <passed> ✔ · <held> ◆ · <refused> ✖ · <tokens>` (plus `⚠ FAULT` while a fault is active).
Counts are session totals. `/watchtower legend` states what each figure excludes (for example,
private-registry packages are counted as passed and labelled so).

## Notifications (toasts)

Shown on every refusal, hold, verdict and fault, for example `✖ Watchtower refused npm:reqeusts —
typosquat of requests`.
