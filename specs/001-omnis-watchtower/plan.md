# Implementation Plan: Omnis Watchtower

**Branch**: `master` (owner works on master; Spec Kit feature id `001-omnis-watchtower`) | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-omnis-watchtower/spec.md`; design source
`docs/superpowers/specs/2026-10-13-omnis-watchtower-design.md`.

## Summary

A Claude Code plugin (mod) that intercepts every npm/PyPI install attempted by any agent in the
session, scores it against live public data (registries, OSV, deps.dev, download stats, a bundled
popular-names list), and passes, refuses or holds it. Holds dispatch a hidden, read-only Sentinel
subagent whose structured verdict is applied when the agent retries. Everything is rendered as a
demoscene-style mission-control map in a terminal `Raster` pane (radar default, cracktro theme),
driven by a pure, replayable scene model behind a surface-agnostic `Renderer` contract.

Phase 0 resolved all five design open items and corrected two design-doc rules against live data:
malware detection must include GHSA advisories with CWE-506, not only `MAL-` ids (R7), and the
single-maintainer signal must be combined with low adoption (R8). See [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 5.x (ES modules, `.ts`/`.tsx`). Runs in the Claude Code mod runtime (no Node, no DOM, web APIs only). `core/` is also executed by Node 24 under vitest.

**Primary Dependencies**: **None at runtime** (the mod runtime has no npm resolution, R11). Dev only, pinned exact: `typescript`, `vitest`. Engine API types are written by Claude Code into `.claude-plugin/types/` and never vendored.

**Storage**: `$.store` (cross-session: fetch cache, verdicts, permanent overrides) and `$.state` (session: scene, investigations, session overrides, theme). See data-model §Persistence.

**Testing**: vitest (core: parser, scoring, tier rules, scene, renderer goldens, perf budget); `claude plugin test` (mod: gating, Sentinel lifecycle, overrides, faults, UI mounts on `terminal` with a loop over `['terminal','desktop']` for surface-agnostic parts); `claude plugin validate`; `tsc`.

**Target Platform**: Claude Code ≥ 2.1.296, terminal surface (Windows Terminal, macOS Terminal/iTerm2, kitty, Ghostty, Linux terminals). Desktop renderer designed for, not built.

**Project Type**: Claude Code plugin distributed through a plugin marketplace in the same repo.

**Performance Goals**: decision for first-seen package < 5 s p95, cached < 0.5 s (SC-003); 30 fps while animating, 4 fps idle, 0 hidden; frame encode ≤ 1.5 × measured baseline (provisional ≤ 4 ms for 120×36, R5); idle CPU < 2 % of one core (SC-007).

**Constraints**: 10 s hook budget of own time (fetches and `next` excluded, `$.clock.sleep` included); no `import()`; plugin tests have no fs/network/process (fixtures as TS modules); private-registry packages never sent to public sources; no Fortitude service receives install data (FR-034).

**Scale/Scope**: one session; up to ~15 concurrent agents on the map; up to ~200 packages per command (requirements files), fetched with bounded concurrency (8); popular lists 5,000 names per ecosystem.

## Constitution Check

*Gate evaluated before Phase 0 and re-evaluated after Phase 1 (below). Source:
`.specify/memory/constitution.md`.*

| Principle | How the plan complies | Pre | Post |
|---|---|---|---|
| Prime Directive / VI Complete the scope | All five user stories, both themes, demo, overrides and legend are in this plan; nothing in scope is deferred. Desktop renderer, extra ecosystems and hosted API are owner-declared out of scope (spec Assumptions, design §10). | ✅ | ✅ |
| I Modular & composable | `core/` (pure parse, score, scene, render), `adapters/` (I/O through `$`), `hooks/` (thin wiring). Shared logic lives once in `core/`. | ✅ | ✅ |
| II Contract stability & SemVer | Public contracts written down: [user-surface](contracts/user-surface.md), [renderer](contracts/renderer.md), [verdict schema](contracts/sentinel-verdict.schema.json). Plugin starts at 0.1.0, dev deps pinned exact. | ✅ | ✅ |
| III Comprehensive tests | Every contract and guarantee has tests incl. edge cases: parser fuzz, unknown-signal rules, adversarial and benign corpora, Sentinel malformed/timeout/injection, faults, goldens (quickstart §2). | ✅ | ✅ |
| IV Deterministic & observable | `core/` never reads a clock or randomness except a seeded PRNG in `Scene`. Goldens per theme. Every decision carries evidence. Faults are surfaced as scene events, toasts and status. Debug log lines per decision. | ✅ | ✅ |
| V Simplicity | Two abstractions only, each tied to a requirement: `Renderer` (FR-026) and theme passes (FR-020). No sidecar, no server, no runtime deps. | ✅ | ✅ |
| VII Tracker in sync | GitHub Issues on `Fortitude-Group/omnis-watchtower` via `/speckit-taskstoissues`. Commits reference `#N`, issues closed as tasks land (R16). | ✅ | ✅ |
| VIII Fresh base | Single dev on `master`. Pull before each work session. | ✅ | ✅ |
| IX Ask, then wait | All design decisions locked with the owner. The remaining owner decision (PyPI list licence, R10) is flagged, not assumed. | ✅ | ✅ |
| X Production waits for a human | No production environment. Publishing the public marketplace listing or making the repo public is an outward-facing change that will be confirmed with the owner first. | ✅ | ✅ |
| XI Mechanism first | Every platform claim verified against engine types or live endpoints. Two design rules corrected by evidence (R7, R8). Unverified items listed (R3 envelope position, R4 256-colour). | ✅ | ✅ |
| XII Explain every number | `/watchtower legend` and focus explanations. Spend shown as exact tokens plus a labelled list-price estimate only (R14). Exclusions stated. | ✅ | ✅ |
| Dependency discipline | Zero runtime deps. Dev deps pinned. `npm-high-impact` MIT verified. **PyPI top-list licence unresolved → not shipped until resolved (R10).** | ⚠️ tracked | ⚠️ tracked |

Gate result: **PASS**. The one ⚠️ is a tracked licence check with a fallback (rank PyPI names
from the public BigQuery dataset), not a violation. No Complexity Tracking entries are required.

## Project Structure

### Documentation (this feature)

```text
specs/001-omnis-watchtower/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── user-surface.md            # slash commands, userConfig, deny text, status line
│   ├── renderer.md                # Renderer + Theme extension contract
│   └── sentinel-verdict.schema.json
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
.claude-plugin/
└── marketplace.json               # marketplace listing → ./src/plugin

src/plugin/                        # the installable plugin root
├── .claude-plugin/plugin.json     # name, version, userConfig, "types": "./types/index.d.ts"
├── hooks/
│   ├── hooks.json                 # { "modules": ["./register.ts"] }
│   ├── register.ts                # wiring only: event → adapter/core → state
│   ├── gate.ts                    # tool.call(Bash) tripwire: parse → score → decide → deny text
│   ├── sentinel.ts                # agent.register/offer, spawn, turn.complete matching, timeouts
│   ├── fleet.ts                   # agent.spawn / tool.call / turn.complete → SceneEvents, usage
│   ├── commands.ts                # /watchtower … incl. origin rule for overrides
│   ├── pane.tsx                   # Pane render + blit loop + adaptive fps + layout tiers
│   └── status.ts                  # status line + toasts + next-turn context
├── core/                          # pure, $-free, runs under Node and the mod runtime
│   ├── parse/                     # tokenize.ts, npm.ts, pypi.ts, requirements.ts, lockfile-diff.ts
│   ├── score/                     # signals.ts, malware.ts, typosquat.ts, tier.ts, evidence.ts
│   ├── scene/                     # events.ts, reduce.ts, step.ts, prng.ts, layout.ts
│   ├── render/                    # renderer.ts, framebuffer.ts, encoder.ts, base64.ts, overlay.ts,
│   │                              # terminal-raster.ts, themes/radar.ts, themes/cracktro.ts
│   ├── data/                      # popular-npm.ts, popular-pypi.ts (generated), prices.ts, demo-script.ts
│   └── text/                      # deny-text.ts, legend.ts (contract strings)
├── adapters/
│   ├── http.ts                    # $.http.fetch with timeout, concurrency limit, backoff
│   ├── cache.ts                   # $.store TTL cache
│   ├── npm.ts  pypi.ts  osv.ts  depsdev.ts  downloads.ts
│   └── project-config.ts          # .npmrc, pip.conf, PIP_INDEX_URL, lockfiles via $.fs
├── types/index.d.ts               # PluginState contract
└── tests/                         # claude plugin test: *.test.ts (+ fixtures as .ts)

tests/                             # vitest (core only)
├── core/parse/  core/score/  core/scene/  core/render/
├── corpus/                        # adversarial + benign corpora (TS modules)
└── fixtures/http/                 # recorded registry/OSV/deps.dev responses (TS modules)

scripts/
├── build-popular-lists.mjs        # release-time: generates core/data/popular-*.ts
└── record-fixtures.mjs            # captures live responses into tests/fixtures/http

docs/                              # design doc, README assets, demo GIF
package.json  tsconfig.json  vitest.config.ts
```

**Structure Decision**: one installable plugin under `src/plugin/` (so it obeys the "source
under /src" rule), with a repo-root marketplace manifest so users install with `/plugin
marketplace add Fortitude-Group/omnis-watchtower`. `core/` sits inside the plugin because a mod
may only import its own files. Core unit tests live in the root `tests/` (vitest, Node). Engine
integration tests live in `src/plugin/tests/`, where `claude plugin test` finds them. *To
confirm in the first implementation task*: that `claude plugin test` discovers tests in a
subfolder. If not, they move to the plugin root.

## Parallelisation guidance (for /speckit-tasks)

The layer boundaries make most work independent. Fan out through Claude Flow / RuFlo where
available, otherwise the Task tool:

- **Lane A, parse** (`core/parse` + tests) — independent.
- **Lane B, score** (`core/score` + corpora + fixtures) — independent of A (works on `PackageRef`).
- **Lane C, scene** (`core/scene` + replay tests) — independent.
- **Lane D, render** (`core/render`, both themes, goldens, perf) — depends only on the `Scene`
  type from C (define the types first, then parallel).
- **Lane E, adapters** — independent (fixture-driven).
- **Lane F, data scripts** (popular lists, prices, demo script) — independent. The PyPI licence
  check runs here.
- **Serial integration chain**: `hooks/` wiring (gate → sentinel → fleet → commands → pane →
  status) depends on A–E and shares `register.ts`, so it stays serial with per-task review.
  This is the identified exception.

## Complexity Tracking

No constitution violations. Nothing to justify.
