# Changelog

## Unreleased

### Tripwire

- PyPI typosquat detection now checks against the top 5,000 PyPI names instead of a stopgap list
  of 100. The list comes from Hugo van Kemenade's top-pypi-packages (CC BY 4.0, credited in the
  README), now that the licence is confirmed. npm already used 5,000.
- `scripts/build-popular-lists.mjs` builds the PyPI list too, and takes `npm` or `pypi` to build
  just one.
- A rate-limited npm download count (HTTP 429) is now remembered for a minute instead of being
  asked for again on every check. While npm was throttling us, repeat checks took over half a
  second. They're back to about a millisecond.

## 0.1.0 – 2026-10-13

First release.

### Tripwire

- Checks every npm and PyPI install or run-once command any agent runs through Bash: npm, pnpm,
  yarn, bun, npx and the dlx runners, pip, uv, poetry and pipx, including requirements files and
  dependencies added to a manifest but not yet in the lockfile.
- Refuses names that don't exist, known malware (OSV, matched to the version that would actually
  install), typosquats of popular packages, and dependency confusion against your private
  registries. The agent gets the evidence and a suggested alternative.
- Pins brand-new releases of popular packages to the newest release at least 72 hours old, and
  tells the agent.
- Holds suspicious packages and sends a hidden, read-only Sentinel subagent to investigate. The
  verdict is applied when the agent retries. Timeouts and unreadable answers refuse.
- Human-only overrides (`/watchtower allow`, `block`, `overrides`, `recheck`), plus warn-only
  and strict modes.

### Mission control

- Live map in a terminal pane, radar and cracktro themes, adaptive frame rate (30 fps while
  anything moves, 4 when idle, none when hidden).
- Status line with session totals and token spend, toasts for refusals, holds and verdicts, and
  `/watchtower legend` explaining every figure.
- `/watchtower demo`: a 45-second scripted attack, offline.

### Known limits

- Terminal only. The desktop app shows a note instead of the map.
- The PyPI popular-names list is a 100-name placeholder until its dataset licence is settled.
  Download counts cover most of what it's for in the meantime.
