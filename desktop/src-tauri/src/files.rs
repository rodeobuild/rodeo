//! The commands of web/src/platform/shell.ts for the files the user chose: dialogs, reading and
//! writing them, showing them in the file manager, and opening links. Every command is async, so
//! blocking file I/O and dialogs run off the main thread. Errors are plain strings the page
//! matches ("gone", "changed").

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::Ordering;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::{Shell, ShellFile, WriteInProgress};

/// The largest single read the page may ask for; it reads in chunks.
const MAX_READ: u64 = 64 * 1024 * 1024;

/// The longest link open_external takes.
const MAX_LINK: usize = 2000;

#[derive(Deserialize)]
pub struct NoArgs {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickOpenArgs {
    filters: Vec<Filter>,
    multiple: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickSaveArgs {
    suggested_name: String,
    filters: Vec<Filter>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdArgs {
    pub id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadArgs {
    id: String,
    start: u64,
    end: u64,
    modified: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkArgs {
    write: String,
    at: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndArgs {
    write: String,
    commit: bool,
}

#[derive(Deserialize)]
pub struct UrlArgs {
    url: String,
}

#[derive(Serialize)]
pub struct ShellInfo {
    shell: &'static str,
    version: &'static str,
    os: &'static str,
    arch: &'static str,
}

#[derive(Serialize)]
pub struct WriteToken {
    write: String,
}

#[derive(Serialize)]
pub struct Stamp {
    size: u64,
    modified: u64,
}

pub fn name_of(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

pub fn folder_of(path: &Path) -> String {
    path.parent().map(|p| plain(p.to_path_buf()).display().to_string()).unwrap_or_default()
}

/// The pure string part of `plain`: a Windows verbatim path (`\\?\C:\x` or `\\?\UNC\s\h\x`)
/// written as the ordinary path it names. Any other text is returned unchanged.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn unverbatim_str(text: &str) -> String {
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        let bytes = rest.as_bytes();
        let drive = bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\';
        if drive {
            return rest.to_string();
        }
    }
    text.to_string()
}

/// A canonicalised path without Windows' verbatim prefix (`\\?\`), so the page never shows one.
/// On other systems the path is returned unchanged.
pub fn plain(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy().into_owned();
        let plain = unverbatim_str(&text);
        if plain != text {
            return PathBuf::from(plain);
        }
    }
    path
}

#[cfg(test)]
mod plain_tests {
    use super::unverbatim_str;

    #[test]
    fn verbatim_prefixes_are_removed_from_the_text() {
        assert_eq!(unverbatim_str(r"\\?\C:\Users\cal\a.txt"), r"C:\Users\cal\a.txt");
        assert_eq!(unverbatim_str(r"\\?\UNC\server\share\a.txt"), r"\\server\share\a.txt");
        // not a drive path: left as it is
        assert_eq!(unverbatim_str(r"\\?\Volume{1234}\a"), r"\\?\Volume{1234}\a");
        assert_eq!(unverbatim_str(r"C:\plain\a.txt"), r"C:\plain\a.txt");
        assert_eq!(unverbatim_str(r"\\server\share\a"), r"\\server\share\a");
        assert_eq!(unverbatim_str("/Users/someone/a.txt"), "/Users/someone/a.txt");
    }
}

pub fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Maps a missing file to "gone" and anything else to its message.
pub fn io_err(e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        "gone".to_string()
    } else {
        e.to_string()
    }
}

fn to_path(picked: FilePath) -> Result<PathBuf, String> {
    picked.into_path().map_err(|e| e.to_string())
}

/// The file as it is now; "gone" when it is no longer there.
pub fn describe(id: &str, path: &Path) -> Result<ShellFile, String> {
    let meta = fs::metadata(path).map_err(io_err)?;
    Ok(ShellFile {
        id: id.to_string(),
        name: name_of(path),
        size: meta.len(),
        modified: modified_ms(&meta),
        folder: folder_of(path),
    })
}

/// Bytes start..end of a file `total` bytes long, clamped to it; at most MAX_READ.
pub fn read_range(file: &mut File, total: u64, start: u64, end: u64) -> Result<Vec<u8>, String> {
    let end = end.min(total);
    if start >= end {
        return Ok(Vec::new());
    }
    let len = end - start;
    if len > MAX_READ {
        return Err(format!("a read of {len} bytes is over the 64 MB limit"));
    }
    file.seek(SeekFrom::Start(start)).map_err(io_err)?;
    let mut buf = vec![0u8; len as usize];
    file.read_exact(&mut buf).map_err(io_err)?;
    Ok(buf)
}

/// Starts a write to `target`: a temp file beside it, which write_end commits by renaming it over
/// `target` (the target is untouched until then). Shared by the user's files and the kept copies.
pub fn begin_write(shell: &Shell, target: PathBuf) -> Result<WriteToken, String> {
    let dir = target.parent().ok_or_else(|| "the file has no folder".to_string())?.to_path_buf();
    let temp = dir.join(format!(".{}.rodeo-{:08x}.tmp", name_of(&target), rand::random::<u32>()));
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(io_err)?;
    let token = format!("{:032x}", rand::random::<u128>());
    shell.writes.lock().unwrap().insert(
        token.clone(),
        WriteInProgress {
            temp,
            target,
            file,
            append_at: 0,
        },
    );
    Ok(WriteToken { write: token })
}

/// Writes a small file whole: a temp file beside it, synced, then renamed over it. Used for the
/// app's own small files (recent list, window geometry); a crash leaves the old one.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| "the file has no folder".to_string())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let temp = dir.join(format!(".{}.rodeo-{:08x}.tmp", name_of(path), rand::random::<u32>()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    let written = file.write_all(bytes).and_then(|_| file.sync_all());
    drop(file);
    if let Err(e) = written.and_then(|_| fs::rename(&temp, path)) {
        let _ = fs::remove_file(&temp);
        return Err(e.to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn shell_info(args: NoArgs) -> Result<ShellInfo, String> {
    let _ = args;
    let os = match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        other => return Err(format!("unsupported operating system: {other}")),
    };
    Ok(ShellInfo {
        shell: "tauri",
        version: env!("CARGO_PKG_VERSION"),
        os,
        arch: std::env::consts::ARCH,
    })
}

#[tauri::command]
pub async fn file_pick_open(
    app: AppHandle,
    shell: State<'_, Shell>,
    args: PickOpenArgs,
) -> Result<Vec<ShellFile>, String> {
    let mut dialog = app.dialog().file();
    for filter in &args.filters {
        let exts: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.name, &exts);
    }
    let picked: Vec<FilePath> = if args.multiple {
        dialog.blocking_pick_files().unwrap_or_default()
    } else {
        dialog.blocking_pick_file().into_iter().collect()
    };
    let mut out = Vec::new();
    for item in picked {
        let path = to_path(item)?;
        if let Ok(file) = shell.describe_path(&path) {
            out.push(file);
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn file_pick_save(
    app: AppHandle,
    shell: State<'_, Shell>,
    args: PickSaveArgs,
) -> Result<Option<ShellFile>, String> {
    let mut dialog = app.dialog().file().set_file_name(&args.suggested_name);
    for filter in &args.filters {
        let exts: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.name, &exts);
    }
    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    let id = shell.id_for(&path);
    let key = shell.path_of(&id)?;
    // the file need not exist yet: then it is empty and has no time
    let (size, modified) = match fs::metadata(&key) {
        Ok(meta) => (meta.len(), modified_ms(&meta)),
        Err(_) => (0, 0),
    };
    Ok(Some(ShellFile {
        id,
        name: name_of(&key),
        size,
        modified,
        folder: folder_of(&key),
    }))
}

#[tauri::command]
pub async fn file_stat(shell: State<'_, Shell>, args: IdArgs) -> Result<ShellFile, String> {
    let path = shell.path_of(&args.id)?;
    describe(&args.id, &path)
}

#[tauri::command]
pub async fn file_read(shell: State<'_, Shell>, args: ReadArgs) -> Result<Response, String> {
    let path = shell.path_of(&args.id)?;
    let mut file = File::open(&path).map_err(io_err)?;
    let meta = file.metadata().map_err(io_err)?;
    if let Some(modified) = args.modified {
        if modified != modified_ms(&meta) {
            return Err("changed".to_string());
        }
    }
    let bytes = read_range(&mut file, meta.len(), args.start, args.end)?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn file_write_begin(shell: State<'_, Shell>, args: IdArgs) -> Result<WriteToken, String> {
    let target = shell.path_of(&args.id)?;
    begin_write(&shell, target)
}

/// Raw body command: the bytes are the body, { write, at? } is in the x-rodeo-args header.
#[tauri::command]
pub async fn write_chunk(request: Request<'_>, shell: State<'_, Shell>) -> Result<(), String> {
    let header = request
        .headers()
        .get("x-rodeo-args")
        .ok_or_else(|| "missing x-rodeo-args header".to_string())?
        .to_str()
        .map_err(|e| e.to_string())?;
    let args: ChunkArgs = serde_json::from_str(header).map_err(|e| e.to_string())?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("write_chunk takes raw bytes".to_string());
    };
    let mut writes = shell.writes.lock().unwrap();
    let write = writes
        .get_mut(&args.write)
        .ok_or_else(|| "unknown write".to_string())?;
    match args.at {
        Some(at) => {
            // overwrite in place; the append position stays where it was
            write.file.seek(SeekFrom::Start(at)).map_err(|e| e.to_string())?;
            write.file.write_all(bytes).map_err(|e| e.to_string())?;
        }
        None => {
            write.file.seek(SeekFrom::Start(write.append_at)).map_err(|e| e.to_string())?;
            write.file.write_all(bytes).map_err(|e| e.to_string())?;
            write.append_at += bytes.len() as u64;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn write_end(shell: State<'_, Shell>, args: EndArgs) -> Result<Option<Stamp>, String> {
    // the token is forgotten whatever happens next
    let write = shell
        .writes
        .lock()
        .unwrap()
        .remove(&args.write)
        .ok_or_else(|| "unknown write".to_string())?;
    let WriteInProgress { temp, target, mut file, .. } = write;
    if !args.commit {
        drop(file);
        let _ = fs::remove_file(&temp);
        return Ok(None);
    }
    file.flush().map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    // the handle must close before the rename (Windows)
    drop(file);
    // the file keeps who may read and write it: the new one would otherwise get the defaults
    if let Ok(old) = fs::metadata(&target) {
        let _ = fs::set_permissions(&temp, old.permissions());
    }
    if let Err(e) = fs::rename(&temp, &target) {
        let _ = fs::remove_file(&temp);
        return Err(io_err(e));
    }
    let meta = fs::metadata(&target).map_err(io_err)?;
    Ok(Some(Stamp {
        size: meta.len(),
        modified: modified_ms(&meta),
    }))
}

#[tauri::command]
pub async fn pending_take(shell: State<'_, Shell>) -> Result<Vec<ShellFile>, String> {
    let paths = {
        let mut pending = shell.pending.lock().unwrap();
        shell.ready.store(true, Ordering::SeqCst);
        std::mem::take(&mut *pending)
    };
    Ok(paths.iter().filter_map(|path| shell.describe_path(path).ok()).collect())
}

#[tauri::command]
pub async fn file_reveal(shell: State<'_, Shell>, args: IdArgs) -> Result<(), String> {
    let path = shell.path_of(&args.id)?;
    fs::metadata(&path).map_err(io_err)?;
    reveal(&path).map(|_child| ())
}

#[cfg(target_os = "macos")]
fn reveal(path: &Path) -> Result<Child, String> {
    Command::new("open").arg("-R").arg(path).spawn().map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn reveal(path: &Path) -> Result<Child, String> {
    Command::new("explorer.exe")
        .arg(format!("/select,{}", path.display()))
        .spawn()
        .map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal(path: &Path) -> Result<Child, String> {
    // Linux file managers have no "select" argument: the folder is shown instead
    let folder = path.parent().unwrap_or(path);
    Command::new("xdg-open").arg(folder).spawn().map_err(|e| e.to_string())
}

/// A link the page may open outside the app: https: or mailto:, at most 2000 characters, no
/// spaces or control characters.
pub fn external_url_ok(url: &str) -> Result<(), String> {
    if url.chars().count() > MAX_LINK {
        return Err(format!("the link is longer than {MAX_LINK} characters"));
    }
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("the link has spaces or control characters".to_string());
    }
    let parsed = tauri::Url::parse(url).map_err(|_| "the link is not a valid address".to_string())?;
    match parsed.scheme() {
        "https" | "mailto" => Ok(()),
        _ => Err("only https: and mailto: links open outside the app".to_string()),
    }
}

#[tauri::command]
pub async fn open_external(args: UrlArgs) -> Result<(), String> {
    external_url_ok(&args.url)?;
    open_with_system(&args.url)
}

#[cfg(target_os = "macos")]
fn open_with_system(url: &str) -> Result<(), String> {
    Command::new("open").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn open_with_system(url: &str) -> Result<(), String> {
    Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_with_system(url: &str) -> Result<(), String> {
    Command::new("xdg-open").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::external_url_ok;

    #[test]
    fn external_links() {
        assert!(external_url_ok("https://example.com/a?b=c").is_ok());
        assert!(external_url_ok("HTTPS://EXAMPLE.COM/").is_ok());
        assert!(external_url_ok("mailto:someone@example.com").is_ok());
        assert!(external_url_ok("http://example.com").is_err());
        assert!(external_url_ok("javascript:alert(1)").is_err());
        assert!(external_url_ok("file:///etc/passwd").is_err());
        assert!(external_url_ok("https://example.com/a b").is_err());
        assert!(external_url_ok("https://example.com/\n").is_err());
        assert!(external_url_ok("https://example.com/\u{0007}").is_err());
        let exact = format!("https://example.com/{}", "a".repeat(2000 - "https://example.com/".len()));
        assert_eq!(exact.chars().count(), 2000);
        assert!(external_url_ok(&exact).is_ok());
        assert!(external_url_ok(&format!("{exact}a")).is_err());
    }
}
