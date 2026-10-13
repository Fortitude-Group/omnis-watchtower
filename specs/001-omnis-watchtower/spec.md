# Feature Specification: Omnis Watchtower

**Feature Branch**: `master` (owner works directly on master; no feature branch)

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "Omnis Watchtower — use docs/superpowers/specs/2026-10-13-omnis-watchtower-design.md as the authoritative, self-contained input (locked decisions D1–D12, architecture, tripwire pipeline, visual language, error handling, testing, verified platform facts, open items O1–O5, out of scope). Short name: omnis-watchtower."

## Overview

Omnis Watchtower is a plugin for the Claude Code coding assistant. It gives a developer two things
in one place:

1. **A supply-chain tripwire.** Every package installation that any coding agent in the session
   attempts (npm and PyPI ecosystems) is checked before it runs. Clean packages proceed, clear
   threats are stopped with evidence the agent can act on, and ambiguous packages are held while
   a dedicated investigator agent (the **Sentinel**) examines them.
2. **Mission control.** A live, animated, retro "demoscene" map of the agent fleet: the main
   agent, every helper agent, what they are doing, what they spend, and every package decision as
   it happens.

The authoritative design rationale, locked decisions (D1–D12) and verified platform facts live in
the source design document named in the Input line. This specification states what the product
must do and how success is judged.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dangerous installs are stopped before they run (Priority: P1)

A developer is working with a coding agent that decides to install a package. The package name
was invented by the agent (it does not exist), or is a near-miss of a popular package
(typosquat), or is flagged as known malware. Watchtower stops the installation before anything is
downloaded or executed, and tells the agent exactly why, so the agent can choose a correct
alternative without the developer intervening.

**Why this priority**: This is the protection itself. It delivers value with no visuals at all,
and it is the reason a developer would install the plugin and keep it.

**Independent Test**: In a session with only the tripwire active (no map open), ask the agent to
install a non-existent package, a known typosquat and a package with a malware advisory. Each is
refused with a reason; a legitimate popular package installs normally.

**Acceptance Scenarios**:

1. **Given** the tripwire is active, **When** an agent tries to install a package name that does
   not exist in the public registry, **Then** the install is refused before running, and the
   agent is told the name does not exist and was probably invented.
2. **Given** the tripwire is active, **When** an agent tries to install a package with a
   known-malware advisory, **Then** the install is refused with the advisory as evidence,
   regardless of any other signal.
3. **Given** the tripwire is active, **When** an agent tries to install a close misspelling of a
   popular package that has very low adoption, **Then** the install is refused with evidence
   naming the popular package it imitates, and the popular package is suggested.
4. **Given** the tripwire is active, **When** an agent installs a well-established popular
   package, **Then** the install proceeds with no visible delay beyond the check itself and no
   refusal.
5. **Given** the developer's project is configured to use a private registry for some packages,
   **When** an agent installs one of those private packages, **Then** it is not checked against
   the public registry and is not refused for "not existing".
6. **Given** a public package shares its name with one of the developer's private packages,
   **When** an agent tries to install it from the public registry, **Then** the install is
   refused as a dependency-confusion attack.
7. **Given** an agent adds a dependency by editing the project's manifest file and then runs a
   plain "install everything" command, **When** that command runs, **Then** every newly declared
   dependency is checked as if it had been named explicitly.
8. **Given** an agent runs a command that executes a package directly without installing it
   (e.g. a run-once package runner), **When** the command is attempted, **Then** the package is
   checked exactly as an install would be.
9. **Given** an agent installs a popular package without naming a version, and its latest
   release is under 72 hours old with no other warning signs, **When** the install is attempted,
   **Then** it proceeds pinned to the newest release that is at least 72 hours old, and the agent
   is told which version it got and why (cooldown pin; owner decision 2026-10-13).
10. **Given** an agent explicitly requests a popular package's release that is under 72 hours
   old, **When** the install is attempted, **Then** it is held for investigation as in User
   Story 2.

---

### User Story 2 - Ambiguous packages are held and investigated automatically (Priority: P2)

An agent tries to install a package that is not clearly dangerous but is suspicious: it was
published days ago, or runs scripts on install, or has a lone maintainer and almost no users. Watchtower holds
the install and tells the agent to carry on with other work and retry later. A Sentinel agent is
dispatched to investigate. When it reaches a verdict, the next retry is allowed or refused at once,
and the developer and agent are both told the outcome.

**Why this priority**: This is what makes the fleet "police itself". It turns a crude allow/deny
filter into a judgement, and it is the central moment of the demo.

**Independent Test**: Ask the agent to install a recently published package with an install
script. Confirm it is held, that an investigation starts, that a verdict arrives, and that a retry
of the same command is then resolved instantly according to the verdict.

**Acceptance Scenarios**:

1. **Given** a package triggers only suspicious (not conclusive) signals, **When** an agent tries
   to install it, **Then** the install is held, the agent is told it is under investigation and
   to retry later, and an investigation begins immediately.
2. **Given** an investigation has concluded "allow", **When** the agent retries the same command,
   **Then** it proceeds immediately without a new investigation.
3. **Given** an investigation has concluded "block", **When** the agent retries, **Then** it is
   refused with the investigator's evidence.
4. **Given** an investigation does not conclude within the configured time limit, **When** the
   limit passes, **Then** the package is treated as refused, and the developer is told how to
   request a fresh investigation or override.
5. **Given** the package's own description or documentation contains text attempting to persuade
   the investigator that it is safe, **When** the package also has a conclusive danger signal,
   **Then** the investigator's verdict cannot overturn the refusal.
6. **Given** a verdict has been reached, **When** it is reached, **Then** the developer sees a
   notification and the agent is informed on its next turn without needing to retry first.

---

### User Story 3 - Live mission-control map of the agent fleet (Priority: P3)

A developer opens the Watchtower view and sees an animated map: the main agent at the centre,
helper agents launching and orbiting with trails, packages arriving from outside a defensive ring,
turning green and passing, bursting red when blocked, or freezing amber while the Sentinel flies
out to inspect them. A side panel lists recent events, the active fleet, and running totals. The
default look is a calm green radar; a louder retro "cracktro" look is available as a theme.

**Why this priority**: This is what makes the plugin remarkable and shareable, and it showcases
Fortitude Omnis engineering. It builds on the protection from Stories 1–2 but is not required for
the protection to work.

**Independent Test**: Open the view, start a task that launches helper agents and installs a mix
of clean, dangerous and suspicious packages, and confirm every event appears on the map with the
correct visual and that the theme can be switched.

**Acceptance Scenarios**:

1. **Given** the view is open, **When** a helper agent starts, works and finishes, **Then** a unit
   for it appears, moves and returns, identified by agent type, and the event log names what it
   did.
2. **Given** the view is open, **When** any package decision occurs, **Then** the package is shown
   arriving and resolving with the matching visual (pass / block / hold), each distinguished by a
   symbol and label as well as colour.
3. **Given** the view is open, **When** a Sentinel is dispatched, **Then** it is shown travelling
   to the held package, inspecting it, and returning when the verdict is reached.
4. **Given** the developer switches theme, **When** the switch is made, **Then** the map redraws in
   the new theme without losing any state.
5. **Given** the terminal is narrow, **When** the view is open, **Then** the side panels collapse
   into a compact ticker and the map remains legible.
6. **Given** the view is closed, **When** a package is blocked or held, **Then** the developer
   still receives a notification, and a compact status indicator shows running totals.
7. **Given** nothing is happening, **When** the view stays open, **Then** animation slows to an
   idle minimum, and it stops entirely when the view is hidden.
8. **Given** any figure is displayed (totals, spend, counts), **When** the developer asks for an
   explanation (legend or focus), **Then** the figure states what it is, why it matters and what
   to do about it, and any count that excludes items says what it excludes.

---

### User Story 4 - Scripted demo replay (Priority: P4)

Anyone (a prospective user, a conference audience, a launch video) can run a demo command that
replays a scripted slopsquatting attack on the map, end to end, with no real installs and no
network access needed.

**Why this priority**: It is the marketing asset and the conference demo. It depends on Story 3.

**Independent Test**: Run the demo command offline and confirm the full scripted sequence plays in
both themes with no real package activity.

**Acceptance Scenarios**:

1. **Given** the plugin is installed, **When** the demo command is run, **Then** a scripted
   sequence plays showing helper agents, clean installs, a blocked invented name, a blocked
   typosquat, and a held package resolved by a Sentinel.
2. **Given** the demo is running, **When** it plays, **Then** no real installation, investigation
   or network request takes place.
3. **Given** the same demo is run twice, **When** it plays, **Then** the sequence is identical
   each time.

---

### User Story 5 - Developer control: overrides, modes and allowlists (Priority: P5)

A developer needs to adjust Watchtower's behaviour: allow a package it refused, block one
permanently, switch to warn-only mode, switch to strict mode, list private package patterns, or
choose the investigator's model and time limit.

**Why this priority**: Essential for day-to-day trust and to recover from false positives, but the
defaults work without it.

**Independent Test**: Override a refused package, confirm it then installs; set warn-only mode and
confirm nothing is refused but everything is still reported; confirm the agent itself cannot grant
an override.

**Acceptance Scenarios**:

1. **Given** a package was refused, **When** the developer allows it (for the session or
   permanently), **Then** subsequent installs of it proceed, and the override is shown in the
   event log.
2. **Given** a package is otherwise clean, **When** the developer blocks it, **Then** subsequent
   installs are refused with "blocked by you" as the reason.
3. **Given** a coding agent attempts to grant itself an override, **When** it tries, **Then** the
   override is not applied without the developer's explicit confirmation.
4. **Given** warn-only mode is on, **When** a dangerous package is installed, **Then** it is not
   refused but is reported with full evidence and a notification.
5. **Given** strict mode is on, **When** Watchtower itself suffers an internal fault while checking
   an install, **Then** the install is refused rather than allowed.

---

### Edge Cases

- **Public registry unreachable**: the install itself would fail anyway; Watchtower allows it and
  marks it "unverified" rather than inventing a verdict.
- **Malware advisory database unreachable**: the package cannot be cleared, so it is held for
  investigation with that fact as evidence.
- **Rate-limited or failed weak signal**: recorded as unknown; it never counts as clean and never
  decides a verdict on its own.
- **Watchtower internal fault** (default mode): the install is allowed, and the developer gets a
  loud, persistent fault warning in the notification, the map and the status indicator.
- **Investigator unavailable, returns malformed output, or times out**: retried once where
  applicable, then treated as refused.
- **Unparseable commands** (output piped into a shell, nested shells, dynamic evaluation): allowed,
  but flagged on the map as unchecked.
- **Same package requested repeatedly**: decisions are reused, so repeat installs are instant and
  work offline for the reuse period.
- **Multiple packages in one command, mixed verdicts**: the command is refused if any package is
  refused or held, and the reason lists each package's outcome.
- **Rendering fault**: never affects any install decision.
- **Version-specific risk**: a long-established package whose requested version was published
  within the last 72 hours is treated as suspicious.

## Requirements *(mandatory)*

### Functional Requirements

**Interception**

- **FR-001**: Watchtower MUST inspect every shell command an agent (main or helper) attempts and
  identify npm-ecosystem and PyPI-ecosystem package installation or direct-execution commands,
  including package names, versions, extras and requirements files.
- **FR-002**: Watchtower MUST check newly declared manifest dependencies when a plain "install
  everything" command runs, by comparing the manifest against the lockfile.
- **FR-003**: Watchtower MUST allow, and flag as unchecked, commands whose package content it
  cannot determine.

**Scoring and decisions**

- **FR-004**: Watchtower MUST classify each package into exactly one of: pass, refuse, hold.
- **FR-005**: Watchtower MUST refuse packages that do not exist in their public registry, that
  carry a known-malware advisory, or that are a public package shadowing a configured private
  package name.
- **FR-006**: Watchtower MUST treat as suspicious: first publication under 7 days ago; requested
  version published under 72 hours ago; close similarity to a popular package name; install-time
  scripts or source-only distribution; very low adoption; a single maintainer combined with very
  low adoption; or no linked source repository.
- **FR-007**: Watchtower MUST escalate a close imitation of a popular package to refuse when
  combined with very low adoption.
- **FR-008**: Every decision MUST carry human-readable evidence, one line per contributing signal.
- **FR-009**: A signal that could not be obtained MUST be recorded as unknown and MUST NOT count
  as clean. If the malware signal is unknown, the package MUST NOT pass.
- **FR-010**: Refusals MUST include, where one exists, a well-known alternative package.
- **FR-011**: Decisions MUST be reused for the same package and version for a bounded period, so
  repeat requests resolve instantly and offline.
- **FR-012**: Watchtower MUST honour the project's private registry configuration for both
  ecosystems and a developer-supplied allowlist of private package patterns.

**Holding and investigation**

- **FR-035**: For a package on the bundled popular list, when the only reason to hold is that
  the latest release is under 72 hours old and no version was requested, Watchtower MUST rewrite
  the install to the newest release at least 72 hours old instead of holding it, and MUST tell
  the agent the pinned version and the reason. If no such release exists, or the version was
  requested explicitly, the package is held as normal.
- **FR-013**: A held install MUST be refused with an explanation telling the agent the package is
  under investigation and to retry the same command later.
- **FR-014**: Holding a package MUST dispatch an investigator agent that only Watchtower can
  dispatch, that cannot run commands or install anything, and that returns a structured verdict
  (allow or block, confidence, evidence).
- **FR-015**: The investigator's verdict MUST only resolve held packages and MUST NOT overturn a
  conclusive refusal.
- **FR-016**: Content fetched by the investigator MUST be treated as untrusted data.
- **FR-017**: An investigation that fails or exceeds the configured time limit MUST resolve to
  refuse, with instructions for re-investigation or override.
- **FR-018**: When a verdict is reached, the developer MUST be notified and the agent MUST be
  informed on its next turn.

**Visualisation**

- **FR-019**: Watchtower MUST provide an on-demand live view showing the agent fleet and all
  package decisions as described in User Story 3, opening automatically only where the terminal
  is wide enough to dock it beside the conversation.
- **FR-020**: The view MUST support two themes, "radar" (default) and "cracktro", switchable at any
  time without losing state.
- **FR-021**: The view MUST adapt to available width (full panels when wide, compact ticker when
  narrow).
- **FR-022**: When the view is closed, Watchtower MUST still show notifications for refusals and
  holds and a compact status indicator of running totals.
- **FR-023**: Every displayed figure MUST be explainable on the surface (what, why, what follows),
  and counts that exclude items MUST say what they exclude; figures that cannot be explained MUST
  be removed.
- **FR-024**: Decisions MUST be distinguishable without colour (symbol plus label).
- **FR-025**: Watchtower MUST offer a reduced-motion option, MUST drop to an idle animation rate
  when nothing is happening, and MUST stop animating when the view is hidden.
- **FR-026**: The visual model MUST be independent of the drawing surface, so that a desktop
  rendering can be added without changing interception, scoring, investigation or the visual
  model.

**Demo**

- **FR-027**: Watchtower MUST provide a demo command that replays a fixed scripted sequence,
  identical on every run, with no real installs, investigations or network requests.

**Control and resilience**

- **FR-028**: Developers MUST be able to allow or block a package for the session or permanently,
  and every override MUST appear in the event log.
- **FR-029**: Overrides MUST require the developer's explicit action; an agent MUST NOT be able to
  grant one.
- **FR-030**: Watchtower MUST offer warn-only mode (report, never refuse) and strict mode (refuse
  on internal fault).
- **FR-031**: In default mode, an internal Watchtower fault MUST allow the install and raise a
  persistent fault warning visible in notifications, the view and the status indicator.
- **FR-032**: A visualisation fault MUST NOT affect any install decision.
- **FR-033**: Developers MUST be able to configure the investigator's model and time limit.
- **FR-034**: Watchtower MUST install as a single plugin with no separate service, account or
  background program, and MUST NOT send the developer's install activity to any Fortitude
  Omnis service.

### Key Entities

- **Install Request**: an attempted command, the agent that issued it, and the packages it
  resolves to.
- **Package Check**: one package (ecosystem, name, version), its signals with evidence, its
  classification (pass / refuse / hold / unverified / unchecked), and when it was decided.
- **Signal**: one piece of evidence (existence, malware advisory, age, name similarity, install
  scripts, adoption, maintainers, repository link, dependency confusion) with a value of present,
  absent or unknown.
- **Investigation**: a held package, the Sentinel dispatched for it, its status (running,
  concluded, failed, timed out) and its verdict with confidence and evidence.
- **Override**: a developer-made allow or block for a package, its scope (session or permanent)
  and when it was made.
- **Fleet Agent**: the main agent or a helper agent, its type, its state and its recent actions.
- **Scene Event**: a timestamped fact (agent launched, acted, finished; package intercepted,
  scored; Sentinel dispatched; verdict issued; spend updated) that drives the view and can be
  recorded and replayed.
- **Theme**: a named visual style applied to the same scene.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of a curated adversarial set (invented names, known typosquats, known-malware
  packages, a dependency-confusion pair) is refused or held; none is allowed.
- **SC-002**: 0 refusals across the 500 most-downloaded packages of each ecosystem (benign set),
  so false positives do not erode trust.
- **SC-003**: For a package seen for the first time, a pass/refuse/hold decision is returned in
  under 5 seconds in at least 95% of cases on a normal connection; for a package decided before,
  in under 0.5 seconds.
- **SC-004**: In at least 90% of held cases in a test set, the Sentinel reaches a verdict within
  the default time limit.
- **SC-005**: In at least 80% of refusals in a scripted agent session, the agent proceeds with a
  correct alternative without the developer stepping in.
- **SC-006**: A new user goes from nothing to an active tripwire in 2 commands and under 2
  minutes.
- **SC-007**: With the view open and idle, Watchtower uses under 2% of one CPU core; with the view
  hidden, it uses none for animation.
- **SC-008**: The demo replays identically on 10 consecutive runs with no network access.
- **SC-009**: A desktop renderer can be added by introducing new rendering code only: confirmed by
  review that interception, scoring, investigation and the visual model need no change, and by
  tests of the visual model passing unchanged on both surfaces.
- **SC-010**: An agent cannot obtain an override in any tested attempt (0 successes).

## Assumptions

- Users run Claude Code at a version providing the plugin capabilities verified during design
  (interception and refusal of commands, helper-agent events, a pixel-capable terminal drawing
  surface, network access from plugins, plugin-defined helper agents). The minimum supported
  version will be pinned during planning (design open item O5).
- The terminal is the first and only drawing surface in v1. Desktop, editor and mobile renderings
  are designed for but out of scope.
- npm and PyPI are the only ecosystems in v1. NuGet, crates, Go modules and gems are out of
  scope.
- Watchtower is not a shell sandbox and does not run installs in isolation; arbitrary commands
  such as piping a download into a shell are out of scope (that is the role of Fortitude's Blast
  Radius project).
- Public data sources (the two public registries, a public malware/vulnerability advisory
  database, a public dependency-metadata service, download statistics) are available without
  accounts; their availability is not guaranteed, hence the unknown-signal rules.
- The investigator defaults to a low-cost model; its time limit default will be set from
  measurement during planning (design open item O4).
- How an override's human origin is established will be settled in planning (design open item
  O1); if no reliable signal exists, overrides require an interactive confirmation in the view.
- How the investigator's answer is collected (design open item O2) and how terminals without true
  colour display the map (design open item O3) are planning-phase verifications, not scope
  questions.
- The popular-package reference lists (top 5,000 per ecosystem) ship with the plugin and are
  refreshed with releases.
- A hosted Fortitude scoring service or OSPulse integration is a later opt-in and out of scope.
- The synthwave theme explored during design was rejected and is out of scope.
