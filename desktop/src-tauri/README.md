# Rodeo desktop shell (Tauri 2)

The native window around the web editor. The commands the page may call are defined in
`web/src/platform/shell.ts`; `build.rs` lists them, and `capabilities/default.json` grants exactly
those. Nothing else (no core, dialog or fs permission) is callable from the page.

## Windows installer

`tauri.conf.json` sets `bundle.windows.webviewInstallMode` to `offlineInstaller`: the installer
carries the WebView2 runtime, so it installs with the network off. A JSON file cannot hold a
comment, so the reason lives here. The cost is a larger installer.

## Test builds

`--features testhook` adds a loopback test bridge (only when `RODEO_TEST_PORT` is set) and the
`test_result` command. Its capability lives in `capabilities-test/`, which only a testhook build
reads (see `build.rs`). A normal build has neither.

## Known limits

⌘Q (the Rodeo menu's Quit) and the window's red button ask about unsaved changes first. Dock › Quit, Log Out and a forced quit do not ask; the copy autosave kept is offered at the next start.

## Checks

From `desktop/src-tauri`: `cargo check`, `cargo check --features testhook`, and the unit tests
with `cargo test --lib`.
