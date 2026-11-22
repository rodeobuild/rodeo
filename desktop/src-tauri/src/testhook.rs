//! Test bridge. Compiled only with `--features testhook`; a normal build has none of this.
//! Runs only when RODEO_TEST_PORT is set: an HTTP server on 127.0.0.1 that runs scripts in the
//! main window and answers with their results.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct TestState {
    waiters: Mutex<HashMap<u64, Sender<String>>>,
    next: AtomicU64,
}

pub fn start(app: &AppHandle) {
    let Ok(port) = std::env::var("RODEO_TEST_PORT") else {
        return;
    };
    let port: u16 = port.parse().expect("RODEO_TEST_PORT must be a port number");
    app.manage(TestState::default());
    let app = app.clone();
    std::thread::spawn(move || {
        let server = tiny_http::Server::http(("127.0.0.1", port)).expect("test bridge could not bind");
        for mut request in server.incoming_requests() {
            let url = request.url().to_string();
            let (path, query) = match url.split_once('?') {
                Some((p, q)) => (p.to_string(), q.to_string()),
                None => (url.clone(), String::new()),
            };
            let mut body = String::new();
            let _ = request.as_reader().read_to_string(&mut body);
            let (status, reply) = match (request.method().as_str(), path.as_str()) {
                ("GET", "/ready") => (200, format!("{{\"pid\":{}}}", std::process::id())),
                ("POST", "/eval") => {
                    let timeout = query
                        .split('&')
                        .find_map(|kv| kv.strip_prefix("timeout="))
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or(30_000);
                    (200, eval(&app, &body, timeout))
                }
                ("POST", "/open") => {
                    crate::deliver(&app, vec![PathBuf::from(body.trim_end())]);
                    (200, "{}".to_string())
                }
                // what the red close button does: the window's own close, which the page is asked about
                ("POST", "/close") => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.close();
                    }
                    (200, "{}".to_string())
                }
                // what the app menu's Quit item does (⌘Q): the same handler, without keystrokes
                ("POST", "/menu") => {
                    if query.split('&').any(|kv| kv == "id=quit") {
                        crate::menu_quit(&app);
                        (200, "{}".to_string())
                    } else {
                        (400, "{\"ok\":false,\"error\":\"unknown menu item\"}".to_string())
                    }
                }
                ("POST", "/quit") => {
                    let _ = request.respond(reply_json(200, "{}".to_string()));
                    app.exit(0);
                    continue;
                }
                _ => (404, "{\"ok\":false,\"error\":\"not found\"}".to_string()),
            };
            let _ = request.respond(reply_json(status, reply));
        }
    });
}

fn reply_json(status: u16, body: String) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap())
}

/// Runs `body` as the body of an async function in the main window; returns the JSON answer.
fn eval(app: &AppHandle, body: &str, timeout_ms: u64) -> String {
    let state = app.state::<TestState>();
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = channel();
    state.waiters.lock().unwrap().insert(id, tx);
    let script = format!(
        "(async()=>{{let out;try{{const v=await (async()=>{{ {body} }})();out={{ok:true,value:v===undefined?null:v}}}}catch(e){{out={{ok:false,error:String(e&&(e.stack||e.message)||e)}}}}window.__TAURI_INTERNALS__.invoke(\"test_result\",{{id:{id},json:JSON.stringify(out)}})}})()"
    );
    let sent = match app.get_webview_window("main") {
        Some(window) => window.eval(script).map_err(|e| e.to_string()),
        None => Err("no main window".to_string()),
    };
    if let Err(e) = sent {
        state.waiters.lock().unwrap().remove(&id);
        return format!("{{\"ok\":false,\"error\":{}}}", serde_json::json!(e));
    }
    match rx.recv_timeout(Duration::from_millis(timeout_ms)) {
        Ok(json) => json,
        Err(_) => {
            state.waiters.lock().unwrap().remove(&id);
            "{\"ok\":false,\"error\":\"timeout\"}".to_string()
        }
    }
}

/// Called by the page's wrapper with the script's result.
#[tauri::command]
pub fn test_result(id: u64, json: String, state: State<'_, TestState>) {
    if let Some(tx) = state.waiters.lock().unwrap().remove(&id) {
        let _ = tx.send(json);
    }
}
