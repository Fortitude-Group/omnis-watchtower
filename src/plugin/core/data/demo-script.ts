// The scripted slopsquatting demo (US4): about 45 s, no real installs, no network. Three helpers
// launch; three clean installs pass; an invented name and a typosquat are refused; two packages are
// held, one cleared by the Sentinel and one refused for an obfuscated postinstall; helpers return.

import type { PackageRef } from '../../types'
import { key } from '../model'
import type { ScriptEntry } from '../scene/replay'

const npm = (name: string, version: string): PackageRef => ({ ecosystem: 'npm', name, version })
const pypi = (name: string, version: string): PackageRef => ({ ecosystem: 'pypi', name, version })

const chalk = npm('chalk', '5.3.0')
const express = npm('express', '4.21.1')
const numpy = pypi('numpy', '2.1.2')
const invented = npm('react-dom-utilz', '1.0.3')
const typo = pypi('reqeusts', '2.31.0')
const leftPadx = npm('left-padx', '1.1.0')
const authKit = pypi('fastapi-auth-kit', '0.4.1')

const s = (sec: number): number => Math.round(sec * 1000)

const usage = (atSec: number, agentId: string, input: number, output: number, estCostUsd: number): ScriptEntry => ({
  atMs: s(atSec),
  event: { type: 'UsageUpdated', agentId, model: 'claude-sonnet-4-6', tokens: { input, output, cacheRead: input * 3, cacheWrite: 0 }, estCostUsd },
})

export const DEMO_SEED = 0x0a11ce

export const DEMO_SCRIPT: readonly ScriptEntry[] = [
  { atMs: s(0.5), event: { type: 'AgentLaunched', agentId: 'demo-coder', agentType: 'coder' } },
  { atMs: s(2.0), event: { type: 'AgentLaunched', agentId: 'demo-researcher', agentType: 'researcher' } },
  { atMs: s(3.0), event: { type: 'AgentActed', agentId: 'demo-coder', summary: 'Edit src/cli.ts' } },
  { atMs: s(3.5), event: { type: 'AgentLaunched', agentId: 'demo-tester', agentType: 'tester' } },

  { atMs: s(5.0), event: { type: 'PackageIntercepted', requestId: 'demo-1', agentId: 'demo-coder', ref: chalk } },
  { atMs: s(5.8), event: { type: 'PackageScored', requestId: 'demo-1', ref: chalk, tier: 'pass', evidence: ['popular, 9 years old'] } },
  { atMs: s(6.5), event: { type: 'AgentActed', agentId: 'demo-researcher', summary: 'Read pyproject.toml' } },
  usage(7.0, 'demo-coder', 4200, 900, 0.03),

  { atMs: s(8.0), event: { type: 'PackageIntercepted', requestId: 'demo-2', agentId: 'demo-coder', ref: express } },
  { atMs: s(8.8), event: { type: 'PackageScored', requestId: 'demo-2', ref: express, tier: 'pass', evidence: ['popular, 14 years old'] } },
  { atMs: s(9.5), event: { type: 'AgentActed', agentId: 'demo-tester', summary: 'Bash npm test' } },

  { atMs: s(10.5), event: { type: 'PackageIntercepted', requestId: 'demo-3', agentId: 'demo-researcher', ref: numpy } },
  { atMs: s(11.3), event: { type: 'PackageScored', requestId: 'demo-3', ref: numpy, tier: 'pass', evidence: ['popular, 19 years old'] } },
  usage(12.0, 'demo-researcher', 6100, 1300, 0.04),

  { atMs: s(13.5), event: { type: 'PackageIntercepted', requestId: 'demo-4', agentId: 'demo-coder', ref: invented } },
  { atMs: s(14.3), event: { type: 'PackageScored', requestId: 'demo-4', ref: invented, tier: 'refuse', evidence: ['invented name: not on the registry'] } },
  { atMs: s(15.5), event: { type: 'AgentActed', agentId: 'demo-coder', summary: 'Edit src/render.tsx' } },

  { atMs: s(17.0), event: { type: 'PackageIntercepted', requestId: 'demo-5', agentId: 'demo-tester', ref: typo } },
  { atMs: s(17.8), event: { type: 'PackageScored', requestId: 'demo-5', ref: typo, tier: 'refuse', evidence: ['typosquat of requests'] } },
  usage(19.0, 'demo-tester', 3800, 700, 0.02),

  { atMs: s(20.5), event: { type: 'PackageIntercepted', requestId: 'demo-6', agentId: 'demo-coder', ref: leftPadx } },
  { atMs: s(21.3), event: { type: 'PackageScored', requestId: 'demo-6', ref: leftPadx, tier: 'hold', evidence: ['published 2 days ago'] } },
  { atMs: s(22.5), event: { type: 'SentinelDispatched', key: key(leftPadx), sentinelId: 'demo-sentinel-1' } },
  { atMs: s(24.0), event: { type: 'AgentActed', agentId: 'demo-researcher', summary: 'WebFetch docs.python.org' } },
  { atMs: s(26.5), event: { type: 'VerdictIssued', key: key(leftPadx), tier: 'pass', evidence: ['no install scripts, code matches its description'] } },

  { atMs: s(28.5), event: { type: 'PackageIntercepted', requestId: 'demo-7', agentId: 'demo-researcher', ref: authKit } },
  { atMs: s(29.3), event: { type: 'PackageScored', requestId: 'demo-7', ref: authKit, tier: 'hold', evidence: ['one maintainer, first release'] } },
  { atMs: s(30.5), event: { type: 'SentinelDispatched', key: key(authKit), sentinelId: 'demo-sentinel-2' } },
  { atMs: s(31.5), event: { type: 'AgentActed', agentId: 'demo-tester', summary: 'Bash pytest -q' } },
  usage(32.5, 'demo-coder', 5200, 1100, 0.04),
  { atMs: s(34.5), event: { type: 'VerdictIssued', key: key(authKit), tier: 'refuse', evidence: ['obfuscated postinstall'] } },

  { atMs: s(36.5), event: { type: 'AgentActed', agentId: 'demo-coder', summary: 'Edit README.md' } },
  { atMs: s(37.5), event: { type: 'AgentFinished', agentId: 'demo-tester' } },
  { atMs: s(39.0), event: { type: 'AgentFinished', agentId: 'demo-researcher' } },
  usage(40.0, 'demo-coder', 1500, 400, 0.01),
  { atMs: s(41.5), event: { type: 'AgentFinished', agentId: 'demo-coder' } },
]
