//! The main window: its title and "edited" dot, the close handshake with the page, and the window's
//! size and place, kept in <app config dir>/window.json (logical points).

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::files::{self, NoArgs};
use crate::Shell;

const FILE: &str = "window.json";
/// The size and place are saved at most this often while the window moves or resizes.
const SAVE_EVERY: Duration = Duration::from_secs(1);
/// After the page is asked to close, a second request inside this time closes anyway.
pub const ASK_WINDOW: Duration = Duration::from_secs(4);

/// A window's size and place, in logical points: x and y are the outer top left.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Geometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
}

/// A monitor's work area (or any rectangle), in logical points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Whether the saved window lies wholly on one of the monitors. A window saved on a screen that is
/// no longer connected (or is now smaller) does not fit, and opens at the default size instead.
pub fn fits(saved: &Geometry, monitors: &[Rect]) -> bool {
    let values = [saved.x, saved.y, saved.width, saved.height];
    if values.iter().any(|v| !v.is_finite()) || saved.width < 1.0 || saved.height < 1.0 {
        return false;
    }
    monitors.iter().any(|m| {
        saved.x >= m.x
            && saved.y >= m.y
            && saved.x + saved.width <= m.x + m.width
            && saved.y + saved.height <= m.y + m.height
    })
}

/// The window title: "<title> — Rodeo", or just "Rodeo" when the title is that or empty.
pub fn display_title(title: &str) -> String {
    if title == "Rodeo" || title.trim().is_empty() {
        "Rodeo".to_string()
    } else {
        format!("{title} — Rodeo")
    }
}

/// Whether a close (or quit) request asks the page first. Only when the page is ready, the
/// window is not already closing on the page's word, and no earlier ask is less than 4 s old.
pub fn should_ask(ready: bool, closing: bool, last_ask: Option<Instant>, now: Instant) -> bool {
    if closing || !ready {
        return false;
    }
    match last_ask {
        Some(asked) => now.saturating_duration_since(asked) >= ASK_WINDOW,
        None => true,
    }
}

/// Decides one close or quit request: true when the page must be asked (and the ask is recorded).
pub fn ask_page_first(shell: &Shell) -> bool {
    let now = Instant::now();
    let mut asked = shell.close_asked.lock().unwrap();
    let ready = shell.ready.load(std::sync::atomic::Ordering::SeqCst);
    let closing = shell.closing.load(std::sync::atomic::Ordering::SeqCst);
    if should_ask(ready, closing, *asked, now) {
        *asked = Some(now);
        true
    } else {
        false
    }
}

fn file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE))
}

/// The saved geometry, if there is one and it reads.
pub fn load_saved(app: &AppHandle) -> Option<Geometry> {
    let text = fs::read_to_string(file_path(app)?).ok()?;
    serde_json::from_str::<Geometry>(&text).ok()
}

/// Every connected monitor's work area in logical points.
pub fn monitor_rects(app: &AppHandle) -> Vec<Rect> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let scale = m.scale_factor();
            let at = m.position();
            let size = m.size();
            Rect {
                x: at.x as f64 / scale,
                y: at.y as f64 / scale,
                width: size.width as f64 / scale,
                height: size.height as f64 / scale,
            }
        })
        .collect()
}

fn current(window: &WebviewWindow) -> Option<Geometry> {
    // a minimised window reports a place off the screen: keep the last good one
    if window.is_minimized().unwrap_or(true) {
        return None;
    }
    let scale = window.scale_factor().ok()?;
    let at = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(Geometry {
        x: at.x as f64 / scale,
        y: at.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        maximized: window.is_maximized().unwrap_or(false),
    })
}

/// Saves the window's size and place: at most once a second unless `force`. Failures are ignored:
/// the window simply opens at its default size next time.
pub fn remember(app: &AppHandle, window: &WebviewWindow, force: bool) {
    let shell = app.state::<Shell>();
    {
        let mut last = shell.window_saved.lock().unwrap();
        let now = Instant::now();
        if !force && last.is_some_and(|t| now.duration_since(t) < SAVE_EVERY) {
            return;
        }
        *last = Some(now);
    }
    let Some(geometry) = current(window) else {
        return;
    };
    if let (Some(path), Ok(json)) = (file_path(app), serde_json::to_vec_pretty(&geometry)) {
        let _ = files::write_atomic(&path, &json);
    }
}

#[tauri::command]
pub async fn window_state(app: AppHandle, args: WindowStateArgs) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    window.set_title(&display_title(&args.title)).map_err(|e| e.to_string())?;
    set_edited(&window, args.edited);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowStateArgs {
    title: String,
    edited: bool,
}

/// The Mac's dot in the close button for unsaved changes. Other systems have no such mark.
#[cfg(target_os = "macos")]
fn set_edited(window: &WebviewWindow, edited: bool) {
    let inner = window.clone();
    let _ = window.run_on_main_thread(move || {
        if let Ok(ptr) = inner.ns_window() {
            if ptr.is_null() {
                return;
            }
            unsafe {
                use objc2::msg_send;
                use objc2::runtime::AnyObject;
                let ns = &*(ptr as *mut AnyObject);
                let _: () = msg_send![ns, setDocumentEdited: edited];
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn set_edited(_window: &WebviewWindow, _edited: bool) {}

/// Closes the window for real. The page calls this once it has dealt with unsaved changes; the
/// app then ends with it.
#[tauri::command]
pub async fn window_close(app: AppHandle, shell: State<'_, Shell>, args: NoArgs) -> Result<(), String> {
    let _ = args;
    shell.closing.store(true, std::sync::atomic::Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        remember(&app, &window, true);
        window.destroy().map_err(|e| e.to_string())?;
    }
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{display_title, fits, should_ask, Geometry, Rect};

    fn screen(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect { x, y, width, height }
    }

    fn at(x: f64, y: f64, width: f64, height: f64) -> Geometry {
        Geometry {
            x,
            y,
            width,
            height,
            maximized: false,
        }
    }

    #[test]
    fn a_window_that_fits_a_monitor_is_kept() {
        let main = [screen(0.0, 0.0, 1512.0, 982.0)];
        assert!(fits(&at(40.0, 80.0, 1440.0, 900.0), &main));
        assert!(fits(&at(72.0, 40.0, 1440.0, 900.0), &main));
    }

    #[test]
    fn a_window_off_every_monitor_or_too_big_for_one_is_not_kept() {
        let laptop = [screen(0.0, 0.0, 1512.0, 982.0)];
        // saved on a second screen that is no longer there
        assert!(!fits(&at(2000.0, 100.0, 1440.0, 900.0), &laptop));
        // hangs off the edge
        assert!(!fits(&at(1000.0, 100.0, 1440.0, 900.0), &laptop));
        // bigger than the screen it is on
        assert!(!fits(&at(0.0, 0.0, 2560.0, 1440.0), &laptop));
        // a second screen to the left of the first (negative coordinates) counts
        let two = [screen(0.0, 0.0, 1512.0, 982.0), screen(-1920.0, 0.0, 1920.0, 1080.0)];
        assert!(fits(&at(-1800.0, 50.0, 1200.0, 800.0), &two));
        assert!(!fits(&at(-1800.0, 50.0, 1200.0, 800.0), &laptop));
    }

    #[test]
    fn a_broken_geometry_is_not_kept() {
        let main = [screen(0.0, 0.0, 1512.0, 982.0)];
        assert!(!fits(&at(f64::NAN, 0.0, 800.0, 600.0), &main));
        assert!(!fits(&at(0.0, 0.0, 0.0, 600.0), &main));
        assert!(!fits(&at(0.0, 0.0, 800.0, 600.0), &[]));
    }

    #[test]
    fn the_title_carries_the_app_name_unless_it_is_the_name() {
        assert_eq!(display_title("Rodeo"), "Rodeo");
        assert_eq!(display_title(""), "Rodeo");
        assert_eq!(display_title("   "), "Rodeo");
        assert_eq!(display_title("Kitchen plan.vwx"), "Kitchen plan.vwx — Rodeo");
    }

    #[test]
    fn a_close_asks_the_page_once_then_closes_within_four_seconds() {
        let t0 = Instant::now();
        // the page is not ready: let the close happen
        assert!(!should_ask(false, false, None, t0));
        // the window is closing on the page's word
        assert!(!should_ask(true, true, None, t0));
        // first request: ask
        assert!(should_ask(true, false, None, t0));
        // a second request 1 s later, the page not having answered: close
        assert!(!should_ask(true, false, Some(t0), t0 + Duration::from_secs(1)));
        // 5 s later, an unanswered ask is old: ask again
        assert!(should_ask(true, false, Some(t0), t0 + Duration::from_secs(5)));
    }
}
