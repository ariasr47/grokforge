# Frontend visual evidence — capture index

Feature: `tool-run-trust-surface`
Fixture: deterministic 45-row sequence in `apps/shell/scripts/tool-activity-fake-agent.mjs` and `apps/shell/scripts/e2e-tool-activity.mjs`
Host: Microsoft Windows NT 10.0.26200.0
Forge: 0.3.2, DEV channel
Observer: frontend execution lane plus conductor WebView2 observation

## Serve and observation method

- Chromium: Vite UI with the in-page WebSocket/API fixture, driven through the real composer and `beginStreamRun` by `npm run test:e2e-tool-activity --workspace @grokforge/shell`.
- Packaged WebView2: current host/agent bundles staged with the dev-channel generators, deterministic ACP fixture temporarily staged only for observation, and `npm run desktop:dev` launched against isolated dev data. Cell 6 additionally used `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--force-device-scale-factor=2`. The launcher requested port 8788 and the observed isolated host selected port 8800.
- The real generated ACP agent was restored after observation; neither staged agent copy retains a deterministic-fixture marker.

| Cell | Surface | Theme / density | Viewport / zoom | Motion | Result |
|---|---|---|---|---|---|
| 1 | Chromium browser | Aeon / comfortable | 1280×800 / 100% | Full | PASS — 45 rows, 1 group, 2 top-level chips, open focusable bounded body |
| 2 | Chromium browser | Aeon / compact | 800×700 / 200% | Calm | PASS — 45 rows, 1 group, 2 top-level chips, open focusable bounded body |
| 3 | Chromium browser | Light / comfortable | 800×700 / 100% | Calm | PASS — 45 rows, 1 group, 2 top-level chips, open focusable bounded body |
| 4 | Chromium browser | Light / compact | 1280×800 / 200% | Full | PASS — 45 rows, 1 group, 2 top-level chips, open focusable bounded body |
| 5 | packaged WebView2 | Aeon / comfortable | 803×631 / 100% | Full | PASS — all 45 rows present; a native thumb drag advanced rows 0–7 to 1–8 while header/composer stayed stable; permission and diff settled into two top-level chips |
| 6 | packaged WebView2 | Light / compact | 803×631 / forced 200% | Calm | PASS — all topbar controls wrap on-screen; a native thumb drag reached rows 43–44 while header/composer stayed stable; both top-level chips remain visible and usable |

The desktop controller exposed the actual 803×631 development window but no resize API, so the WebView viewport differs from the planned 1280×800 and 800×700 cells. The pairwise theme, density, motion, and 100%/200% zoom risks were still observed in the packaged WebView, and the four exact planned viewport/zoom pairs passed in Chromium.

## Runtime results

- Every Chromium matrix cell emitted exactly `45 tool rows | 1 group | 0 duplicates | PASS`.
- The packaged fixture exposed all 45 stable row identities, one group per run, the truthful `1 failed · 1 not run` summary, and the supplied failure/reason detail.
- Inner native-scrollbar dragging changed the visible tool rows without moving the group header or composer. Light/compact/Calm at forced 200% kept the channel banner, mode controls, DEV/auth/engine chips, command palette, Settings, tool rail, composer, and footer visible and operable.
- Appearance was restored to Aeon / comfortable / Full after the matrix.

## Scroll-ownership amendment (2026-08-15)

- Direct geometry RED reproduced before the amendment: at 100% the sticky group header rendered above
  the transcript viewport (`header.y=108.34`, `transcript.y=207.50`); at 200% the same ownership
  path pushed the header above the closest transcript after activity mutation.
- GREEN: the first tool sight now reveals the header in the closest transcript and disables outer
  stick-to-bottom for later activity mutations. The body is the sole bounded row scroll owner and
  preserves the first visible row identity/pixel offset when scrolled away, while following end only
  when already at end. Direct checks use `header.y >= transcript.y` and `header.bottom <= transcript.bottom`.
- Runner result after the amendment: `45 tool rows | 1 group | 0 duplicates | PASS` (cell 1), with
  explicit collapse/reopen, same-row detail fill, dock routing, disconnect freeze, zero-tool run, and
  stale-tail isolation checks still green.
- Final Chromium runner cells 1–4 (including both 200% cells) each returned
  `45 tool rows | 1 group | 0 duplicates | PASS`; the full shell suite completed at 164/164 tests,
  0 failures, 0 skipped.

## QA completion pass (2026-08-15)

- RED: the runner did not exercise Y/N/S and A/R payloads, did not retain a live row through
  disconnect, and did not compare focus, transcript, bounded-body, header, and composer anchors
  across authoritative detail fill. A real cell-4 scrollbar drag also failed because the forced-zoom
  scrollbar was clipped outside the configured viewport.
- GREEN: the runner now reuses the original permission/diff identities and awaits concrete
  `allow_once`, `deny`, `allow_session`, `accept`, and `reject` responses without extra chips; holds
  `fixture-0` running through done, transport disconnect, reconnect, and known/unseen events while
  asserting the offline copy and frozen row set; and compares active focus plus both scroll anchors
  and header/composer rectangles across same-row detail fill. It also asserts Tab exits the body and
  mode-switch/discard stale-tail isolation before the next run. Cells 1–4 plus a repeat cell 4 all
  pass on Chromium.
- Packaged re-observation first reproduced the runtime clipping: the tool body grew wider than its
  group, its scrollbar rail extended below the transcript, and forced-200% pushed the command-palette
  and Settings controls beyond the window. The fixes bind the group to the transcript block size,
  give the body `min-inline-size: 0`, preserve a stable full-width scrollbar gutter, and let the
  topbar wrap. The final 100% and forced-200% screenshots show the rail, composer, footer, chips, and
  every topbar control on-screen; a real thumb drag moved rows in both cells.
- A later clean matrix run reproduced a fractional top-edge RED after the keyboard/wheel journey:
  `header.y=172.171875`, `transcript.y=172.5`. The header now carries a 1px scroll margin so
  integer scroll positions cannot leave a subpixel-clipped edge. Cell 1 then passed three consecutive
  runs, and cells 1–4 passed again on the final bytes.
- The same clean run exposed a runner race where the Y/A assertion could execute before the mocked
  decision responses completed. The runner now awaits the concrete `/api/permission` and `/api/diff`
  responses instead of using time delay or retry-until-green; cell 3 passed twice consecutively afterward.
- The packaged fixture initially left permission/edit decisions pending because it emitted requests
  but did not acknowledge `permission/respond` or `edit/respond`. The fixture now returns deterministic
  RPC acknowledgements; the packaged permission and diff docks both settled and rendered exactly two
  top-level chips. Production resources were regenerated afterward, both staged agent copies were
  hash-aligned, and neither contains `Deterministic ACP fixture` or `fixture-44`.
- Final automation after the packaged fixes: cell 4 passed eight consecutive scrollbar runs, then
  cells `1,2,3,4,4` each returned `45 tool rows | 1 group | 0 duplicates | PASS` with the new topbar
  containment oracle enabled.

## Defect found and fixed

Initial WebView observation exposed a 1px collapsed activity line although the accessibility tree contained all 45 rows. The transcript is a column flex container, so the overflowing dynamic activity rail was allowed to shrink. A failing structural assertion first reproduced the absent shrink guard (`'' !== '0'`); `.tool-activity` and `.activity-chip` now use `flex: 0 0 auto`, with `data-flex-shrink="0"` covered by the focused test. Focused, full frontend, build, and all four Chromium matrix cells passed after the correction, followed by the successful WebView2 observations above.

## Release-preflight amendment (2026-08-15)

- RED: repeated native-scrollbar verification exposed an intermittent compositor race when the runner snapped the body from a mid-scroll position to zero and immediately grabbed the old thumb location. At CSS zoom 200%, direct geometry also showed the grid child at 1006px inside a 678px activity group, placing the vertical scrollbar beyond the visible group edge.
- GREEN: the runner now waits for pending input to settle, positions the body at a measured mid-track value, verifies that value held, then measures and drags the live native thumb once. The activity grid now uses `grid-template-columns: minmax(0, 1fr)`, and the runner directly rejects any body wider than its group.
- Fresh release evidence: cell 1 native drag passed 20/20 stress runs, cell 2 passed 10/10 at 200%, and the final cells `1,2,3,4,4` each returned `45 tool rows | 1 group | 0 duplicates | PASS`.
