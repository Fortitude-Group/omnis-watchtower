# Phase 0 Research: Omnis Watchtower

**Date**: 2026-10-13
**Method**: Every item below was settled against a primary source in this session: the Claude
Code mod API declarations written by the engine (`claude-code.d.ts`, "Written by Claude Code
2.1.288"), the plugin-authoring reference, live HTTP calls to each public data source, and local
tool versions. Each entry says what was **verified** and what remains **assumed**.

Installed toolchain (verified): Claude Code **2.1.296**, Node **v24.19.0**, npm **11.17.0**.

---

## R1. Override origin — design open item O1

- **Decision**: A `/watchtower allow|block` override is applied only when `command.run`'s
  `e.origin.kind === 'composer'` (the user's own Enter at the prompt), or when it comes from a
  `ui.press` on a Watchtower pane Button (a pointer/keyboard gesture by the person). Every other
  origin (`sdk`, `plugin`, `task-notification`, `scheduled-trigger`, `peer`, `peer-send-message`,
  `projects-relay`, `bridge`, unclassified) is refused with an explanation, and the override is
  offered as a pane confirmation Button instead.
- **Verified**: `CommandRunInput.origin: PromptOrigin`. The `composer` variant is documented as
  "The user's own gesture at the terminal, as the engine stamped it (never presumed from an
  unstamped command)… a channel the engine cannot attest… arrives as `unclassified`."
- **Rationale**: `composer` is engine-attested, so a model cannot forge it. `bridge` (Remote
  Control from a phone) is a genuine user too, but it is excluded from v1 to keep the rule to
  one attested channel. Revisit if users ask.
- **Alternatives considered**: always requiring a pane Button (safe but clumsy when the pane is
  closed); trusting any slash command (unsafe: a model-invoked command would let a blocked agent
  unblock itself).

## R2. Collecting the Sentinel's verdict — design open item O2

- **Decision**: `$.agent.spawn({ subagentType: '<plugin>:sentinel', prompt, description })`
  returns `{ agentId }`. A `turn.complete` hook whose `e.agentId` matches resolves the
  investigation with `e.answer`, which is parsed and validated as the Sentinel verdict JSON
  (contracts/sentinel-verdict.schema.json). `e.reason` other than `'answer'` (`aborted`,
  `refusal`, `error`) counts as a failure.
- **Verified**: `AgentSpawnResult.agentId` ("the same string its loop's `tool.call` events carry
  as `agentId`"); `TurnCompleteFields` has `answer`, `agentId?`, `turnId`, `durationMs`,
  `isAborted`, `usage?`; `TurnCompleteReason = 'answer' | 'aborted' | 'refusal' | 'error'`. The
  API's own `$.agent.register` example uses this exact pattern.
- **Alternatives considered**: polling `$.session.messages({ agentId })` (wasteful, and polling
  with `$.clock.sleep` burns hook budget).

## R3. Attributing installs to subagents

- **Decision**: The tripwire hooks `tool.call` on `Bash` once. Calls made inside a subagent raise
  their own `tool.call` carrying that subagent's `agentId`, so every agent is covered and every
  install is attributed to its agent on the map. Calls with no `agentId` belong to the main
  agent.
- **Verified**: types line "a subagent's tools raise their own `tool.call`"; the `agentId` doc on
  `AgentSpawnResult` quoted in R2.
- **Assumed, to confirm in a mod test**: exactly where `agentId` sits on the `tool.call` input
  envelope. A plugin test spawning a subagent that runs Bash settles it.

## R4. Terminals without true colour — design open item O3

- **Decision**: Watchtower always emits 24-bit colours. Downsampling is the engine's concern.
  Themes are designed so their meaning survives quantisation to 256 colours: the radar theme is
  mostly one hue family, and the three verdict colours (green, amber, red) are far apart and
  always paired with a glyph and label (FR-024).
- **Verified**: `RasterProps.cells` colours are `0x00RRGGBB` or "the terminal's default".
- **Not verified**: how the engine renders those on a 256-colour terminal. The types say
  nothing. **Residual risk**, covered by a manual smoke step in a 256-colour terminal
  (quickstart §6).

## R5. Sentinel timeout and frame-encode budget — design open item O4

- **Decision (provisional, measured during implementation)**:
  - Sentinel timeout default **180 s**, configurable 60–900 s. Rationale: a Haiku-class
    investigator doing 5–10 fetches typically finishes in well under two minutes; 180 s leaves
    margin without leaving an agent waiting indefinitely. SC-004 (≥ 90 % of holds resolved
    within the default) is the acceptance test; if measurement misses it, the default moves,
    not the criterion.
  - Frame-encode budget: a baseline is measured for a 120×36 frame on the dev machine during
    implementation; the performance test then fails if encoding exceeds **1.5× that baseline**.
    The provisional ceiling, before measurement, is 4 ms (a 30 fps frame is 33 ms).
- **Why not fixed now**: Principle XI. These are measurements, not guesses.

## R6. Minimum Claude Code version — design open item O5

- **Decision**: Watchtower declares **Claude Code ≥ 2.1.296**, the version it is developed and
  tested on, in the README and marketplace entry.
- **Verified**: installed `claude --version` = 2.1.296; the API declarations read during design
  were written by 2.1.288 and carry an "EARLY ACCESS: this surface may change between releases
  without notice" warning. A grep of the reference and declarations found no manifest field for
  a minimum engine version.
- **Consequence**: the version is a documented requirement, not an enforced one. `claude plugin
  validate` and `tsc` against the engine-written types on each upgrade are the guard.

## R7. Detecting known malware (correction to the design doc)

- **Decision**: A package/version is **known malware** when an OSV result for it has an id
  starting `MAL-`, **or** `database_specific.cwe_ids` contains `CWE-506` (embedded malicious
  code), **or** its `summary` matches `/\b(malware|malicious)\b/i`. Query OSV with the version
  when known (malware is often version-specific, e.g. hijacked releases).
- **Verified (live)**: `crossenv` (npm) returns `GHSA-c2m4-w5hm-vqjw`, summary "crossenv is
  malware", `cwe_ids: ["CWE-506"]`, with **no** `MAL-` id. `ctx` (PyPI) returns
  `GHSA-4g82-3jcr-q52w` "Malware in ctx" (`cwe_ids: ["CWE-912"]`) and `GHSA-67r3-h899-9w95`
  "Embedded Malicious Code in ctx" (`cwe_ids: []`). **Neither carries CWE-506**, so `ctx` is
  caught only by the summary rule (corrected 2026-10-13 from the recorded fixture, which an
  earlier draft of this entry overstated). The design doc's "`MAL-` advisory" rule alone would
  have missed both packages, which is why all three tests (id, CWE, summary) are needed.
- **Alternatives considered**: `MAL-` only (misses GitHub-reviewed malware, as shown).

## R8. Maintainer signal (correction to the design doc)

- **Decision**: "Single maintainer" counts as a weak signal **only together with fewer than
  1,000 downloads a week**. "New maintainer" is dropped: the registry exposes only current
  maintainers, so a change cannot be detected reliably from public data.
- **Verified (live)**: `chalk` has **1** maintainer and **498,507,821** downloads in the week
  2026-10-05 to 2026-10-11. A bare single-maintainer signal would flag one of the most-used
  packages on npm, breaking SC-002.

## R9. Data sources and endpoints

All verified live on 2026-10-13 (HTTP status, latency from this machine):

| Purpose | Endpoint | Result |
|---|---|---|
| npm existence + version manifest (scripts, repository) | `GET registry.npmjs.org/<pkg>/<version\|latest>` | 200, ~2.6 KB for `chalk/latest`; 404 for `react-dom-utilz` (0.34 s) |
| npm publish times per version | `GET api.deps.dev/v3/systems/npm/packages/<pkg>` | 200 (0.18 s); `versions[].publishedAt` present |
| npm downloads (bulk up to 128 unscoped names) | `GET api.npmjs.org/downloads/point/last-week/<a,b,c>` | 200 (0.69 s) |
| PyPI existence, releases, upload times, dist types | `GET pypi.org/pypi/<pkg>/json` | 200 (0.09 s); 404 for unknown |
| PyPI downloads | `GET pypistats.org/api/packages/<pkg>/recent` | 200 (0.49 s) |
| Malware/vulnerability advisories | `POST api.osv.dev/v1/query` | 200; shape in R7 |

- **Decision**: avoid the full npm packument (137 KB for `chalk`, and multi-megabyte for large
  packages). Use the per-version manifest for scripts and repository, and deps.dev for publish
  times. All fetches run in parallel with a 4 s timeout each; `$.http.fetch` time does not count
  against the hook budget.

## R10. Popular-package reference lists (typosquat detection)

- **Decision**: A maintainer script (`scripts/build-popular-lists.mjs`, Node, run at release
  time, never at runtime) generates `src/core/data/popular-npm.ts` and
  `src/core/data/popular-pypi.ts`, the top 5,000 names per ecosystem. They are generated as
  TypeScript modules because the plugin test environment has no filesystem (R11).
  - **npm**: candidate names from `npm-high-impact` (v1.13.0, MIT, verified), ranked by the bulk
    downloads endpoint.
  - **PyPI**: `hugovk/top-pypi-packages` monthly dump (verified reachable; last update
    2026-10-01).
- **Open licence check**: the GitHub API reports **no licence** for `hugovk/top-pypi-packages`.
  A list of package names and counts is largely factual, but constitution dependency discipline
  requires a licence review before shipping. Task: confirm the terms with the maintainer, or
  rank PyPI names ourselves from the public PyPI BigQuery dataset. Until then the list is
  committed only as a build input, not shipped.

## R11. Mod runtime constraints

**Verified** (types header and reference):

- The hooks module and every file it imports from the plugin are ES modules (`.ts`, `.tsx`, …).
  No `require`, no `import()` (a module holding one does not load), no DOM, no Node. Web APIs
  such as `URL`, `TextEncoder`, `AbortController` and `crypto.subtle` exist.
- Imports are files of the plugin. **There is no npm dependency resolution at runtime**, so
  Watchtower ships **zero runtime dependencies**. That suits a supply-chain security tool.
- `claude plugin test` runs `*.test.ts` in the same kind of environment, with **no fs, network
  or process**. `mock` supplies the clock, store and env. Fixtures must be TypeScript modules.
- `Uint8Array.prototype.toBase64` is used in the API's examples, but Node 24 lacks it (verified:
  `typeof … === 'undefined'`). Decision: `core/` carries its own small base64 encoder, tested
  against Node's `Buffer` in vitest, so `core/` runs identically under Node and in the mod.

## R12. Hook budget and hold-by-deny

- **Verified**: `HookBudget.ms = 10_000`, counted only while the hook's own code runs; time spent
  waiting on `next` or `$` calls is excluded, except `$.clock.sleep`, which counts.
- **Decision**: the fast-score path (parallel fetches) runs inside the `tool.call` hook. Holds
  are expressed as a deny (D7). A `.catch` on the registration implements fail-open/strict
  (D12) within its 1 s grace.

## R13. Shell command parsing

- **Decision**: a hand-written tokenizer and parser in `core/` (POSIX-ish quoting, `&&`, `||`,
  `;`, env-var prefixes, `sudo`, `python -m pip`), with no third-party parser.
- **Rationale**: no runtime dependencies are possible (R11), and a narrow parser that recognises
  only install verbs is far smaller than a general shell parser. Anything it cannot read
  confidently is classed `unchecked` (FR-003), never guessed.

## R14. Spend figure (Principle XII)

- **Verified**: `turn.complete` usage carries `model`, `input_tokens`, `output_tokens`,
  `cache_read_input_tokens` and `cache_creation_input_tokens`. **No cost field.**
- **Decision**: the fleet panel shows **tokens per agent** (exact). An **estimated cost**
  appears only when the model is in a bundled list-price table, and it is labelled "≈ est.,
  list price". The legend answers XII's three questions: *what* (the fleet's token use and
  estimated list-price cost this session), *why* (a runaway or looping agent shows up here
  first), *what follows* (stop or redirect the agent that's burning tokens). Unknown models show
  tokens only, and the status line says the estimate excludes them.

## R15. Pane placement and surfaces

- **Verified**: a pane opened unasked docks only from 144 terminal columns; opened by the user
  it seats at any width. `e.props.bodyColumns` gives the drawable width. Terminal has `Raster`,
  `Image` and `Client`, but no `Svg`. Desktop has `Svg` and `Client`, but no `Raster`.
  `$.ui.blit` repaints a mounted `Raster` (up to 120/s taken, ~60 shown).
- **Decision**: as in design §6.2. Auto-open at `session.start` only when the viewport is at
  least 144 columns wide **and** the user has `autoOpen` enabled (default on).

## R17. Engine static-scan rules (found while implementing Phase 2)

`claude plugin validate` scans hook source and refuses:

- **`$` passed across an import**: "$ is followed only into a function declared in this same
  file, never across an import; $ is always spelled $.noun.event(...) at the call site".
  Closures defined in the hook file that call `$.noun.method` and are handed to imported code
  **pass** (verified). This produces the ports design in tasks.md Conventions.
- **State atoms not written literally in the file**: "the state library's read takes a source
  the scan can read: a reference whose plugin and key are string literals, or what atom…
  made of one, written there or in a const of this file".
- **A contract with imports or non-exported top-level types**: "the contract must be
  self-contained (no import, export … from, require or reference)" and "a top-level `type`
  without `export` would be global in a dependent's program".
- In engine tests, `$.command.run` from a test carries no `origin` (verified:
  `e.origin` undefined), and `$.store` needs `mock.store(on)` ("no implementation for
  store.get").

Consequence: no design change to behaviour. Only the code structure changes (adapters take
ports, atoms are per-file, persisted types live in the contract), and it is recorded in
tasks.md Conventions.

## R18. Live benign sweep (T042, SC-002), 2026-10-13

`WT_LIVE=1 node node_modules/vitest/vitest.mjs run tests/live` scores the top 500 npm and top 500
PyPI packages against the live registries. Results are in `docs/validation/benign-sweep-2026-10.md`.

- **First run: 4 refusals** (pnpm, undici, vitest, litellm). Two causes, both fixed:
  1. The R7 summary rule matched "malicious" in ordinary vulnerability advisories ("via
     Malicious Patch File", "a malicious website"). Now: `malware` anywhere, or a summary that
     *opens* with "(embedded) malicious code/package/version/release".
  2. OSV advisories describe affected versions as ranges, which we didn't evaluate, so litellm's
     advisory for two hijacked releases condemned every version. Now OSV is queried with the
     resolved version, so OSV does its own range matching.
- **Second run: 0 refusals, 39 holds**, all PyPI. 28 were fresh releases that weren't pinned,
  because the PyPI popular list is the 100-name placeholder (T037), and 6 were look-alikes
  between genuinely popular packages (pynacl/pyyaml, gunicorn/uvicorn, grpclib/grpcio,
  tomli-w/tomlkit, markdownify/markdown-it-py, httpx2/httpx).
- **Fix:** "popular" for the cooldown pin also means at least 100,000 weekly downloads, a signal
  that needs no dataset licence, and a look-alike with at least 50,000 weekly downloads is a
  neighbour, not a squatter.
- **Third run: 998 pass (59 pinned), 0 refused, 2 held** (databricks-sdk and nbconvert: each has a
  fresh release *and* no linked repository, two signals, so the hold is the cautious answer).

## R16. Tracker (constitution Principle VII)

- **Decision**: the project of record is **GitHub Issues** on `Fortitude-Group/omnis-watchtower`
  (the repo already exists, private). `/speckit-taskstoissues` creates the issues after
  `/speckit-tasks`. Commits reference issues (`#N`), and issues are closed as each task lands.
