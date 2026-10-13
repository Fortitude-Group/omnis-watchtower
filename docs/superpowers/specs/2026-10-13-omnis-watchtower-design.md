# Omnis Watchtower — design (source document for `/speckit-specify`)

**Date:** 2026-10-13
**Owner:** Fortitude Omnis Group
**Status:** Design approved section by section in brainstorming; awaiting owner review of this document.
**Working name:** Omnis Watchtower (sits alongside OmnisRouter, OmnisVigil, OmnisBench).

This document is the input to `/speckit-specify`. It records the goals, the locked decisions,
what is out of scope, and the platform facts that were verified while designing. It is not the
governed spec; that is produced under `specs/<NNN>-omnis-watchtower/spec.md`.

---

## 1. Purpose

A Claude Code plugin that does two things at once:

1. **Mission control.** A live, animated, demoscene-style map of everything the coding agent
   fleet is doing in the session: the main agent, every subagent, what they touch, what they
   spend.
2. **Supply-chain tripwire.** Every package install any agent attempts (npm and PyPI) is
   checked before it runs. Clean packages pass, clear threats are blocked with evidence, and
   ambiguous ones are held while a dedicated **Sentinel** subagent investigates. The fleet
   polices itself, visibly.

**Why it exists.** Coding agents install packages without anyone reading the name. They invent
package names that do not exist, and attackers register those names (slopsquatting). They pick
typosquats. They run install scripts. Nothing in a stock session checks any of this. Watchtower
does, and makes the checking visible.

**Why it promotes Fortitude Omnis.** The pixel-pet plugin (lakmadev/pixel-pet) proved that a
live, characterful presence in the terminal gets shared. Watchtower pairs that presence with
real security engineering, and leads naturally to OSPulse (dependency drift) and Blast Radius
(install-time sandbox). The demoscene look carries the founder story: Spectrum, Amiga and
Team17-era graphics instincts applied to AI agents.

## 2. Success criteria

- A hallucinated or typosquatted package installed by any agent is blocked before it runs, and
  the agent receives evidence it can act on (typically choosing a correct alternative).
- An ambiguous package is held, investigated by the Sentinel, and resolved without the user
  doing anything, with the whole sequence visible on the map.
- Installation is one command (`/plugin marketplace add …` then `/plugin install …`), with no
  server, account or sidecar.
- The map is something a developer leaves open all day: readable, calm by default, cheap on
  CPU when idle.
- `/watchtower demo` replays a scripted attack convincingly enough to serve as the launch video
  and conference demo.
- A desktop renderer can be added later by writing one renderer class, with no change to the
  core, the tripwire or the scene model.

## 3. Locked decisions

| # | Decision | Chosen option | Why |
|---|---|---|---|
| D1 | Concept | Mission control (visual stage) + supply-chain tripwire (defence grid) + Sentinel subagent | Combines the most impressive visual with the most useful function |
| D2 | First surface | Terminal first, demoscene style, via `Raster` | Most users live in the terminal; animated pixel graphics there are rare; carries the founder story |
| D3 | Extensibility | Surface-agnostic scene model; terminal rasteriser is one implementation of a `Renderer` interface | Desktop (`Svg`/`Client`) must be a drop-in later |
| D4 | Enforcement | Tiered: 🟢 pass, 🔴 deny with evidence, 🟡 hold-by-deny + Sentinel; `userConfig` switch for warn-only | Real protection, and the Sentinel has a meaningful job |
| D5 | Ecosystems (v1) | npm and PyPI | Covers most agent-driven installs |
| D6 | Architecture | Self-contained mod with a portable, `$`-free core (approach A) | One-command install, no server, install data stays local, core reusable as CLI/CI later |
| D7 | Hold mechanism | Hold-by-deny with cached verdict on retry | Forced by the 10 s hook budget (see §9) |
| D8 | Sentinel timeout | Fail closed (deny), with a retry-to-reinvestigate path | Safety over convenience for unverified packages |
| D9 | Default theme | `radar` (green phosphor) | Calm, readable, threats stand out |
| D10 | Additional theme | `cracktro` (copper bars, starfield, rainbow ring, scrolltext) | Launch video and conference look |
| D11 | Rejected theme | Synthwave | Undersells the security message |
| D12 | Own-bug policy | Fail open with a loud warning; `strict` mode fails closed | Never brick a session through our own fault |

## 4. Architecture

```
hooks (agent.spawn, tool.call, tool results, turn/usage)
        │  translate
        ▼
  SceneEvent log ──► reduce(scene, event) ──► Scene (pure data)
  (timestamped,                                   │
   recordable)            step(scene, dt) ◄───────┘  animation / tweening
                                  │
                         Renderer interface
                 ┌────────────────┴────────────────┐
     TerminalRasterRenderer               (later) DesktopSvgRenderer
     framebuffer + theme passes            same Scene → Svg / Client
     → half-block encoder → text overlay → blit
```

Three layers with strict boundaries:

- **`core/`** — pure TypeScript, no `$`, no I/O. Install-command parser, signal scoring and tier
  rules, `SceneEvent` types, `reduce`, `step`, the `Renderer` interface, the framebuffer and
  the cell encoder. Fully unit-testable outside Claude Code and portable to a future CLI or CI
  action.
- **`adapters/`** — everything that touches the outside world through `$`: registry, OSV and
  deps.dev fetches via `$.http.fetch`, caching via `$.store`, file reads via `$.fs` (lockfiles,
  `requirements.txt`, `.npmrc`, `pip.conf`), Sentinel registration and dispatch via `$.agent`.
- **`hooks/`** — the mod entry (`register`): wires engine events to adapters and core, owns
  the pane, status line, toasts and slash commands.

### 4.1 Scene model

- **SceneEvents** are domain facts, not UI: `AgentLaunched`, `AgentActed`, `AgentFinished`,
  `PackageIntercepted`, `PackageScored`, `SentinelDispatched`, `VerdictIssued`, `SpendTick`.
- **Scene** is plain data: agents (type, state, trail, tokens), packages (ecosystem, name,
  version, status, signals with evidence), sentinels (target, phase), one-shot effects.
- Positions are **normalised world coordinates (0..1)**, never cells. Each renderer maps them
  to its own resolution.
- `reduce` and `step` are pure and deterministic given a seed.
- The event log is **recordable and replayable**. Replay drives deterministic test fixtures and
  `/watchtower demo`.

### 4.2 Renderer contract

`Renderer` exposes `mount(viewport)`, `frame(scene, t)` and `resize(viewport)`.

`TerminalRasterRenderer` (v1):

- Framebuffer of RGB pixels at `bodyColumns × (rows × 2)`: each `Raster` cell is the half-block
  `▀` with foreground = top pixel, background = bottom pixel. A 120×36-cell pane is a 120×72
  true-colour framebuffer.
- **Theme passes** draw into the framebuffer: background, ring, entities, effects. A theme is a
  bundle of passes plus palette tokens. New effects are new passes and never touch the encoder.
- **Cell encoder** turns the framebuffer into `Raster` cells. Braille glyphs are available for
  fine lines.
- **Text overlay** replaces pixel cells with glyph cells for labels; the cell background is the
  average of the two pixels it replaces (dimmed).
- Repaint via `$.ui.blit` without a render pass.

A future `DesktopSvgRenderer` consumes the same `Scene` and the same theme palette tokens.

## 5. Tripwire pipeline

### 5.1 Intercept and parse

`tool.call` on `Bash`, parsed by a pure parser in `core/`:

- **npm family:** `npm|pnpm|yarn|bun add|install <pkg…>`, and `npx <pkg>` (executes code
  immediately, so it is always checked).
- **PyPI family:** `pip|pip3|python -m pip install`, `uv add`, `uv pip install`, `poetry add`,
  `pipx install|run`, and `-r <requirements file>` (read via `$.fs`).
- Handles version specifiers, extras (`pkg[cli]`), flags (`--save-dev`, `-D`, `-U`), env-var
  prefixes and `&&`/`;` chains.
- **Bypass closure:** a bare `npm install` (or equivalent) or `pip install -r` is compared with
  the lockfile; any newly declared dependency is scanned. An agent cannot dodge the tripwire by
  editing `package.json` and then running a plain install.
- Commands that cannot be parsed (pipes into a shell, subshells, `eval`) are allowed and
  flagged on the map. v1 is not a shell sandbox.

### 5.2 Fast score

Signals fetched in parallel, each with a 4 s timeout, cached in `$.store`. Every signal produces
a one-line evidence string.

| Signal | Source | Effect |
|---|---|---|
| Package does not exist | Registry 404 | 🔴 deny: "this name does not exist; you probably invented it" |
| Known malicious (OSV id `MAL-*`, or CWE-506, or summary says malware/malicious; corrected in research R7) | OSV.dev | 🔴 hard block |
| Public package shadows a private package name (dependency confusion) | Registry + private-registry config | 🔴 hard block |
| First published < 7 days, or requested version < 72 h old | npm / PyPI JSON | 🟡 strong |
| Typosquat of a popular package (edit distance, homoglyphs, `-`/`_` confusion) | Bundled top-5k list per ecosystem | 🟡, or 🔴 combined with low downloads |
| Install scripts (`preinstall`/`install`/`postinstall`) or sdist-only on PyPI | Version manifest | 🟡 |
| Very low downloads; single maintainer *with* < 1k weekly downloads (corrected in research R8); no repository link | Downloads API, deps.dev | 🟡 weak |

Rules:

- A signal that could not be fetched is **unknown**, never clean.
- One missing weak signal never decides a verdict alone.
- If the malware signal (OSV) is unknown, the package cannot be cleared: it becomes 🟡.

### 5.3 Tiers

- 🟢 **Pass.** The call proceeds.
- 🔴 **Deny** with the evidence and, where one exists, a well-known alternative.
- 🟡 **Hold-by-deny.** The call is denied with: *"HELD: the Sentinel is investigating `<pkg>`.
  Carry on with other work and retry this exact command later; the verdict will be applied."*
  The Sentinel is dispatched at the same moment. On retry the cached verdict applies
  immediately. The verdict is also shown as a toast and added to the next turn's context.
- **Warn-only mode** (`userConfig`): nothing is denied; every tier is still shown and toasted.

### 5.4 The Sentinel

- Registered with `$.agent.register` as `<plugin>:sentinel`, hidden from the model through
  `agent.offer`, dispatched only by Watchtower via `$.agent.spawn`.
- Read-only tools (WebFetch). No Bash: it cannot install what it investigates.
- Default model Haiku, configurable in `userConfig`.
- Returns structured JSON: `verdict` (`allow` | `block`), `confidence`, `evidence[]`.
  Validated against a schema; malformed output is retried once, then treated as a failure.
- **Prompt-injection guard:** the Sentinel reads attacker-controlled content (READMEs, package
  descriptions). Its verdict can only resolve 🟡 cases and can never override a hard 🔴 signal.
  Its prompt frames all fetched content as untrusted data.
- No verdict within the configured timeout (default to be set in planning, in minutes) → the
  hold resolves to **deny**, with a "retry to reinvestigate" path.

## 6. Visual language

### 6.1 Themes

- `radar` (default): green phosphor with afterglow decay, rotating sweep, range rings,
  monochrome chrome so 🔴 and 🟡 stand out.
- `cracktro`: copper bars, 3D starfield, rainbow-cycling tripwire ring, rainbow scrolltext
  footer.
- Switched by `/watchtower theme <name>` or `userConfig.theme`.
- The approved animated mockups (shared simulation, two renderers) live in the brainstorm
  session folder and are the visual reference for implementation.

### 6.2 Layout

| Condition | Presentation |
|---|---|
| Pane open (`/watchtower` at any width; opens automatically at ≥ 144 terminal columns) | Full map sized to `bodyColumns`. ≥ 100 body columns: side panels (events left, fleet and stats right). 60–99: panels collapse into a ticker row under the map |
| Pane closed | Status line `🛡 12 ✔ · 1 ◆ · 1 ✖ · $0.42`, plus a toast on every 🔴 block and 🟡 hold |
| Always | Deny text carries full evidence, so the protection works with no visuals at all |

### 6.3 Event → visual mapping

| SceneEvent | Visual |
|---|---|
| `AgentLaunched` | Unit emerges from the central command ship, swings out to orbit, colour-coded by agent type, leaves a trail |
| `AgentActed` | Brief glint on the unit; event log names the tool and target ("coder · Edit auth.ts") |
| `AgentFinished` | Unit spirals back into the ship |
| `PackageIntercepted` | Grey blip flies in from beyond the ring, faint line back to the requesting agent |
| `PackageScored` 🟢 | Turns green, passes through to the ship |
| `PackageScored` 🔴 | Burst at the ring, label "✖ name — reason", toast |
| `PackageScored` 🟡 | Freezes at the ring with an amber pulse, toast "held" |
| `SentinelDispatched` | White unit launches, flies to the package, scans with expanding rings |
| `VerdictIssued` | Resolves to the 🟢 or 🔴 behaviour; Sentinel flies home |
| `SpendTick` | Spend counter rolls |

### 6.4 Figures on screen (constitution Principle XII)

Every figure shown (intercepts, held, blocked, spend, the status-line counts) must be able to
say what it is, why it matters and what follows, from the surface itself: a `/watchtower
legend` view and a one-line explanation on focus. Any figure for which no such sentence can be
written is removed rather than labelled. Counts that exclude anything (for example, packages
skipped because they resolve to a private registry) say so.

### 6.5 Accessibility and performance

- Verdicts are never colour-only: glyph (✔ ◆ ✖) plus label text.
- `reducedMotion` option: static frames, at most 4 fps.
- Adaptive frame rate: 30 fps while anything moves, 4 fps idle (sweep only), 0 when the pane
  is hidden.

## 7. Errors, timeouts, offline and overrides

Gating and rendering are independent: a rendering failure can never affect a security decision,
and a scoring failure can never freeze the UI.

- **Malware database unreachable:** package becomes 🟡 with evidence "malware database
  unreachable".
- **Registry unreachable:** install would fail anyway; allowed, marked *unverified* on the map.
- **Cache (`$.store`):** registry metadata 6 h, OSV 1 h, verdicts 24 h keyed by `name@version`;
  404s cached too. Cached clean verdicts make repeat installs instant and offline-safe.
- **Rate limits:** back off; the signal is unknown.
- **Private registries:** read `.npmrc` (scoped registries), `pip.conf`, `PIP_INDEX_URL` and
  `--index-url`. Packages resolving to a private registry are not checked against the public
  ones. `userConfig` allowlist patterns (`@acme/*`, `acme-*`) cover the rest. A public package
  with the same name as a private one is dependency confusion: 🔴.
- **Our own bugs:** a hook that throws or overruns its budget fails open via `.catch`, with a
  toast, a red WATCHTOWER FAULT banner on the map and a status-line marker. `strict` mode fails
  closed.
- **Sentinel failures** (spawn denied, malformed output after one retry, timeout): fail closed;
  the deny text says how to override.
- **Manual overrides:** `/watchtower allow <pkg>[@ver]` and `/watchtower block <pkg>`, for the
  session or permanently in `$.store`. Every override is shown on the map and in the log.
  Overrides must be initiated by the human, never by the model (see §9, open item O1).

## 8. Testing

Comprehensive coverage at merge (constitution Principle III).

**`core/` unit tests (vitest, no Claude Code required)**

- Parser: table of real install commands for every supported tool, plus a fuzz pass of mangled
  input; the parser never crashes and never silently misses a package.
- Scoring: each signal in isolation against recorded HTTP fixtures (real npm, PyPI, OSV and
  deps.dev responses captured once; no live network in tests); tier thresholds; "unknown is
  never clean".
- Adversarial corpus: historically real typosquats (e.g. `crossenv`), invented names, a
  dependency-confusion pair, an install-script package — each asserted to the correct tier.
- Scene: seeded `reduce`/`step` over recorded event logs, snapshotted.
- Renderer: framebuffer and encoded cells golden-snapshotted per theme on a seeded scene;
  performance budget for encoding a 120×36 frame (limit set from a baseline measured in
  planning).

**Mod tests (`claude plugin test`, against the real engine)**

- Gating: 🟢 passes; 🔴 denies with evidence; 🟡 hold-by-deny then retry picks up the cached
  verdict; warn-only mode.
- Sentinel with mocked `$.agent.spawn`: valid verdict, malformed output (retry then fail
  closed), timeout (fail closed), prompt-injection fixture that cannot override a hard 🔴.
- Faults: thrown hook fails open with warning; `strict` fails closed.
- UI: pane and status line mounted on the `terminal` surface with the mocked clock;
  surface-agnostic scene tests loop over `['terminal', 'desktop']`.
- `claude plugin validate` and `tsc` clean as gates.

**Manual smoke (documented):** `/watchtower demo` in Windows Terminal and in kitty or Ghostty,
both themes.

## 9. Platform facts

**Verified against the Claude Code mod API types (build 2.1.288) during design:**

- `tool.call` hooks can deny, rewrite or observe any tool call; `agent.spawn` fires for every
  subagent.
- Terminal surface has `Raster` (cells of `[codePoint, fg, bg]`, 24-bit colour, up to 512×256
  cells) repainted via `$.ui.blit` at up to 120/s taken, about 60 shown; and `Image` (kitty
  graphics protocol where supported). It has no `Svg`.
- Desktop surface has `Svg` and `Client` (a plugin surface module with its own state, timers and
  pointer events). It has no `Raster`.
- A pane opened unasked docks only at ≥ 144 terminal columns; opened by the user it seats at any
  width.
- `$.http.fetch`, `$.store`, `$.fs`, `$.process`, `$.agent.register` / `$.agent.spawn`, and
  `agent.offer` (to hide an agent type from the model) all exist.
- Hook budget is 10 s of the hook's own time. Waiting on `next` and on `$` calls does not
  count; `$.clock.sleep` does. Hence hold-by-deny (D7).

**Open items to settle in planning (not yet verified):**

- **O1.** How a `command.run` hook distinguishes a user-typed slash command from a
  model-invoked one. If no reliable signal exists, overrides require an interactive
  confirmation button in the pane.
- **O2.** How the Sentinel's answer is collected (expected: its `turn.complete` matched by
  `agentId`, per the API's own example).
- **O3.** How terminals without true colour render `Raster` colours (assumed the engine
  downsamples).
- **O4.** Default Sentinel timeout and the frame-encode performance budget, from measurement.
- **O5.** The pixel-pet minimum version requirement (2.1.293+) versus the 2.1.288 types read
  here; pin the minimum Claude Code version the plugin declares.

## 10. Out of scope (v1)

- Desktop, VS Code and mobile renderers (designed for, not built).
- Ecosystems beyond npm and PyPI (NuGet, crates, Go, gems).
- Shell sandboxing or analysis of arbitrary commands (`curl | sh`).
- Running installs in a sandbox (that is Blast Radius's job).
- A hosted Fortitude scoring API or OSPulse integration (planned as a later opt-in upsell).
- Synthwave theme.

## 11. Delivery

- Repository: `Fortitude-Group/omnis-watchtower` (private initially), created as
  `fortitude-omnis`.
- Distribution: Claude Code plugin marketplace (`/plugin marketplace add …`,
  `/plugin install …`), as pixel-pet does.
- Next step after owner review: `/speckit-specify` with this document as input.
