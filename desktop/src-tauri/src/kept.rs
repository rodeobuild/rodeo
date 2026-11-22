//! Kept copies, for crash recovery: plain files in <app data dir>/recovery/, nothing else. A name
//! is checked in one place (valid_name) before it becomes a path, so no name reaches outside that
//! folder. The temp files of writes that were cut short start with a dot, so they are never
//! listed, and are removed at startup.

use std::fs::{self, File};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};

use crate::files::{self, io_err, modified_ms, NoArgs};
use crate::Shell;

/// The longest kept name (the contract: 1 to 120 characters).
const MAX_NAME: usize = 120;

/// The one rule for a kept name: 1 to 120 characters of [A-Za-z0-9._-], starting with a letter
/// or digit. That excludes "", ".x", "..", any path separator and any NUL.
pub fn valid_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() || bytes.len() > MAX_NAME || !bytes[0].is_ascii_alphanumeric() {
        return false;
    }
    bytes
        .iter()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
}

/// The path of a kept name in `dir`; "bad name" for anything the rule refuses.
pub fn kept_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err("bad name".to_string());
    }
    Ok(dir.join(name))
}

fn recovery_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("recovery"))
        .map_err(|e| e.to_string())
}

fn ensure_recovery(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = recovery_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Removes the temp files of writes a crash left behind: ".<name>.rodeo-<hex>.tmp".
pub fn clean_leftovers(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') && name.contains(".rodeo-") && name.ends_with(".tmp") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[derive(Deserialize)]
pub struct NameArgs {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptReadArgs {
    name: String,
    start: u64,
    end: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptInfo {
    name: String,
    size: u64,
    modified: u64,
}

#[tauri::command]
pub async fn kept_list(app: AppHandle, args: NoArgs) -> Result<Vec<KeptInfo>, String> {
    let _ = args;
    let Ok(dir) = recovery_dir(&app) else {
        return Ok(Vec::new());
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !valid_name(&name) {
            continue;
        }
        // regular files only: a link in the folder is not followed
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.is_file() {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        out.push(KeptInfo {
            name,
            size: meta.len(),
            modified: modified_ms(&meta),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub async fn kept_read(app: AppHandle, args: KeptReadArgs) -> Result<Response, String> {
    let dir = recovery_dir(&app)?;
    let path = kept_path(&dir, &args.name)?;
    let mut file = File::open(&path).map_err(io_err)?;
    let total = file.metadata().map_err(io_err)?.len();
    let bytes = files::read_range(&mut file, total, args.start, args.end)?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn kept_write_begin(
    app: AppHandle,
    shell: State<'_, Shell>,
    args: NameArgs,
) -> Result<files::WriteToken, String> {
    let dir = ensure_recovery(&app)?;
    let target = kept_path(&dir, &args.name)?;
    files::begin_write(&shell, target)
}

#[tauri::command]
pub async fn kept_remove(app: AppHandle, args: NameArgs) -> Result<(), String> {
    let dir = recovery_dir(&app)?;
    let path = kept_path(&dir, &args.name)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::valid_name;

    #[test]
    fn kept_names() {
        assert!(valid_name("3f2b8c1e-9d4a-4b7e-8f0a-1c2d3e4f5a6b.vwx"));
        assert!(valid_name("3f2b8c1e-9d4a-4b7e-8f0a-1c2d3e4f5a6b.json"));
        assert!(valid_name("a"));
        assert!(valid_name(&"a".repeat(120)));
        assert!(!valid_name(""));
        assert!(!valid_name(".x"));
        assert!(!valid_name(".x.rodeo-1.tmp"));
        assert!(!valid_name(".."));
        assert!(!valid_name("."));
        assert!(!valid_name("a/b"));
        assert!(!valid_name("a\\b"));
        assert!(!valid_name("/etc/passwd"));
        assert!(!valid_name(&"a".repeat(121)));
        assert!(!valid_name("a b"));
        assert!(!valid_name("a\0b"));
        assert!(!valid_name("café.vwx"));
    }
}
