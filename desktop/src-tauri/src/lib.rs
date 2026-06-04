#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use tauri::{
    Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_store::StoreExt;

/// Gap (px) between the character window and the chat panel.
const CHAT_GAP: i32 = 8;

/// Auth token-store contract — keep in sync with DesktopAuthProvider.tsx.
const AUTH_STORE_FILE: &str = "auth.json";
const AUTH_TOKEN_KEY: &str = "session_token";
const AUTH_EVENT: &str = "auth-token-updated";

/// How long the one-shot loopback listener waits for the browser callback
/// before giving up and freeing the port.
const AUTH_CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

/// Handed back to the frontend so it can open the browser sign-in page with the
/// ephemeral loopback port and the CSRF-binding nonce.
#[derive(serde::Serialize)]
struct LoopbackInfo {
    port: u16,
    state: String,
}

/// Persist the long-lived token and notify the running frontend so it can
/// connect (or reconnect) without a restart.
fn store_auth_token(app: &tauri::AppHandle, token: String) {
    if let Ok(store) = app.store(AUTH_STORE_FILE) {
        store.set(AUTH_TOKEN_KEY, serde_json::Value::String(token.clone()));
        let _ = store.save();
    }
    let _ = app.emit(AUTH_EVENT, token);
}

/// Start a one-shot loopback HTTP listener for the browser sign-in hand-off
/// (RFC 8252 §7.3 "Loopback Interface Redirection").
///
/// We bind an OS-assigned ephemeral port on `127.0.0.1` only and return
/// `{port, state}` to the frontend, which opens
/// `…/sign-in?desktop=1&port=<port>&state=<state>`. The browser then navigates
/// to `http://127.0.0.1:<port>/callback?token=…&state=…`.
///
/// Security: loopback-only (never `0.0.0.0`), single-use, and time-bounded. The
/// token is accepted only when the `state` nonce matches the one we generated
/// (so a drive-by localhost request can't inject a token) and the token is
/// non-empty.
#[tauri::command]
fn start_auth_loopback(app: tauri::AppHandle) -> Result<LoopbackInfo, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let state = uuid::Uuid::new_v4().to_string();

    let expected_state = state.clone();
    let app_handle = app.clone();
    // Non-blocking accept so the worker can honor the timeout and exit cleanly.
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let deadline = Instant::now() + AUTH_CALLBACK_TIMEOUT;
        loop {
            if Instant::now() >= deadline {
                break; // timed out: drop the listener, emit nothing
            }
            match listener.accept() {
                Ok((mut stream, _addr)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    // The request line ("GET /callback?… HTTP/1.1") is all we need.
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let target = req
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .unwrap_or("");

                    // A bare "/callback?…" has no base, so join onto a dummy one.
                    let parsed =
                        url::Url::parse("http://127.0.0.1").and_then(|base| base.join(target));

                    let mut token: Option<String> = None;
                    let mut got_state: Option<String> = None;
                    if let Ok(url) = parsed {
                        if url.path() == "/callback" {
                            for (key, value) in url.query_pairs() {
                                match key.as_ref() {
                                    "token" => token = Some(value.into_owned()),
                                    "state" => got_state = Some(value.into_owned()),
                                    _ => {}
                                }
                            }
                        }
                    }

                    let ok = got_state.as_deref() == Some(expected_state.as_str())
                        && token.as_deref().map(|t| !t.is_empty()).unwrap_or(false);

                    let (status, body) = if ok {
                        (
                            "200 OK",
                            "<!doctype html><meta charset=utf-8><title>Remi</title>\
<body style=\"font-family:system-ui;text-align:center;margin-top:18vh;color:#0f172a\">\
<h2>登录成功</h2><p>可以关闭此页面，回到 Remi 桌面端。</p></body>",
                        )
                    } else {
                        (
                            "400 Bad Request",
                            "<!doctype html><meta charset=utf-8><title>Remi</title>\
<body style=\"font-family:system-ui;text-align:center;margin-top:18vh;color:#0f172a\">\
<h2>登录失败</h2><p>请回到 Remi 桌面端重新发起登录。</p></body>",
                        )
                    };

                    // Content-Length + Connection: close lets the browser finish
                    // rendering and lets us drop the listener immediately.
                    let resp = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\
Content-Length: {len}\r\nConnection: close\r\n\r\n{body}",
                        len = body.len()
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    let _ = stream.flush();

                    if ok {
                        // Safe: `ok` proved `token` is Some and non-empty.
                        store_auth_token(&app_handle, token.unwrap());
                    }
                    break; // single-shot: one request handled, shut down
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(_) => break,
            }
        }
        // listener dropped here → socket closed
    });

    Ok(LoopbackInfo { port, state })
}

/// Place the chat panel beside the character window, preferring the right side
/// but flipping to the left when it would overflow the screen, and clamping the
/// final position so the panel never lands off-screen.
fn position_chat_near_character(
    chat_win: &tauri::WebviewWindow,
    char_win: &tauri::WebviewWindow,
) {
    let (Ok(char_pos), Ok(char_size), Ok(chat_size)) = (
        char_win.outer_position(),
        char_win.outer_size(),
        chat_win.outer_size(),
    ) else {
        return;
    };

    let chat_w = chat_size.width as i32;
    let chat_h = chat_size.height as i32;

    let mut x = char_pos.x + char_size.width as i32 + CHAT_GAP;
    let mut y = char_pos.y;

    if let Ok(Some(monitor)) = char_win.current_monitor() {
        let mon_pos = monitor.position();
        let mon_size = monitor.size();
        let mon_left = mon_pos.x;
        let mon_top = mon_pos.y;
        let mon_right = mon_pos.x + mon_size.width as i32;
        let mon_bottom = mon_pos.y + mon_size.height as i32;

        // Not enough room on the right → try the left side of the character.
        if x + chat_w > mon_right {
            let left_x = char_pos.x - chat_w - CHAT_GAP;
            x = if left_x >= mon_left {
                left_x
            } else {
                mon_right - chat_w
            };
        }

        // Keep the whole panel inside the monitor.
        x = x.clamp(mon_left, (mon_right - chat_w).max(mon_left));
        y = y.clamp(mon_top, (mon_bottom - chat_h).max(mon_top));
    }

    let _ = chat_win.set_position(tauri::PhysicalPosition::new(x, y));
}

#[tauri::command]
fn toggle_chat_panel(app: tauri::AppHandle) {
    let Some(chat_win) = app.get_webview_window("chat") else {
        return;
    };
    let Some(char_win) = app.get_webview_window("character") else {
        return;
    };

    if chat_win.is_visible().unwrap_or(false) {
        let _ = chat_win.hide();
    } else {
        position_chat_near_character(&chat_win, &char_win);
        let _ = chat_win.show();
        let _ = chat_win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .on_window_event(|window, event| match event {
            // The chat window's close button should hide it, not destroy it,
            // so toggle_chat_panel can show it again later.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() == "chat" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            // Keep the chat panel glued to the character while it's dragged.
            tauri::WindowEvent::Moved(_) => {
                if window.label() != "character" {
                    return;
                }
                let app = window.app_handle();
                let (Some(chat_win), Some(char_win)) = (
                    app.get_webview_window("chat"),
                    app.get_webview_window("character"),
                ) else {
                    return;
                };
                if chat_win.is_visible().unwrap_or(false) {
                    position_chat_near_character(&chat_win, &char_win);
                }
            }
            _ => {}
        })
        .setup(|app| {
            let quit =
                MenuItem::with_id(app, "quit", "Quit Remi", true, None::<&str>)?;
            let show =
                MenuItem::with_id(app, "show", "Show Remi", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Remi AI Companion")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(win) = app.get_webview_window("character") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("character") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            toggle_chat_panel,
            start_auth_loopback
        ])
        .run(tauri::generate_context!())
        .expect("error while running Remi desktop");
}
