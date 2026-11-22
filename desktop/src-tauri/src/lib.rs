//! Rodeo desktop shell: a native window that serves the web editor and answers the
//! commands defined in web/src/platform/shell.ts.

mod files;
mod kept;
mod recent;
mod window;
#[cfg(feature = "testhook")]
mod testhook;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, DragDropEvent, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const INIT_JS: &str = include_str!("init.js");

#[cfg(feature = "testhook")]
const TEST_JS: &str = "\nwindow.__rodeoTest = true;";
#[cfg(not(feature = "testhook"))]
const TEST_JS: &str = "";

/// A file as the page sees it (ShellFile in shell.ts). Never a path.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellFile {
    pub id: String,
    pub name: String,
    pub size: u64,
    /// mtime in ms since the epoch
    pub modified: u64,
    /// display only
    pub folder: String,
}

/// A write started by file_write_begin or kept_write_begin, not yet committed or dropped.
pub struct WriteInProgress {
    pub temp: PathBuf,
    pub target: PathBuf,
    pub file: std::fs::File,
    /// where the next appended chunk goes
    pub append_at: u64,
}

pub struct Shell {
    /// id -> path, for every id issued this run
    pub files: Mutex<HashMap<String, PathBuf>>,
    /// path -> id, so one path always has one id this run
    pub ids: Mutex<HashMap<PathBuf, String>>,
    /// files handed over before the page asked for them
    pub pending: Mutex<Vec<PathBuf>>,
    /// write token -> write
    pub writes: Mutex<HashMap<String, WriteInProgress>>,
    /// set by pending_take: from then on files are emitted, not queued
    pub ready: AtomicBool,
    /// set by window_close: the page has dealt with unsaved changes, the window closes
    pub closing: AtomicBool,
    /// when the page was last asked to close (or quit) and has not yet answered
    pub close_asked: Mutex<Option<Instant>>,
    /// the window's size and place was last saved
    pub window_saved: Mutex<Option<Instant>>,
    /// serialises the read-modify-write of the recent list
    pub recent_lock: Mutex<()>,
}

impl Shell {
    fn new() -> Self {
        Shell {
            files: Mutex::new(HashMap::new()),
            ids: Mutex::new(HashMap::new()),
            pending: Mutex::new(Vec::new()),
            writes: Mutex::new(HashMap::new()),
            ready: AtomicBool::new(false),
            closing: AtomicBool::new(false),
            close_asked: Mutex::new(None),
            window_saved: Mutex::new(None),
            recent_lock: Mutex::new(()),
        }
    }

    /// The id for a path, the same one for the whole run.
    pub fn id_for(&self, path: &Path) -> String {
        let key = files::plain(std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()));
        let mut ids = self.ids.lock().unwrap();
        if let Some(id) = ids.get(&key) {
            return id.clone();
        }
        let id = format!("{:032x}", rand::random::<u128>());
        ids.insert(key.clone(), id.clone());
        self.files.lock().unwrap().insert(id.clone(), key);
        id
    }

    /// The file at `path`, described from the key the shell keeps for it (never the raw input).
    pub fn describe_path(&self, path: &Path) -> Result<ShellFile, String> {
        let id = self.id_for(path);
        let key = self.path_of(&id)?;
        files::describe(&id, &key)
    }

    /// The path behind an id the shell issued.
    pub fn path_of(&self, id: &str) -> Result<PathBuf, String> {
        self.files
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| "unknown file".to_string())
    }
}

/// Only the editor's own pages and about:blank may load in the window.
fn allowed(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

/// Calls window.__rodeoShell._emit(event, payload) in the main window.
pub fn emit(app: &AppHandle, event: &str, payload: Value) {
    if let Some(window) = app.get_webview_window("main") {
        let js = format!("window.__rodeoShell && window.__rodeoShell._emit({}, {});", json!(event), payload);
        let _ = window.eval(js);
    }
}

/// Hands files to the page: emitted as "open" when the page is ready, queued until then.
pub fn deliver(app: &AppHandle, paths: Vec<PathBuf>) {
    let shell = app.state::<Shell>();
    let paths: Vec<PathBuf> = paths.into_iter().filter(|p| p.is_file()).collect();
    if paths.is_empty() {
        return;
    }
    {
        // checked under the same lock pending_take holds while it sets `ready`
        let mut pending = shell.pending.lock().unwrap();
        if !shell.ready.load(Ordering::SeqCst) {
            pending.extend(paths);
            return;
        }
    }
    let files: Vec<ShellFile> = paths.iter().filter_map(|p| shell.describe_path(p).ok()).collect();
    emit(app, "open", json!(files));
}

/// The one path a request to close or quit takes: the window's close button, ⌘Q from the menu,
/// and the app's own quit. When the page is ready and has not been asked in the last 4 s, it is
/// asked (the "close" event; it answers with window_close) and this returns true: the caller must
/// then prevent the close or exit. Otherwise (page not ready, or a second request) it returns false
/// and the caller lets it go.
pub fn request_quit(app: &AppHandle) -> bool {
    if window::ask_page_first(&app.state::<Shell>()) {
        emit(app, "close", json!(null));
        true
    } else {
        false
    }
}

/// The Quit item of the app menu, and the test bridge's /menu?id=quit: the same as closing the window.
pub fn menu_quit(app: &AppHandle) {
    if !request_quit(app) {
        app.exit(0);
    }
}

/// The Mac's menu bar: the app menu (with a custom Quit that asks about unsaved changes), Edit and
/// Window. No File, View or Help: the editor draws its own menu bar inside the window. There is no
/// ⌘W (the page uses it) and no Undo or Redo (the page handles ⌘Z itself).
#[cfg(target_os = "macos")]
fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let about = AboutMetadata {
        name: Some("Rodeo".to_string()),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        ..Default::default()
    };
    // a custom item, not the predefined quit, which would terminate without asking
    let quit = MenuItemBuilder::with_id("quit", "Quit Rodeo")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Rodeo")
        .about(Some(about))
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;
    // the text fields need these for ⌘X ⌘C ⌘V ⌘A
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()
}

pub fn run() {
    let builder = tauri::Builder::default();
    // macOS only: Windows and Linux get no menu (Tauri sets none there)
    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_menu);
    let builder = builder
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit" {
                menu_quit(app);
            }
        })
        // first, as its docs require: a second launch hands its files here and exits
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let base = PathBuf::from(cwd);
            let paths: Vec<PathBuf> = args
                .iter()
                .skip(1)
                .map(|arg| {
                    let path = PathBuf::from(arg);
                    if path.is_absolute() {
                        path
                    } else {
                        base.join(path)
                    }
                })
                .filter_map(|path| std::fs::canonicalize(path).ok())
                .collect();
            deliver(app, paths);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Shell::new())
        .setup(|app| {
            let handle = app.handle().clone();

            // temp files of writes that a crash cut short
            if let Ok(dir) = handle.path().app_data_dir() {
                kept::clean_leftovers(&dir.join("recovery"));
            }

            let mut init = String::from(INIT_JS);
            init.push_str(TEST_JS);

            // the window where it was last, when that still fits a connected screen
            let monitors = window::monitor_rects(&handle);
            let saved = window::load_saved(&handle).filter(|g| window::fits(g, &monitors));
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Rodeo")
                .min_inner_size(900.0, 600.0)
                .initialization_script(&init)
                .on_navigation(|url| allowed(url))
                // no windows of its own, and no downloads: the page saves through the shell's dialog
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_download(|_, _| false);
            let builder = match saved {
                Some(g) => builder
                    .inner_size(g.width, g.height)
                    .position(g.x, g.y)
                    .maximized(g.maximized),
                None => builder.inner_size(1440.0, 900.0).center(),
            };
            // A test run must draw whether or not its window is in front, so its numbers don't
            // depend on what else is on the screen. The app people use keeps the system's saving.
            #[cfg(feature = "testhook")]
            let builder = builder
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
                // above other windows, and never taking the keyboard: a covered WebKit view counts
                // as hidden and draws nothing, and a test must not type into someone's work
                .always_on_top(true)
                .focused(false);
            #[cfg(all(feature = "testhook", target_os = "macos"))]
            let builder = builder.visible(false);
            let window = builder.build()?;
            // WebKit also stops a covered window's frames altogether; a private switch turns that
            // off. Test builds only: nothing private is called in the app people use.
            #[cfg(all(feature = "testhook", target_os = "macos"))]
            {
                // The window is built hidden and shown only once the switch is set: WebKit reads
                // it when the view's visibility next changes, so setting it on a window already
                // covered would change nothing.
                let shown = window.clone();
                let _ = window.with_webview(move |webview| unsafe {
                    use objc2::{msg_send, runtime::AnyObject};
                    let view = webview.inner() as *mut AnyObject;
                    let _: () = msg_send![view, _setWindowOcclusionDetectionEnabled: false];
                    let _ = shown.show();
                });
            }

            // Native drag and drop stays on (the default): files dropped on the window open here.
            // The window's close asks the page first (see window.rs).
            let events_app = handle.clone();
            let events_window = window.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. } => {
                    window::remember(&events_app, &events_window, true);
                    if request_quit(&events_app) {
                        api.prevent_close();
                    }
                }
                WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                    window::remember(&events_app, &events_window, false);
                }
                WindowEvent::DragDrop(drag) => match drag {
                    DragDropEvent::Enter { .. } => emit(&events_app, "drag", json!(true)),
                    DragDropEvent::Leave => emit(&events_app, "drag", json!(false)),
                    DragDropEvent::Drop { paths, .. } => {
                        emit(&events_app, "drag", json!(false));
                        deliver(&events_app, paths.clone());
                    }
                    _ => {}
                },
                _ => {}
            });

            // Files named on the command line (a double click on Windows and Linux).
            let startup: Vec<PathBuf> = std::env::args_os()
                .skip(1)
                .filter_map(|arg| std::fs::canonicalize(PathBuf::from(arg)).ok())
                .collect();
            deliver(&handle, startup);

            #[cfg(feature = "testhook")]
            testhook::start(&handle);

            Ok(())
        });

    // The test bridge's one extra command exists only in a testhook build.
    #[cfg(not(feature = "testhook"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        files::shell_info,
        files::file_pick_open,
        files::file_pick_save,
        files::file_stat,
        files::file_read,
        files::file_write_begin,
        files::write_chunk,
        files::write_end,
        files::file_reveal,
        files::pending_take,
        recent::recent_list,
        recent::recent_add,
        recent::recent_remove,
        recent::recent_clear,
        kept::kept_list,
        kept::kept_read,
        kept::kept_write_begin,
        kept::kept_remove,
        window::window_state,
        window::window_close,
        files::open_external,
    ]);
    #[cfg(feature = "testhook")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        files::shell_info,
        files::file_pick_open,
        files::file_pick_save,
        files::file_stat,
        files::file_read,
        files::file_write_begin,
        files::write_chunk,
        files::write_end,
        files::file_reveal,
        files::pending_take,
        recent::recent_list,
        recent::recent_add,
        recent::recent_remove,
        recent::recent_clear,
        kept::kept_list,
        kept::kept_read,
        kept::kept_write_begin,
        kept::kept_remove,
        window::window_state,
        window::window_close,
        files::open_external,
        testhook::test_result,
    ]);

    builder
        .build(tauri::generate_context!())
        .expect("error while building the Rodeo desktop app")
        .run(|app, event| match event {
            // macOS: "open with" and double clicks in the file manager
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            RunEvent::Opened { urls } => {
                let paths: Vec<PathBuf> = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
                deliver(app, paths);
            }
            // Quit the system asks for (the Dock, a log-out, an AppleScript quit where the window
            // is closed for it). An exit with a code is our own (window_close, the test bridge's
            // /quit) and goes through.
            RunEvent::ExitRequested { code, api, .. } => {
                if code.is_none() && request_quit(app) {
                    api.prevent_exit();
                }
            }
            RunEvent::Exit => {
                // temp files of writes never ended are removed (best effort)
                let shell = app.state::<Shell>();
                let writes: Vec<WriteInProgress> = shell.writes.lock().unwrap().drain().map(|(_, w)| w).collect();
                for write in writes {
                    drop(write.file);
                    let _ = std::fs::remove_file(&write.temp);
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::allowed;
    use tauri::Url;

    fn allowed_url(text: &str) -> bool {
        allowed(&Url::parse(text).expect("a test address"))
    }

    #[test]
    fn only_the_editor_and_about_blank_may_load() {
        assert!(allowed_url("tauri://localhost/x"));
        assert!(allowed_url("https://tauri.localhost/x"));
        assert!(allowed_url("about:blank"));
        assert!(!allowed_url("https://example.com"));
        assert!(!allowed_url("tauri://evil"));
        assert!(!allowed_url("file:///etc/passwd"));
        assert!(!allowed_url("javascript:alert(1)"));
    }
}
