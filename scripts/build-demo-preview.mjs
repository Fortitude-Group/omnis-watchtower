// Bundles scripts/demo-preview/main.ts into a single self-contained page, dist/demo-preview.html.
// Open it with ?theme=radar or ?theme=cracktro (and &loop=0 to stop after one run) to watch or
// record /watchtower demo exactly as the plugin's renderer draws it.
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'

const result = await build({
  entryPoints: ['scripts/demo-preview/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  write: false,
  minify: true,
})
const js = result.outputFiles[0].text
mkdirSync('dist', { recursive: true })
writeFileSync('dist/demo-preview.html', `<!doctype html>
<html><head><meta charset="utf-8"><title>Omnis Watchtower demo</title>
<style>html,body{margin:0;background:#000;display:grid;place-items:center;min-height:100vh}canvas{image-rendering:pixelated;width:min(98vw,163vh);height:auto}</style>
</head><body><canvas id="term"></canvas><script>${js.replace(/<\/script/g, '<\\/script')}</script></body></html>
`)
console.log(`dist/demo-preview.html (${Math.round(js.length / 1024)} KB of script)`)
