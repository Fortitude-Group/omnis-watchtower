# Quickstart run (T077), 2026-10-14

Against [quickstart.md](../../specs/001-omnis-watchtower/quickstart.md). Each line says who checked
it and how.

| Section | Result | How |
|---|---|---|
| §2 Build and automated gates | Pass | `npm run check`: typecheck, 699 unit tests, `claude plugin validate`, 58 engine tests |
| §3 Load it in a session | Pass | Owner, `claude --plugin-dir src/plugin` on Windows, Claude Code 2.1.296 |
| §4.1 invented name refused | Pass | Live headless session (`claude -p --plugin-dir`) |
| §4.3 popular package passes, fresh release pinned | Pass | Live headless session (`npm i zod` ran as `zod@4.6.5`) |
| §4.6 hold, Sentinel, verdict, retry | Pass | 20 live headless sessions, see [sentinel-2026-10.md](sentinel-2026-10.md) |
| §4.2, 4.4, 4.5, 4.7 to 4.10 | Pass | Engine and adapter tests against recorded registry data |
| §5.1 to 5.4 visuals: map, themes, narrow layout, toasts | Pass | Owner, hands-on: `/watchtower`, `/watchtower legend`, `/watchtower theme cracktro` ("it looks ok") |
| Closing the pane | Fixed, then pass | Owner found the close mark did nothing on the main screen (the terminal keeps the mouse there). Fixed in 535c922: Esc at an empty prompt, `/watchtower` again, or `/watchtower close`. Owner confirmed both work |
| §5.5 idle CPU under 2 % | Partly | Engine tests confirm 4 fps idle and no frames when hidden. Task Manager reading not taken |
| §5.6 legend | Pass | Owner, `/watchtower legend` |
| §6 demo | Pass | Owner ran the pane, and the demo GIFs were rendered frame by frame from the plugin's renderer |
| §6 kitty or Ghostty, and a 256-colour terminal | Not done | Only Windows Terminal was used. Research R4 (256-colour rendering) remains unverified |
| §7 fault handling | Pass | Engine tests (fault injection, default and strict) |
