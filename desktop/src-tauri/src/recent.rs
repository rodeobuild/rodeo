//! The recent-files list: <app config dir>/recent.json, newest first, at most 12 entries. The page
//! sees ids and names (ShellRecent); the paths stay here. A missing or unreadable list is empty.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::files::{self, IdArgs, NoArgs};
use crate::Shell;

/// How many files the list keeps.
pub const MAX_RECENT: usize = 12;

const FILE: &str = "recent.json";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub path: String,
    pub opened_at: u64,
}

/// A recent file as the page sees it (ShellRecent in shell.ts).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellRecent {
    id: String,
    name: String,
    size: u64,
    modified: u64,
    folder: String,
    opened_at: u64,
    exists: bool,
}

/// Newest first, each path once, at most MAX_RECENT.
pub fn normalise(mut list: Vec<RecentEntry>) -> Vec<RecentEntry> {
    list.sort_by(|a, b| b.opened_at.cmp(&a.opened_at));
    let mut seen = HashSet::new();
    list.retain(|entry| seen.insert(entry.path.clone()));
    list.truncate(MAX_RECENT);
    list
}

/// Moves (or inserts) `path` to the top, opened at `opened_at`.
pub fn add(list: &mut Vec<RecentEntry>, path: &str, opened_at: u64) {
    list.retain(|entry| entry.path != path);
    list.insert(
        0,
        RecentEntry {
            path: path.to_string(),
            opened_at,
        },
    );
    list.truncate(MAX_RECENT);
}

pub fn remove(list: &mut Vec<RecentEntry>, path: &str) {
    list.retain(|entry| entry.path != path);
}

/// The list in a recent.json; anything unreadable is empty.
pub fn parse(text: &str) -> Vec<RecentEntry> {
    serde_json::from_str::<Vec<RecentEntry>>(text)
        .map(normalise)
        .unwrap_or_default()
}

fn list_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(FILE))
        .map_err(|e| e.to_string())
}

fn load(app: &AppHandle) -> Vec<RecentEntry> {
    list_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|text| parse(&text))
        .unwrap_or_default()
}

fn store(app: &AppHandle, list: &[RecentEntry]) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
    files::write_atomic(&list_path(app)?, &json)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn recent_list(app: AppHandle, shell: State<'_, Shell>, args: NoArgs) -> Result<Vec<ShellRecent>, String> {
    let _ = args;
    let _guard = shell.recent_lock.lock().unwrap();
    Ok(load(&app)
        .into_iter()
        .map(|entry| {
            let path = files::plain(PathBuf::from(&entry.path));
            let id = shell.id_for(&path);
            match files::describe(&id, &path) {
                Ok(file) => ShellRecent {
                    id: file.id,
                    name: file.name,
                    size: file.size,
                    modified: file.modified,
                    folder: file.folder,
                    opened_at: entry.opened_at,
                    exists: true,
                },
                // no longer there: still listed, so the user can take it off the list
                Err(_) => ShellRecent {
                    id,
                    name: files::name_of(&path),
                    size: 0,
                    modified: 0,
                    folder: files::folder_of(&path),
                    opened_at: entry.opened_at,
                    exists: false,
                },
            }
        })
        .collect())
}

#[tauri::command]
pub async fn recent_add(app: AppHandle, shell: State<'_, Shell>, args: IdArgs) -> Result<(), String> {
    let path = files::plain(shell.path_of(&args.id)?);
    let key = path.to_string_lossy().into_owned();
    {
        let _guard = shell.recent_lock.lock().unwrap();
        let mut list = load(&app);
        add(&mut list, &key, now_ms());
        store(&app, &list)?;
    }
    #[cfg(target_os = "macos")]
    mac::note(&app, path);
    Ok(())
}

#[tauri::command]
pub async fn recent_remove(app: AppHandle, shell: State<'_, Shell>, args: IdArgs) -> Result<(), String> {
    let path = files::plain(shell.path_of(&args.id)?);
    let key = path.to_string_lossy().into_owned();
    let _guard = shell.recent_lock.lock().unwrap();
    let mut list = load(&app);
    remove(&mut list, &key);
    store(&app, &list)
}

#[tauri::command]
pub async fn recent_clear(app: AppHandle, shell: State<'_, Shell>, args: NoArgs) -> Result<(), String> {
    let _ = args;
    let _guard = shell.recent_lock.lock().unwrap();
    store(&app, &[])?;
    #[cfg(target_os = "macos")]
    mac::clear(&app);
    Ok(())
}

/// The Dock menu's recent documents, through NSDocumentController (the system's own list).
#[cfg(target_os = "macos")]
mod mac {
    use std::path::PathBuf;

    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSString, NSURL};
    use tauri::AppHandle;

    pub fn note(app: &AppHandle, path: PathBuf) {
        let _ = app.run_on_main_thread(move || unsafe {
            let text = NSString::from_str(&path.to_string_lossy());
            let url = NSURL::fileURLWithPath(&text);
            let controller: *mut AnyObject = msg_send![class!(NSDocumentController), sharedDocumentController];
            if let Some(controller) = controller.as_ref() {
                let _: () = msg_send![controller, noteNewRecentDocumentURL: &*url];
            }
        });
    }

    pub fn clear(app: &AppHandle) {
        let _ = app.run_on_main_thread(|| unsafe {
            let controller: *mut AnyObject = msg_send![class!(NSDocumentController), sharedDocumentController];
            if let Some(controller) = controller.as_ref() {
                let nothing: *const AnyObject = std::ptr::null();
                let _: () = msg_send![controller, clearRecentDocuments: nothing];
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{add, normalise, parse, remove, RecentEntry, MAX_RECENT};

    fn entry(path: &str, opened_at: u64) -> RecentEntry {
        RecentEntry {
            path: path.to_string(),
            opened_at,
        }
    }

    #[test]
    fn add_puts_the_file_on_top_once() {
        let mut list = vec![entry("/a", 1), entry("/b", 2)];
        add(&mut list, "/a", 9);
        assert_eq!(list, vec![entry("/a", 9), entry("/b", 2)]);
        add(&mut list, "/c", 10);
        assert_eq!(list.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), ["/c", "/a", "/b"]);
    }

    #[test]
    fn the_list_is_capped_at_twelve() {
        let mut list = Vec::new();
        for i in 0..20u64 {
            add(&mut list, &format!("/f{i}"), i);
        }
        assert_eq!(list.len(), MAX_RECENT);
        assert_eq!(list[0].path, "/f19");
        assert_eq!(list[MAX_RECENT - 1].path, "/f8");
    }

    #[test]
    fn remove_takes_one_path_off() {
        let mut list = vec![entry("/a", 2), entry("/b", 1)];
        remove(&mut list, "/a");
        assert_eq!(list, vec![entry("/b", 1)]);
    }

    #[test]
    fn a_stored_list_reads_newest_first_without_duplicates() {
        let read = normalise(vec![entry("/old", 1), entry("/new", 5), entry("/old", 3), entry("/mid", 4)]);
        let paths: Vec<(&str, u64)> = read.iter().map(|e| (e.path.as_str(), e.opened_at)).collect();
        assert_eq!(paths, vec![("/new", 5), ("/mid", 4), ("/old", 3)]);
    }

    #[test]
    fn a_missing_or_broken_list_is_empty() {
        assert!(parse("").is_empty());
        assert!(parse("not json").is_empty());
        assert!(parse("{\"a\":1}").is_empty());
        let many: Vec<RecentEntry> = (0..30u64).map(|i| entry(&format!("/f{i}"), i)).collect();
        let text = serde_json::to_string(&many).unwrap();
        assert_eq!(parse(&text).len(), MAX_RECENT);
    }
}
