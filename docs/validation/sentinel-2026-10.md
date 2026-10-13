# Sentinel, live runs (T076, SC-004), 2026-10-13 to 2026-10-14

Each run is a real headless Claude Code session (`claude -p --plugin-dir src/plugin --model haiku`)
asking for a genuinely fresh release explicitly (`npm install <name>@<version>`, version under
72 hours old), which Watchtower holds. A real Haiku Sentinel investigates, and the agent retries
every 30 seconds. Packages came from the live sweep's list of fresh releases of popular packages.

SC-004: at least 90% of holds reach a verdict within the default limit (180 s).

## Run 1: 20 packages

| Outcome | Count |
|---|---|
| Verdict: allowed | 15 |
| Verdict: refused | 1 (google-logging-utils) |
| Investigation failed | 4 (execa, rollup, google-auth-library, typescript-eslint) |

All four failures had one cause: Haiku wrote an evidence line over 200 characters, and the verdict
parser rejected the whole verdict as malformed. **Fix:** the parser now trims over-long and surplus
evidence lines instead of rejecting a sound verdict (`core/sentinel/verdict.ts`).

## Run 2: the 4 failures again, with the parser fix

All 4 reached a verdict (2 allowed, 2 refused) in 46 to 75 s.

**SC-004 result: 20 of 20 investigations reached a verdict, in 43 to 116 s (median about 50 s),
all inside the 180 s default.** The default stays at 180 s.

## Accuracy: false refusals

Across runs 1 and 2 the Sentinel refused 3 releases that are almost certainly genuine (execa
10.1.1, google-auth-library 11.3.0, google-logging-utils 2.1.0). Each refusal's own top evidence
line was positive, for example "maintainers are sindresorhus and ehmicky, matching the
long-established package". The cause was the prompt: "Use block when unsure" made Haiku block
anything new.

**Fix:** the prompt now has an explicit rubric (`core/sentinel/prompt.ts`). Being new is the reason
for the investigation, not grounds to block. Block on a concrete red flag (a publisher change, new
or remote-fetching install scripts, obfuscation, credential harvesting, a missing or mismatched
repository, a look-alike name, an advisory) or when the publisher can't be established at all.
Allow when the release is continuous with the package's history.

## Run 3: the rubric, 5 packages

| Package | Before | After |
|---|---|---|
| execa 10.1.1 | refused | allowed (44 s) |
| google-auth-library 11.3.0 | refused | allowed (76 s) |
| google-logging-utils 2.1.0 | refused | allowed (49 s) |
| postcss 8.5.30 (control) | allowed | allowed (55 s) |
| marked 18.1.1 (control) | allowed | allowed (62 s) |

## What this does and doesn't show

- It shows the full loop works live: hold, a real Sentinel, a verdict, and a retry applying it.
- The samples are small (20, then 4, then 5).
- **The Sentinel's ability to spot a malicious release has not been tested live**, because there
  is no safe way to install real malware for the test. Hard signals (malware advisories, invented
  names, typosquats with low adoption, dependency confusion, command-line registries) never depend
  on the Sentinel: they refuse before any investigation, and a Sentinel "allow" can't clear them
  (FR-015). The Sentinel only decides packages that are suspicious but not conclusively bad.
- In these runs the main agent saw the Sentinel's own report as a background-task notification and
  correctly ignored it as a subagent's claim rather than a decision. Only the Watchtower verdict
  gates the install.
