# Quickstart & Validation Guide: Omnis Watchtower

Runnable scenarios that prove the feature end to end. Contracts are in
[contracts/user-surface.md](contracts/user-surface.md), [contracts/renderer.md](contracts/renderer.md)
and [contracts/sentinel-verdict.schema.json](contracts/sentinel-verdict.schema.json). Entities and
tier rules are in [data-model.md](data-model.md).

## 1. Prerequisites

- Claude Code **≥ 2.1.296** (`claude --version`)
- Node **24.x** and npm (dev tooling only. The plugin itself has no runtime dependencies)
- A terminal **≥ 144 columns** for the auto-docked pane (any width works via `/watchtower`)
- For pixel-perfect checks: Windows Terminal, plus kitty or Ghostty

## 2. Build and automated gates

```powershell
npm ci                                   # dev tooling: typescript, vitest (pinned)
npm run typecheck                        # tsc over src/plugin, against engine-written types
npm test                                 # vitest: core parser, scoring, scene, renderer goldens, perf budget
claude plugin validate src/plugin        # engine's own load-time checks: must report nothing refused
claude plugin test src/plugin            # mod tests against the real engine (gating, Sentinel, UI, faults)
```

Expected: 0 type errors, all tests green, validate clean.

## 3. Load it in a session

```powershell
claude --plugin-dir src/plugin
```

Expected: the status line shows `🛡 0 ✔ · 0 ◆ · 0 ✖`. At ≥ 144 columns the pane docks
automatically in the radar theme.

## 4. Scenario checks (live, real registries)

Ask Claude to run each command. Watch both the reply and the map.

| # | Ask Claude to run | Expected | Proves |
|---|---|---|---|
| 4.1 | `npm install react-dom-utilz` | Refused: "does not exist… probably invented"; red burst on the map | US1-1, SC-001 |
| 4.2 | `pip install reqeusts` | Refused: typosquat of `requests`; suggests `requests` | US1-3 |
| 4.3 | `npm install chalk` | Allowed, green pass, no refusal | US1-4, SC-002 |
| 4.4 | `npx cowsay hi` | Checked like an install (pass) | US1-8 |
| 4.5 | Edit `package.json` to add `react-dom-utilz`, then run `npm install` | Refused via lockfile diff | US1-7 |
| 4.6 | Install a package published within the last 7 days that has a `postinstall` script (pick one live from the npm "recently updated" feed) | `WATCHTOWER HELD`; Sentinel flies out; verdict toast; retry resolves instantly | US2-1..3, SC-004 |
| 4.7 | Set `sentinelTimeoutSec` to 60 and disconnect the network during 4.6 | Refused on timeout with recheck/override instructions | US2-4 |
| 4.8 | Ask Claude to run `/watchtower allow npm:react-dom-utilz` itself | Override refused (not human-originated) | US5-3, SC-010 |
| 4.9 | Type `/watchtower allow npm:react-dom-utilz` yourself, then repeat 4.1 | Allowed; override shown in the log | US5-1 |
| 4.10 | Configure an `.npmrc` scope `@acme:registry=…`, install `@acme/anything` | Not checked publicly; passed and labelled private | US1-5 |

## 5. Visual checks

1. Run a task that launches 3+ subagents: units launch, orbit with trails, return (US3-1).
2. `/watchtower theme cracktro`, then back to `radar`: state kept (US3-4).
3. Narrow the terminal below 100 body columns: the panels collapse to a ticker (US3-5).
4. Close the pane and repeat 4.1: a toast plus a status-line count still appear (US3-6).
5. Leave idle for 60 s with Task Manager open: CPU under 2 % of one core (SC-007).
6. `/watchtower legend`: every figure has what, why and what follows (US3-8).

## 6. Demo and terminal coverage

```text
/watchtower demo
```

Expected: the scripted sequence (helpers launch → clean installs → invented name blocked →
typosquat blocked → held package cleared by the Sentinel → a second held package blocked). It
is identical on repeat runs, works with networking disabled, and plays in both themes (US4,
SC-008).

Run it in Windows Terminal, in kitty or Ghostty, and in one **256-colour** terminal (for example
`TERM=xterm-256color` without true colour) to check research R4: the verdicts must stay
distinguishable.

## 7. Fault handling

With a dev build flag that makes the gate hook throw:
- default mode → the install is allowed, a `⚠ FAULT` banner, toast and status-line marker appear
  (US5 edge, FR-031).
- `strict: true` → the install is refused (US5-5).
