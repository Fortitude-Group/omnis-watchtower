// Copies the newest Claude Code plugin-API declarations into src/plugin/.claude-plugin/types/
// (git-ignored). An interactive `claude --plugin-dir src/plugin` session writes the same files;
// this script covers headless machines and CI. Run: node scripts/sync-engine-types.mjs
import { readdirSync, existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const roots = [process.env.CLAUDE_TYPES_DIR, join(tmpdir(), 'claude', 'bundled-skills'), 'c:/Temp/claude/bundled-skills'].filter(Boolean);
const found = [];
for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const ver of readdirSync(root)) for (const hash of readdirSync(join(root, ver))) {
    const file = join(root, ver, hash, 'plugin-authoring', 'types', 'claude-code.d.ts');
    if (existsSync(file)) found.push({ ver, file });
  }
}
if (!found.length) { console.error('No engine types found. Run `claude` once and load the plugin-authoring skill, or set CLAUDE_TYPES_DIR.'); process.exit(1); }
const cmp = (a, b) => a.split('.').map(Number).reduce((r, n, i) => r || n - (b.split('.').map(Number)[i] ?? 0), 0);
found.sort((a, b) => cmp(b.ver, a.ver));
const dest = 'src/plugin/.claude-plugin/types/claude-code';
mkdirSync(dest, { recursive: true });
copyFileSync(found[0].file, join(dest, 'index.d.ts'));
console.log(`engine types ${readFileSync(found[0].file, 'utf8').split('\n')[0]} -> ${dest}/index.d.ts`);
