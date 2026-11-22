# Rodeo desktop

The whole editor as an app for macOS, Windows and Linux: one installer, no browser, no account, no server. With the network off it opens, edits and saves `.vwx` files, shows them in 3D, renders, runs scripts and imports every format the web editor does. Nothing in it checks a licence, phones home or can be switched off from outside; a newer version is offered, never required.

The app is the web build (`web/dist`) in a native window, plus a small shell that does what a page cannot: read and write files where they are, keep recovery copies on disk, list recent files, and take the files the system hands over.

## How it is put together

- `web/src/platform/shell.ts` is the whole page-to-shell API: 21 commands and 3 events, defined there and nowhere else. A browser has no shell, and the editor then works exactly as it always has.
- `web/src/app/shellFiles.ts` makes the shell's files look like the browser's own `File` and `FileSystemFileHandle`, so the editor's streaming open and save run unchanged on top of native reads by byte range and chunked writes.
- `desktop/src-tauri` is the shell, in Rust on Tauri 2. It implements those commands and nothing else. Another shell (or another backend of this one) is a second implementation of the same list; nothing in the editor changes.
- `desktop/scripts/stage.mjs` copies the web build into `desktop/app`, without source maps or the web-only pages, and adds Python's runtime (Pyodide) from `web/node_modules`, so Run Script never fetches it.

What the page can and cannot do:

- It never gets a path. A file is an id the shell made up when the user chose the file (a dialog, a drop, a double click, the recent list); the shell keeps the path.
- It can call the 21 commands and no others: no Tauri plug-in is open to it (dialogs are called from Rust), and `capabilities/default.json` lists exactly those commands.
- The window loads the app's own pages only. Links go to the system's browser (`https:` and `mailto:` only); new windows and downloads are refused.
- The content policy lets scripts come from the app alone. `'unsafe-eval'` is allowed because the STEP/IGES mesher's glue code builds functions from strings; nothing from the network can reach it.

## Building it

```bash
cd web && npm ci && npm run build
```

```bash
cd desktop && npm ci && npm run build
```

The installers land in `desktop/src-tauri/target/release/bundle/`. Rust (stable) and, on Linux, the WebKitGTK 4.1 development packages are needed; the release workflow (`.github/workflows/desktop-release.yml`) lists them. A release is a `desktop-v<version>` tag: the workflow builds all three systems and attaches the installers, their checksums and the plain web build (a folder any static file server can serve to any browser) to a GitHub Release. Builds are unsigned until the certificates in [SIGNING.md](SIGNING.md) exist.

## Testing it

There is no WebDriver for the Mac's WKWebView, which is what the app runs in on macOS. So a test build carries its own bridge, compiled in only with `--features testhook` (a normal build has none of it, and `strings` on the binary shows so): a loopback port that runs a script in the page and returns its result, hands the app a file as a double click does, and asks it to close or quit. Chrome and the Electron comparison are driven through Playwright, and all three run the same in-page scripts.

```bash
cd desktop && npm run build:test
```

```bash
node test/gates.mjs tauri --work /tmp/rodeo-gates --demo /tmp/rodeo-gates/demo.vwx
```

- `test/gates.mjs` runs the gates below against the real app. Give it drawings from a folder the app may read without asking: macOS asks before an app reads Desktop, Documents or Downloads, and a test cannot answer.
- `test/measure.mjs` measures one run: memory across all of the app's processes at each stage, time to open, frame rate.
- `test/mem.py` is how memory is counted: `phys_footprint` (Activity Monitor's Memory column) summed over every process macOS holds the app responsible for, which is what catches WebKit's helper processes.
- The test build has its own identifier (`build.rodeo.desktop.test`), so its settings and recovery copies are apart from the real app's. Its window floats above others and never takes the keyboard, because a covered WebKit view draws nothing.
- Unit checks: `cargo test` in `src-tauri`, and in `web/`: `npx tsx src/app/shellFiles.check.ts`, `src/app/recoveryShell.check.ts`, `src/platform/shell.check.ts`, `src/features/desktop/update.check.ts`.

Not automated: real keystrokes (⌘Q, ⌘S, ⌘Z, ⌘C/⌘V in a text field), the native Open and Save dialogs, a double click in the Finder, a drop on the window, and anything on Windows or Linux. Try those by hand before a release.

## Which shell, and why

Tauri was the first choice, to be used on every system where it passes every gate. Measured on a MacBook Pro (M3 Max, 36 GB, macOS 26.4, 120 Hz display), 22 November 2026: Tauri 2.12 (system WKWebView), Electron 45.4 (Chromium 156) and a Chrome 157 tab with a fresh profile, all on the same web build, window 1440 × 900 at 2×.

### Memory

Megabytes across all of the app's processes, lowest and highest of two runs each. "Dover Dam" is Vectorworks' public demo project (314 MB); the largest drawing is a private 1.6 GB file.

| | Chrome tab | Electron | Tauri |
|---|---|---|---|
| **Nothing open** (the start screen) | 442–462 | 248–255 | 250 |
| **Blank drawing**, idle | 495–528 | 383–386 | 236–237 |
| Blank, 3D shown | 745–749 | 584–614 | 403–404 |
| Blank, after orbiting | 916–939 | 744–831 | 513–528 |
| Blank, Path Traced (settled / peak) | 3024–3100 / 3592–3709 | 2894–2985 / 3542–3634 | 2964–3013 / 4655–4745 |
| **Dover Dam**, idle | 1570–1986 | 1342–1410 | 2262–2442 |
| Dover Dam, 3D shown | 3003–3086 | 2798–2954 | 3354–3664 |
| Dover Dam, after orbiting | 2840–3138 | 3419–4401 | 2779–3015 |
| Dover Dam, Realistic | 3647–4084 | 4122–5058 | 3640–3650 |
| Dover Dam, Path Traced (settled / peak) | 8870–9723 / 9558–10468 | 9805–11714 / 10040–11745 | 8909–9032 / 12703–12994 |
| **Largest drawing**, idle | 1356–1396 | 1208–1611 | 1007–1036 |
| Largest, 3D shown | 6662–6756 | 6286–6697 | 4173–4346 |
| Largest, after orbiting | 7576–7638 | 7601–8452 | 5502–7334 |
| Largest, Path Traced (settled / peak) | 10390–10725 / 10693–10865 | 9497–10861 / 10741–10905 | 8263–19036 / 9436–19173 |

| | Chrome tab | Electron | Tauri |
|---|---|---|---|
| Dover Dam: time to open | 1.7–2.3 s | 2.7–3.2 s | 1.3–1.5 s |
| Largest drawing: time to open | 6.3–6.4 s | 3.4–4.0 s | 2.4–2.5 s |
| Largest drawing: time to build 3D | 8.5–10.4 s | 8.8–10.7 s | 8.0–8.2 s |
| Blank: frames a second, orbiting | 119–120 | 119–120 | 60 |
| Dover Dam: frames a second, orbiting | 95 | 92–98 | 48–52 |
| Largest drawing: frames a second, orbiting | 73–76 | 63–72 | 38–48 |
| The app on disk | – | 253 MB of Electron, plus the editor's 178 MB | 64 MB with the editor inside (a 62.5 MB `.dmg`) |

What the numbers say, plainly:

- **With little open, Tauri is lighter:** about 150 MB less than Electron and 270 MB less than a Chrome tab with a blank drawing. At the start screen Tauri and Electron are level.
- **With a big drawing open, the shell stops mattering.** The drawing and its 3D model are gigabytes; the shell is a few hundred megabytes of that. Tauri is the lightest with the largest drawing open in 2D (about 1.0 GB against 1.4 in Chrome: the done-when bar) and in 3D, but the *heaviest* with Dover Dam open in 2D (2.3–2.4 GB against 1.3–2.0), and its Path Traced peaks are higher than Chromium's (12.7–13 GB on Dover Dam against 9.6–11.7; one run on the largest drawing peaked at 19 GB). WebKit keeps more memory around than Chromium does for the same page; it is not a smaller engine once it is busy.
- **Tauri opens big files fastest.** Reading by range through the shell beats Chrome's own file slicing: 2.4 s against 6.3 s for the largest drawing.
- **WebKit draws at 60 frames a second at most.** On this 120 Hz display Chromium ran Dover Dam at 92–98 and WebKit at 48–52, with some frames missed. On a 60 Hz display the two are level. Turning the resolution down did not change WebKit's rate, so it is the cap and frame pacing, not the GPU.
- **The real lever on memory is the editor, not the shell:** path tracing costs 3 GB on a blank drawing in every shell, and the largest drawing's 3D model costs 5 GB in every shell.

### The gates on macOS (Tauri)

| Gate | Result |
|---|---|
| 3D is correct, at a comparable frame rate | The picture matches Chromium's (same triangles, same colours sampled). The rate is capped at 60 a second: 48–52 against 92–98 on a 120 Hz display, level on a 60 Hz one. **Passed with that caveat.** |
| Realistic and Path Traced render, WebGL and WebGPU | Passed: Realistic draws; Path Traced reached "34 of 256 samples" on WebGL and "20 of 256 samples · WebGPU" within the check's time. |
| The largest sample opens | Passed, in 2.2–2.5 s, and draws in 3D. In the first five runs WebKit's web process died once while orbiting it in 3D (at about 5.9 GB; cause not found, not seen again in four runs). |
| Pyodide runs | Passed: Run Script starts Python from the app's own copy in about a second and draws objects. WebKit has no JSPI, so scripted dialogs that wait for an answer (`StrDialog`, `YNDialog`) raise, as they do in Safari. |
| The wasm importers run | Passed: a DWG (own reader), a Revit project (rvt-rs, 387k objects) and a SolidWorks part (cadmpeg, then the STEP mesher). |
| Workers, and cross-origin isolation where needed | Passed: module and blob workers run. Nothing in the editor needs cross-origin isolation or shared memory. |
| Save writes back to the same file | Passed: open, change, Save, start again, and the change is in the file; no temporary file left beside it. |
| Nothing is reached on the network | Passed: over the whole run the app's processes opened no socket to another machine and the page asked for no outside address. (The one thing the app asks the network for by itself is whether a newer version is out, 20 seconds after starting, at most weekly, and only when Help › Check for Updates Automatically is on; the check turns that off.) |

Kept on disk after a kill (`kill -9` with unsaved changes), the recovery copy is offered at the next start and opens.

### The decision

- **macOS: Tauri.** It passes every gate, with the frame-rate caveat above. If 60 frames a second on a 120 Hz display is not good enough, the choice is a bundled Chromium; see the next section.
- **Windows: Tauri.** Its webview there is WebView2, which is Chromium, the engine Rodeo is tested in, so the gates are expected to pass. **Not run:** there was no Windows machine. The installer carries the WebView2 installer inside it (`offlineInstaller`), so it installs with the network off.
- **Linux: Tauri for now, unproven.** Its webview there is WebKitGTK, which has no WebGPU and a slower WebGL than WKWebView. **Not run:** there was no Linux machine. CI builds a `.deb` and an AppImage; they are not to be called supported until `test/gates.mjs` passes on a Linux desktop with a GPU.

### If Tauri fails a gate on a system: what was checked

- **Tauri's CEF backend** (Chromium inside the same shell): only in the Tauri 3.0 alpha (`tauri-runtime-cef` 3.0.0-alpha.7, 6 November 2026). Tauri's own guide says "Keep production apps on 2.x" and that the runtime's API "may still change". Open Linux bugs on that date include keyboard input lost at start or after switching windows, an idle main thread at 100% CPU, WebGPU limited to a software renderer, and AppImage bundling failing. Not stable enough for an installer that has to last. Worth another look when Tauri 3 is stable, since it would keep one shell everywhere.
- **Electrobun with bundled CEF:** 2.0.7 is its stable line (20 November 2026), with macOS 14+, Windows 11+ and Ubuntu 24.04+ as its supported systems and a Bun main process. It still needs WebKitGTK's packages on Linux, and its compatibility notes were not reachable. Too young to stake ten years on.
- **Deno's `deno desktop`** with `--backend cef`: marked experimental in Deno 2.9.
- **Electron:** the fallback that works today. It measured the same as Chrome above, minus about 100–200 MB. The shell API has one implementation to write for it (the comparison spike that was measured here loads the same web build from a locked-down `app://` scheme with no Node in the page).

### Ten years

The bar is that an installer kept today still opens, edits and saves a drawing in ten years with the network off. What that rests on, and what guards it:

- The app holds everything it runs: the editor, the twelve wasm readers, Python, the denoiser's weights, the materials. Nothing is fetched, checked or licensed at run time.
- On macOS and Windows the engine is the system's (WKWebView, WebView2). It will be a newer engine in ten years. The web platform keeps old pages working far more reliably than operating systems keep old binaries working, but it is a moving part this app does not control.
- So every release also carries the web build as a plain folder (`Rodeo-<version>-web.zip`). Unzipped and served by any static file server, it is the same editor in whatever browser exists then, with nothing to install.
- And the shell is replaceable: a different engine is a second implementation of 21 commands.

## Known limits

- ⌘Q and the window's close button ask about unsaved changes. Dock › Quit, logging out and a forced quit do not: the copy autosave kept is offered at the next start (by default at most 5 minutes old).
- Online features that run on rodeo.build (sign-in, cloud drawings, editing together, agents, AI and cloud renders, the gallery, voice transcription) are not in the app: their rows are hidden, or greyed with the reason. They need the server to accept the app's sign-in, which it does not yet. Site Context and Sun Study's place search talk to OpenStreetMap directly and work when online.
- Print saves a PDF to print from; there is no print dialog.
- The first time the app reopens a recent file from Desktop, Documents or Downloads, macOS asks whether it may. An unsigned build is asked again after each update.
- Unsigned builds: see [SIGNING.md](SIGNING.md).
