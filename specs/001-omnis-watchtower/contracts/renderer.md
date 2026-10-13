# Contract: Renderer and Theme (FR-026, SC-009)

Public within the plugin, and the extension point for the desktop renderer. A semver-tracked
contract (Principle II): changing these signatures is a MAJOR change for renderer authors.

```ts
/** Size a renderer draws into, in its own units (cells for terminal). */
interface Viewport { columns: number; rows: number }

/** Implemented once per drawing surface. Consumes Scene, never mutates it. */
interface Renderer<Out> {
  readonly surface: 'terminal' | 'desktop' | 'vscode' | 'mobile';
  mount(viewport: Viewport, theme: Theme): void;
  resize(viewport: Viewport): void;
  setTheme(theme: Theme): void;
  /** Pure with respect to (scene, tMs, theme, viewport): same inputs, same output. */
  frame(scene: Scene, tMs: number): Out;
}

/** Terminal output: exactly what Raster.cells needs. */
interface RasterFrame { columns: number; rows: number; cells: string /* base64 u32 triplets */ }

/** A theme is palette tokens plus ordered passes. Surface-neutral tokens; surface-specific passes. */
interface Theme {
  id: 'radar' | 'cracktro';
  tokens: {
    background: Rgb; ring: Rgb | 'rainbow'; ship: Rgb; pkgInbound: Rgb;
    pass: Rgb; hold: Rgb; refuse: Rgb; sentinel: Rgb;
    text: Rgb; textDim: Rgb; heading: Rgb; titleBg: Rgb;
  };
  /** Terminal passes draw into the framebuffer in order. A desktop theme supplies SVG passes. */
  terminalPasses: FramebufferPass[];
  footer: 'status' | 'scrolltext';
  persistence: number;       // 0 = clear each frame; 0.86 = radar phosphor afterglow
}

type Rgb = readonly [number, number, number];
type FramebufferPass = (fb: Framebuffer, scene: Scene, tMs: number, tokens: Theme['tokens']) => void;
```

Guarantees:
- `frame` output is deterministic for identical inputs (golden-tested per theme).
- Verdicts are always drawn with glyph + label in the text overlay, never colour alone (FR-024).
- Text overlay cells replace pixel cells. Their background is the dimmed mean of the two pixels
  they cover.
- Adding a renderer requires **no change** to `core/scene`, `core/tripwire`, `adapters/` or the
  hook wiring. Only a new `Renderer` implementation and a surface switch in the pane hook.
